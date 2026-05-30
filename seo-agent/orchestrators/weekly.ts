import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";
import { listKeywordsConfigs } from "../controllers/keywords.controller.js";
import { listCompetitorConfigs } from "../controllers/competitor.controller.js";

// MCP Server Imports
import { getKeywordRankings } from "../mcp-servers/keyword-tracker/server.js";
import {
  createApprovalQueue,
  getPage,
  getPagesWithHighImpressionLowCtr,
} from "../mcp-servers/cms-connector/server.js";
import {
  suggestSchemaImprovementsForPages,
  getPaaQuestionsForKeywords,
} from "../mcp-servers/schema-manager/server.js";
import {
  getKeywordsGapForCompetitorDomain,
  getContentsGapForCompetitorDomain,
  getBacklinksForCompetitorDomain,
} from "../mcp-servers/competitor-intel/server.js";
import {
  postWeeklyMessageToSlack,
  writeKeywordRankingsToSheet,
  writeRecommendationsToSheet,
} from "../mcp-servers/reporting/server.js";

dotenv.config();

interface SitesConfig {
  site_id: number;
  domain: string;
  brand_name: string;
  industry: string;
  cities: string[];
}

interface SitesKeywordsConfig {
  site_id: number;
  domain: string;
  keywords: string[];
}

interface CompetitorsConfig {
  site_id: number;
  domain: string;
  competitors_domain: string[];
}

let sitesConfig: SitesConfig[] = [];
let sitesKeywordsConfig: Record<string | number, SitesKeywordsConfig> = {};
let sitesCompetitorsConfig: Record<string | number, CompetitorsConfig> = {};

// ── Config ────────────────────────────────────────────────────────────
const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);
const TIMEOUT_SECONDS = 15 * 60; // 15 minutes hard limit
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000]; // milliseconds between retries

// ── Helper ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJson(text: string) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // Claude might return explanation text alongside JSON — extract the JSON block
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerErr) {
        // Fallthrough to return null on secondary failure
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
        console.log(
          `[${label}] attempt ${attempt + 1} failed: ${exc.message}. Retrying in ${waitMs / 1000}s...`,
        );
        await sleep(waitMs);
      } else {
        console.log(`[${label}] all ${MAX_RETRIES} attempts failed.`);
      }
    }
  }
  throw lastExc;
}

// ── Step 1: Keyword rankings ──────────────────────────────────────────
async function step1KeywordRankings(client: Anthropic, siteId: number) {
  console.log(`\n[step1] Getting keyword rankings for site_id=${siteId}...`);
  const siteKeywords = sitesKeywordsConfig[siteId].keywords || [];
  const site = sitesConfig.find((site) => site.site_id === siteId);

  const keywordRanking = await getKeywordRankings(
    siteId,
    site?.domain as string,
    siteKeywords,
  );

  console.log(`[step1] Done`);
  return {
    rankings: keywordRanking.rankings || [],
    top_movers: { movers: [] },
    velocity: {},
    summary: "",
  };
}

