import Anthropic from "@anthropic-ai/sdk";
import {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta.js";
import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";

// MCP Server Imports
import {
  auditCitations,
  getCitationScore,
  getPriorityFixes,
} from "../mcp-servers/citation-auditor/server.js";
import {
  fetchAllPages,
  findInternalLinkOpportunities,
  getOrphanPages,
} from "../mcp-servers/link-optimiser/server.js";
import { postSlackMessage } from "../mcp-servers/reporting/server.js";
import { getMissingCityPages } from "../mcp-servers/page-generator/server.js";

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);
const TIMEOUT_SECONDS = 15 * 60;
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000];

let allPages = [] as {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  rank_math_meta: { title: string };
}[];

// ── Helper ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJson(text: string): any {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fallthrough
      }
    }
    return null;
  }
}

// ── Retry helper ──────────────────────────────────────────────────────
async function callWithRetry(
  client: Anthropic,
  label: string,
  params: MessageCreateParamsNonStreaming,
): Promise<BetaMessage> {
  let lastExc: Error = new Error("No attempts made");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await client.beta.messages.create(params);
    } catch (exc: any) {
      lastExc = exc as Error;
      if (attempt < MAX_RETRIES - 1) {
        const waitMs = RETRY_BACKOFF[attempt];
        logger.warn(
          `[${label}] attempt ${attempt + 1} failed: ${exc.message}. Retrying in ${waitMs / 1000}s...`,
        );
        await sleep(waitMs);
      } else {
        logger.error(`[${label}] all ${MAX_RETRIES} attempts failed.`);
      }
    }
  }
  throw lastExc;
}

// ── Step 1: Citation Audit ────────────────────────────────────────────
async function step1CitationAudit(siteId: number) {
  logger.info(`[step1] Running citation audit for site_id=${siteId}...`);

  const [auditResult, scoreResult, fixesResult] = await Promise.all([
    auditCitations(siteId),
    getCitationScore(siteId),
    getPriorityFixes(siteId),
  ]);

  logger.info(
    `[step1] Citation score: ${scoreResult.score}/100 (${scoreResult.grade})`,
  );
  logger.info(
    `[step1] NAP issues: ${auditResult.nap_inconsistencies.length}, Missing dirs: ${auditResult.missing_directories.length}`,
  );
  logger.info(`[step1] Done`);

  return { audit: auditResult, score: scoreResult, priorityFixes: fixesResult };
}

// ── Step 2: Internal Link Analysis ───────────────────────────────────
async function step2LinkAnalysis(siteId: number) {
  logger.info(
    `[step2] Running internal link analysis for site_id=${siteId}...`,
  );

  const opportunities = await findInternalLinkOpportunities(siteId, allPages);

  logger.info(`[step2] Done`);
  return opportunities;
}

// ── Step 3: Orphan Page Detection ────────────────────────────────────
async function step3OrphanPages(siteId: number) {
  logger.info(`[step3] Detecting orphan pages for site_id=${siteId}...`);

  const orphans = await getOrphanPages(siteId, allPages);
  logger.info(
    `[step3] Orphan pages: ${orphans.orphan_count}/${orphans.total_pages}`,
  );

  logger.info(`[step3] Done`);
  return orphans;
}

// ── Step 4: Reporting ─────────────────────────────────────────────────
async function step4Reporting(
  client: Anthropic,
  siteId: number,
  domain: string,
  data: {
    citationData: Awaited<ReturnType<typeof step1CitationAudit>>;
    linkData: Awaited<ReturnType<typeof step2LinkAnalysis>>;
    orphanData: Awaited<ReturnType<typeof step3OrphanPages>>;
  },
) {
  logger.info(
    `[step4] Generating monthly audit report for site_id=${siteId}...`,
  );

  const { citationData, linkData, orphanData } = data;

  if (DRY_RUN) {
    logger.info("[step4] DRY_RUN=true — skipping Slack post");
    logger.info(
      `[step4] Citation score: ${citationData.score.score}/100, ` +
        `Link opportunities: ${linkData.opportunities_count}, ` +
        `Orphans: ${orphanData.orphan_count}`,
    );
    return;
  }

  /*   ## Citation Audit
  Score: ${citationData.score.score}/100 (Grade ${citationData.score.grade})
  NAP inconsistencies: ${citationData.audit.nap_inconsistencies.length}
  Missing directories: ${citationData.audit.missing_directories.length}
  Top priority fixes:
  ${JSON.stringify(citationData.priorityFixes.fixes.slice(0, 5), null, 2)}
 */
  const prompt = `You are an SEO audit analyst for site_id=${siteId} (${domain}).

Here is the monthly audit data collected:

## Internal Link Analysis
Pages scanned: ${linkData.pages_scanned}
Link opportunities found: ${linkData.opportunities_count}
Top opportunities:
${JSON.stringify(linkData.opportunities.slice(0, 10), null, 2)}

## Orphan Page Detection
Total pages: ${orphanData.total_pages}
Orphan pages: ${orphanData.orphan_count}
Orphans:
${JSON.stringify(
  orphanData.orphans.slice(0, 10).map((o) => ({ url: o.url, title: o.title })),
  null,
  2,
)}

Write a concise monthly audit summary (3-5 sentences) with the top 3 action items for this month.

Return ONLY a JSON object with keys:
- summary: string
- action_items: array of strings (exactly 3 items)`;

  const response = await callWithRetry(client, "step4", {
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
    betas: ["mcp-client-2025-04-04"],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  logger.debug(`[step4] Stop reason: ${response.stop_reason}`);
  logger.debug(`[step4] Usage: `, response.usage);

  const parsed = extractJson(text);
  const summary = parsed?.summary ?? "Monthly SEO audit complete.";
  const actionItems: string[] = parsed?.action_items ?? [];

  // Format Slack message
  const slackBlocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📋 Monthly SEO Audit — ${domain}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: summary },
    },
    {
      type: "section",
      fields: [
        // {
        //   type: "mrkdwn",
        //   text: `*Citation Score*\n${citationData.score.score}/100 (${citationData.score.grade})`,
        // },
        // {
        //   type: "mrkdwn",
        //   text: `*NAP Issues*\n${citationData.audit.nap_inconsistencies.length} inconsistencies`,
        // },
        {
          type: "mrkdwn",
          text: `*Link Opportunities*\n${linkData.opportunities_count} unlinked mentions`,
        },
        {
          type: "mrkdwn",
          text: `*Orphan Pages*\n${orphanData.orphan_count} pages with no inbound links`,
        },
      ],
    },
    ...(actionItems.length > 0
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Top Action Items*\n${actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
            },
          },
        ]
      : []),
    {
      type: "divider",
    },
  ];

  await postSlackMessage(summary, slackBlocks);

  logger.info(`[step4] Monthly audit report posted to Slack`);
  logger.info(`[step4] Done`);

  return { summary, action_items: actionItems };
}