// ── Step 2: CMS Connector ─────────────────────────────────────────────
async function step2CmsConnector(client: Anthropic, siteId: number) {
  console.log(`\n[step2] Analyzing low-CTR pages for site_id=${siteId}...`);
  const site = sitesConfig.find((site) => site.site_id === siteId);

  const impressionsVsCtr = await getPagesWithHighImpressionLowCtr(
    siteId,
    site?.domain as string,
    28,
  );
  const pages = await Promise.all(
    impressionsVsCtr.map(async (row: any) => {
      const page = await getPage(siteId, row.url);
      const primaryKeywords = page.primary_keywords;
      const secondaryKeywords = page.secondary_keywords;

      return { ...page, ...row, primaryKeywords, secondaryKeywords };
    }),
  );

  /*
  - primary keyword should be present in h1 heading tag
  - secondary keywords should me present in subheading
  - primary and secondary keywords should be present in contents
  - primary keyword should be present in the first 10% of the content
  - minimum content should be 1500 words
  */

  if (pages.length === 0) {
    console.log(`[step2] No pages found for site_id=${siteId}.`);
    return { opportunities: [], summary: "No pages identified." };
  }

  const prompt = `You are an SEO content analyst for site_id=${siteId}, site name is ${site?.brand_name}.
  Here are the rules for SEO content:
  - primary keywords must be present in title
  - primary keywords must be present in meta description

  ${JSON.stringify(pages)}

  For each page from data above, follow the rules
  - write an improved title (max 60 chars) and meta description (max 155 chars) to increase CTR

  Return ONLY a JSON object with keys:
  - opportunities: array of objects with keywords(secondary keywords), url, current_ctr, impressions, current_title, current_description, suggested_title, suggested_description, reasoning, priority (1-3 based on potential impact)
  - summary: string with 2-3 overall action items

  No extra text.`;

  const response = await callWithRetry(client, "step2", {
    model: "claude-haiku-4-5",
    max_tokens: 10000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    betas: ["mcp-client-2025-04-04"],
  });

  console.log("Stop Reason: ", response.stop_reason);
  console.log("Usage: ", response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const parsed = extractJson(text);
  if (!parsed) {
    console.log(
      `[step2] Warning: could not parse JSON from response. Raw: ${text.substring(0, 200)}`,
    );
    return { opportunities: [], summary: text };
  }

  await createApprovalQueue(
    parsed.opportunities.map((opp: any) => {
      return {
        site_id: siteId,
        module: "cms-connector",
        type: "meta_rewrite",
        priority: opp.priority,
        title: opp.current_title,
        original_content: {
          focus_keywords: opp.keywords,
          url: opp.url,
          type: opp.type,
          current_title: opp.current_title,
          current_description: opp.current_description,
        },
        suggested_content: {
          type: opp.type,
          suggested_title: opp.suggested_title,
          suggested_description: opp.suggested_description,
          reasoning: opp.reasoning,
        },
        preview_url: opp.url,
      };
    }),
  );

  console.log(`[step2] Done`);
  return parsed;
}

// ── Step 3: Schema Manager ────────────────────────────────────────────
async function step3SchemaManager(
  client: Anthropic,
  siteId: number,
  cmsData: any | null = null,
) {
  console.log(`\n[step3] Analysing schema gaps for site_id=${siteId}...`);

  let topPages = [];
  if (cmsData && cmsData.opportunities && cmsData.opportunities.length > 0) {
    topPages = cmsData.opportunities
      .slice(0, 3)
      .map((o: any) => o.url)
      .filter(Boolean);
  }
  if (topPages.length === 0) {
    topPages = [];
  }

  const improvements = await suggestSchemaImprovementsForPages(topPages);

  const paaQuestions = await getPaaQuestionsForKeywords(
    siteId,
    sitesKeywordsConfig[siteId].keywords.slice(0, 5),
  );

  console.log(`[step3] Done`);
  return {
    pages: improvements || [],
    paa_questions: paaQuestions || [],
  };
}

// ── Step 4: Competitor Intel ──────────────────────────────────────────
async function step4CompetitorIntel(client: Anthropic, siteId: number) {
  console.log(`\n[step4] Running competitor analysis for site_id=${siteId}...`);
  const site = sitesConfig.find((site) => site.site_id === siteId);

  const siteCompetitors =
    sitesCompetitorsConfig[siteId].competitors_domain || [];
  if (siteCompetitors.length === 0) {
    console.log(
      `[step4] No competitors configured for site_id=${siteId}, skipping.`,
    );
    return [];
  }

  const keywordGaps = await getKeywordsGapForCompetitorDomain(
    siteId,
    site?.domain as string,
    siteCompetitors,
  );

  const contentGaps = await getContentsGapForCompetitorDomain(
    siteId,
    site?.domain as string,
    siteCompetitors,
  );

  const backlinks = await getBacklinksForCompetitorDomain(
    siteId,
    siteCompetitors,
  );

  const data = siteCompetitors.map((domain, idx) => ({
    competitor_domain: domain,
    keywordGaps: keywordGaps[idx].gaps || [],
    contentGaps: contentGaps[idx].topic_groups || [],
    backlinks: backlinks[idx].backlinks || [],
  }));

  console.log(`[step4] Done`);
  return data;
}

// ── Step 5: Reporting ─────────────────────────────────────────────────
async function step5Reporting(
  client: Anthropic,
  siteId: number,
  data: {
    keywords: any;
    cmsData: any;
    schemaData: any;
    competitorData: Array<any>;
  },
) {
  console.log(`\n[step5] Posting weekly digest for site_id=${siteId}...`);

  const {
    keywords,
    cmsData = null,
    schemaData = null,
    competitorData = [],
  } = data || {};

  if (DRY_RUN) {
    console.log("[step5] DRY_RUN=true — skipping Slack post and Sheets writes");
    console.log(
      `[step5] Would post digest with ${(keywords.rankings || []).length} rankings`,
    );
    if (cmsData && cmsData.opportunities) {
      console.log(
        `[step5] CMS step2 found ${cmsData.opportunities.length} low-CTR opportunities`,
      );
    }
    return;
  }

  const cmsOpportunities = (cmsData || {}).opportunities || [];

  const schemaPages = (schemaData || {}).pages || [];
  const paaQuestions = (schemaData || {}).paa_questions || [];

  const competitorKeywordGaps = (competitorData || []).map((competitor) => ({
    domain: competitor.competitor_domain,
    keywordGaps: competitor.keywordGaps || [],
  }));
  const competitorContentGaps = (competitorData || []).map((competitor) => ({
    domain: competitor.competitor_domain,
    contentGaps: competitor.contentGaps || [],
  }));
  const competitorBacklinks = (competitorData || []).map((competitor) => ({
    domain: competitor.competitor_domain,
    backlinks: competitor.backlinks || [],
  }));

  const response = await callWithRetry(client, "step5", {
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are an SEO reporting agent for site_id=${siteId}.

  Here is all data collected this week:

  ## Module 1 — Keyword Performance
  ${JSON.stringify(keywords.rankings, null, 2)}

  ## Module 2 — CMS Meta Suggestions (low-CTR pages)
  ${cmsOpportunities.length ? JSON.stringify(cmsOpportunities, null, 2) : "No opportunities identified."}

  ## Module 3 — Schema Gaps
  ${schemaPages.length ? JSON.stringify(schemaPages, null, 2) : "No schema gap data."}
  PAA questions identified: ${paaQuestions.length ? JSON.stringify(paaQuestions.slice(0, 5)) : "None"}

  ## Module 4 — Competitor Intelligence
  Competitors Keyword gaps: ${competitorKeywordGaps.length ? JSON.stringify(competitorKeywordGaps.slice(0, 5), null, 2) : "No gaps identified."}
  Competitors Content gaps: ${competitorContentGaps.length ? JSON.stringify(competitorContentGaps.slice(0, 5), null, 2) : "No content gaps."}
  Competitors Backlinks: ${competitorBacklinks.length ? JSON.stringify(competitorBacklinks.slice(0, 5), null, 2) : "No backlinks."}

  Please do all of the following in order:
  1. From above data, create a concise summary of key insights and recommendations for next week (3-5 sentences).
  2. For every module, write a recommendation with site_id=${siteId}, module=<module_name>, a concise recommendation from the module data

  Return ONLY a JSON object with keys:
  - summary: string with concise insights and recommendations
  - recommendations: array of objects with module, recommendation_text`,
      },
    ],
    betas: ["mcp-client-2025-04-04"],
  });

  console.log("Stop Reason: ", response.stop_reason);
  console.log("Usage: ", response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const parsed = extractJson(text);

  await writeKeywordRankingsToSheet(siteId, keywords.rankings);

  await writeRecommendationsToSheet(siteId, parsed.recommendations);

  const site = sitesConfig.find((site) => site.site_id === siteId);

  await postWeeklyMessageToSlack(siteId, site?.domain as string, {
    rankings: keywords.rankings || [],
    cmsOpportunities: (cmsData || {}).opportunities || [],
    schemaGaps: (schemaData || {}).pages || [],
    competitorsAlerts: competitorData,
    summary: parsed.summary || "No summary",
  });

  console.log(`[step5] Done`);
}

// ── Summary Printer ───────────────────────────────────────────────────
function printSummary(errors: StepError, elapsed: number) {
  console.log(`\n[weekly] ══════════════════════════════════════════`);
  console.log(`[weekly] Pipeline complete in ${elapsed.toFixed(1)}s`);
  if (Object.keys(errors).length > 0) {
    console.log(`[weekly] Errors encountered:`);
    for (const [step, msg] of Object.entries(errors)) {
      console.log(`  ${step}: ${msg}`);
    }
  } else {
    console.log(`[weekly] All steps succeeded ✓`);
  }
  console.log(`[weekly] ══════════════════════════════════════════`);
}

interface StepError {
  step1: string;
  step2: string;
  step3: string;
  step4: string;
  step5: string;
}

// ── Main pipeline ─────────────────────────────────────────────────────
async function runWeeklyTasks(siteId: number) {
  const client: Anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const startTime = Date.now();
  const errors = {} as StepError;

  console.log(`[weekly] ══════════════════════════════════════════`);
  console.log(`[weekly] Starting weekly pipeline — site_id=${siteId}`);
  console.log(`[weekly] DRY_RUN=${DRY_RUN}`);
  console.log(`[weekly] ══════════════════════════════════════════`);

  // ── Step 1: Keyword rankings ──────────────────────────────────────
  let keywordData = {};
  try {
    keywordData = await step1KeywordRankings(client, siteId);
  } catch (exc: any) {
    errors.step1 = exc.message;
    console.log(`[step1] ERROR: ${exc.message}`);
  }

  // ── Step 2: CMS connector — low-CTR page analysis ────────────────
  let cmsData = {};
  try {
    cmsData = await step2CmsConnector(client, siteId);
  } catch (exc: any) {
    errors.step2 = exc.message;
    console.log(`[step2] ERROR: ${exc.message}`);
  }

  // ── Step 3: Schema manager ────────────────────────────────────────
  let schemaData = {};
  try {
    schemaData = await step3SchemaManager(client, siteId, cmsData);
  } catch (exc: any) {
    errors.step3 = exc.message;
    console.log(`[step3] ERROR: ${exc.message}`);
  }

  // ── Step 4: Competitor intel ──────────────────────────────────────
  let competitorData: any[] = [];
  try {
    competitorData = await step4CompetitorIntel(client, siteId);
  } catch (exc: any) {
    errors.step4 = exc.message;
    console.log(`[step4] ERROR: ${exc.message}`);
  }

  // ── Timeout check ─────────────────────────────────────────────────
  let elapsedSeconds = (Date.now() - startTime) / 1000;
  if (elapsedSeconds > TIMEOUT_SECONDS) {
    console.log(
      `\n[weekly] TIMEOUT: pipeline exceeded ${TIMEOUT_SECONDS}s (${elapsedSeconds.toFixed(0)}s elapsed)`,
    );
    printSummary(errors, elapsedSeconds);
    return;
  }

  // ── Step 5: Reporting ─────────────────────────────────────────────
  try {
    await step5Reporting(client, siteId, {
      keywords: keywordData,
      cmsData,
      schemaData,
      competitorData,
    });
  } catch (exc: any) {
    errors.step5 = exc.message;
    console.log(`[step5] ERROR: ${exc.message}`);
  }

  elapsedSeconds = (Date.now() - startTime) / 1000;
  printSummary(errors, elapsedSeconds);
}

export async function weeklyTasks() {
  console.log(`[weekly] Fetching configuration from database...`);

  // Fetch all configuration data from MySQL via controllers
  // Using a large limit to ensure all configs are loaded for the pipeline
  const [sitesRes, keywordsRes, competitorsRes] = await Promise.all([
    listSitesConfigs({ limit: 1000 }),
    listKeywordsConfigs({ limit: 1000 }),
    listCompetitorConfigs({ limit: 1000 }),
  ]);

  // 1. Populate Sites Configuration
  sitesConfig = sitesRes.sites;

  // 2. Populate Keywords Configuration (Mapped to site_id)
  sitesKeywordsConfig = {};
  keywordsRes.keywords.forEach((config) => {
    sitesKeywordsConfig[config.site_id] = {
      site_id: config.site_id,
      domain: config.domain,
      keywords: config.target_keywords, // Map target_keywords from DB to keywords interface
    };
  });

  // 3. Populate Competitors Configuration (Mapped to site_id)
  sitesCompetitorsConfig = {};
  competitorsRes.competitors.forEach((config) => {
    // Note: The database model uses competitor_domain (singular)
    // while the internal pipeline uses competitors_domain (plural).
    sitesCompetitorsConfig[config.site_id] = {
      site_id: config.site_id,
      domain: config.domain || "", // Ensure domain exists if needed by the interface
      competitors_domain: config.competitor_domain,
    };
  });

  console.log(
    `[weekly] Loaded ${sitesConfig.length} sites. Starting processing...`,
  );

  // Run pipeline for each configured site
  for (const site of sitesConfig) {
    await runWeeklyTasks(site.site_id);
  }
}

// ── Execute ───────────────────────────────────────────────────────────
// if (import.meta.url === `file://${process.argv[1]}`) {
// const siteId = 1;
// runWeeklyTasks(siteId).catch(console.error);
// }