// ── Summary printer ───────────────────────────────────────────────────
interface StepErrors {
  step1?: string;
  step2?: string;
  step3?: string;
  step4?: string;
}

function printSummary(siteId: number, errors: StepErrors, elapsed: number) {
  logger.info(
    `[monthly_audit] site_id=${siteId} complete in ${elapsed.toFixed(1)}s`,
  );
  if (Object.keys(errors).length > 0) {
    for (const [step, msg] of Object.entries(errors)) {
      logger.error(`[monthly_audit] ${step} failed`, msg);
    }
  } else {
    logger.info(`[monthly_audit] All steps succeeded`);
  }
}

// ── Per-site pipeline ─────────────────────────────────────────────────
async function runMonthlyAudit(siteId: number, domain: string) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startTime = Date.now();
  const errors: StepErrors = {};

  logger.info(`\n[monthly_audit] ══════════════════════════════════════════`);
  logger.info(
    `[monthly_audit] Starting monthly audit — site_id=${siteId} (${domain})`,
  );
  logger.info(`\n[monthly_audit] ══════════════════════════════════════════`);

  // Step 1: Citation audit
  let citationData: Awaited<ReturnType<typeof step1CitationAudit>> | null =
    null;
  // try {
  //   citationData = await step1CitationAudit(siteId);
  // } catch (exc: any) {
  //   errors.step1 = exc.message;
  //   logger.error(`[step1] ERROR: `, exc);
  // }

  allPages = await fetchAllPages(siteId);

  // Step 2: Internal link analysis
  let linkData: Awaited<ReturnType<typeof step2LinkAnalysis>> | null = null;
  try {
    linkData = await step2LinkAnalysis(siteId);
  } catch (exc: any) {
    errors.step2 = exc.message;
    logger.error(`[step2] ERROR: `, exc);
  }

  // Step 3: Orphan page detection
  let orphanData: Awaited<ReturnType<typeof step3OrphanPages>> | null = null;
  try {
    orphanData = await step3OrphanPages(siteId);
  } catch (exc: any) {
    errors.step3 = exc.message;
    logger.error(`[step3] ERROR: `, exc);
  }

  // Timeout check
  if ((Date.now() - startTime) / 1000 > TIMEOUT_SECONDS) {
    logger.warn(`[monthly_audit] TIMEOUT after step3`);
    printSummary(siteId, errors, (Date.now() - startTime) / 1000);
    return;
  }

  allPages = [];
  // Step 4: Report (only if we have at least some data)
  if (citationData || linkData || orphanData) {
    try {
      await step4Reporting(client, siteId, domain, {
        citationData: citationData ?? {
          audit: {
            site_id: siteId,
            report_id: "",
            citations_found: 0,
            citations_total_checked: 0,
            nap_inconsistencies: [],
            missing_directories: [],
            incorrect_listings: [],
            cached: false,
          },
          score: {
            site_id: siteId,
            score: 0,
            grade: "F" as const,
            citations_found: 0,
            nap_accuracy_pct: 0,
            coverage_pct: 0,
            breakdown: {
              nap_consistency: 0,
              directory_coverage: 0,
              listing_accuracy: 0,
            },
          },
          priorityFixes: { site_id: siteId, total_fixes: 0, fixes: [] },
        },
        linkData: linkData ?? {
          site_id: siteId,
          pages_scanned: 0,
          opportunities_count: 0,
          opportunities: [],
        },
        orphanData: orphanData ?? {
          site_id: siteId,
          total_pages: 0,
          orphan_count: 0,
          orphans: [],
        },
      });
    } catch (exc: any) {
      errors.step4 = exc.message;
      logger.error(`[step4] ERROR: `, exc);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  printSummary(siteId, errors, elapsed);
  logger.info(`\n[monthly_audit] ══════════════════════════════════════════`);
}

// ── Main export ───────────────────────────────────────────────────────
export async function monthlyAudit() {
  logger.info(`[monthly_audit] Fetching site configuration from database...`);

  const { sites } = await listSitesConfigs({ limit: 1000 });

  logger.info(
    `[monthly_audit] Loaded ${sites.length} sites. Starting monthly audit...`,
  );

  const site = sites[0];
  // for (const site of sites) {
  try {
    await runMonthlyAudit(site.site_id, site.domain);
  } catch (exc: any) {
    logger.error(
      `[monthly_audit] Unhandled error for site_id=${site.site_id}: `,
      exc,
    );
  }
  // }

  logger.info(`[monthly_audit] All sites processed.`);
}
