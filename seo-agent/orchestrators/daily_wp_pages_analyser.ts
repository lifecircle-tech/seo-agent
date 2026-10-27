import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";
import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";
import { renderPrompt, seoAgentModel } from "../prompts/index.js";
import { getMetaRewriteBlocks, normalizeUrl } from "../services/seo-guards.service.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";
import {
  getKeywordsForPage,
  getPageByUrl,
} from "../controllers/page.controller.js";

// MCP Server Imports
import {
  createApprovalQueue,
  getPagesWithHighImpressionLowCtr,
} from "../mcp-servers/cms-connector/server.js";
import { getMetaRewriteApprovedApprovalByUrl } from "../controllers/approvals.controller.js";
import { getStreamedAIResponse } from "../services/anthropic.service.js";
import { isUrlRedirected, redirectingToURL } from "../../libs/functions.js";
import { getWPPageDetails } from "../services/wordpress.service.js";

// ── Types ─────────────────────────────────────────────────────────────

interface SitesConfig {
  site_id: number;
  domain: string;
  brand_name: string;
  industry: string;
  about: string;
}

interface StepError {
  step1: string;
  step2: string;
}

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000]; // milliseconds between retries

let sitesConfig: SitesConfig[] = [];

// ── Helper ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJson(text: string) {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

/**
 * Rank Math focus keywords for a page, primary first. getWPPageDetails returns the
 * primary as `primary_keywords` (a string) — reading `primary_keyword` dropped it.
 */
function rankMathKeywords(page: {
  primary_keywords?: string | null;
  secondary_keywords?: string[] | null;
}): string[] {
  return [page.primary_keywords, ...(page.secondary_keywords ?? [])]
    .map((k) => (k ?? "").trim())
    .filter(Boolean);
}

// ── Retry helper ──────────────────────────────────────────────────────
async function callWithRetry(
  label: string,
  params: MessageCreateParamsNonStreaming,
): Promise<Message> {
  let lastExc: Error = new Error("No attempts made");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await getStreamedAIResponse(label, params);
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

// ── Step 1: CMS Connector ─────────────────────────────────────────────
async function step1CmsConnector(siteId: number) {
  logger.info(`[step1] Analyzing low-CTR pages for site_id=${siteId}...`);
  const site = sitesConfig.find((site) => site.site_id === siteId);

  const impressionsVsCtr = await getPagesWithHighImpressionLowCtr(
    siteId,
    site?.domain as string,
    28,
  );
  const pages: any[] = [];
  const keyword_performance_map = new Map();

  // Cooldown: skip pages rewritten recently, with a pending rewrite, or whose last rewrite worked
  const blocked = await getMetaRewriteBlocks(siteId);
  const candidates = impressionsVsCtr.filter((row: { url: string }) => {
    const reason = blocked.get(normalizeUrl(row.url));
    if (reason) logger.info(`[step1] skip ${row.url}: ${reason}`);
    return !reason;
  });
  logger.info(`[step1] ${candidates.length}/${impressionsVsCtr.length} pages eligible for a meta rewrite`);

  for await (const row of candidates) {
    const page = await getWPPageDetails(siteId, row.url);
    if (page) {
      const { content: _content, ...pageWithoutContent } = page;
      const is_redirected = await isUrlRedirected(page.url);
      const redirected_to = await redirectingToURL(page.url);

      pages.push({
        ...pageWithoutContent,
        ...row,
        is_redirected,
        redirected_to,
      });

      const record_page = await getPageByUrl(page.url);
      let keywordPerformance: any;

      if (record_page) {
        keywordPerformance = (await getKeywordsForPage(record_page.id)).map(
          (key) => ({
            keyword: key.keyword,
            clicks: key.clicks,
            impressions: key.impressions,
            search_volume: key.search_volume,
            difficulty: key.difficulty,
            position: key.position,
            cpc: key.cpc,
            ctr: key.ctr,
            competition: key.competition_level,
          }),
        );

        keywordPerformance = keywordPerformance.length
          ? keywordPerformance
          : null;
      }

      if (keywordPerformance) {
        keywordPerformance.map((k: any) => {
          if (!keyword_performance_map.has(k.keyword)) {
            keyword_performance_map.set(k.keyword, k);
          }
        });
      }
    }
  }

  if (pages.length === 0) {
    logger.warn(`[step1] No pages found for site_id=${siteId}.`);
    return { opportunities: [], summary: "No pages identified." };
  }

  const promptPages = pages.map((page) => ({
    page_id: page.id,
    url: page.url,
    target_keywords: rankMathKeywords(page),
    title: page.title,
    meta_description: page.meta_description,

    impressions: page.impressions ?? 0,
    clicks: page.clicks ?? 0,
    ctr: page.ctr ?? 0,
    position: page.position ?? null,

    is_redirected: page.is_redirected,
    redirected_to: page.redirected_to,
    canonical_url: page.canonical_url,
  }));

  const prompt = renderPrompt("wp_meta_rewrite", {
    pages: JSON.stringify(promptPages),
    keyword_performance: JSON.stringify([...keyword_performance_map.values()]),
  });

  const response = await callWithRetry("step1", {
    model: seoAgentModel(),
    max_tokens: 50000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  logger.debug(`[step1] Stop reason: ${response.stop_reason}`);
  logger.debug(`[step1] Usage: `, response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const parsed = extractJson(text);
  if (!parsed) {
    logger.warn(`[step1] Could not parse JSON from response`, {
      raw: text.substring(0, 200),
    });
    return { opportunities: [], summary: text };
  }

  parsed.opportunities = parsed.opportunities.map((opp: any) => {
    const page = pages.find((p: any) => p.id === opp.id);
    return { ...opp, url: page?.url };
  });

  await createApprovalQueue(
    await Promise.all(
      parsed.opportunities.map(async (opp: any) => {
        const page = pages.find((p: any) => p.id === opp.id);
        const last_updated_at = await getMetaRewriteApprovedApprovalByUrl(
          page.url,
        );

        return {
          site_id: siteId,
          module: "cms-connector",
          type: "meta_rewrite",
          priority: opp.priority,
          title: page.title,
          original_content: {
            focus_keywords: rankMathKeywords(page),
            url: page.url,
            type: page.type,
            current_title: page.title,
            current_description: page.meta_description,
            last_updated_at: last_updated_at?.actioned_at,
          },
          suggested_content: {
            type: page.type,
            suggested_title: opp.suggested_title,
            suggested_description: opp.suggested_description,
          },
          reason: opp.reasoning,
          preview_url: page.url,
          update_page: false,
        };
      }),
    ),
  );

  logger.info(`[step1] Done`);
  return parsed;
}

// ── Summary Printer ───────────────────────────────────────────────────
function printSummary(errors: StepError, elapsed: number) {
  logger.info(`[daily_page_meta] Pipeline complete in ${elapsed.toFixed(1)}s`);
  if (Object.keys(errors).length > 0) {
    for (const [step, msg] of Object.entries(errors)) {
      logger.error(`[daily_page_meta] ${step} failed`, { message: msg });
    }
  } else {
    logger.info(`[daily_page_meta] All steps succeeded`);
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────
async function runDailyWPPagesTasks(siteId: number) {
  const startTime = Date.now();
  const errors = {} as StepError;

  logger.info(`[daily_page_meta] ══════════════════════════════════════════`);
  logger.info(
    `[daily_page_meta] Starting Daily WP Pages meta analyzer pipeline — site_id=${siteId}`,
  );
  logger.info(`[daily_page_meta] ══════════════════════════════════════════`);

  // ── Step 1: CMS connector — low-CTR page analysis ────────────────
  let cmsData = {};
  try {
    cmsData = await step1CmsConnector(siteId);
  } catch (exc: any) {
    errors.step1 = exc.message;
    logger.error(`[step1] ERROR: `, exc);
  }

  // ── Timeout check ─────────────────────────────────────────────────
  let elapsedSeconds = (Date.now() - startTime) / 1000;

  // ── Step 2: Reporting ─────────────────────────────────────────────
  //   try {
  //     await step2Reporting(client, siteId, {
  //       keywords: keywordData,
  //       cmsData,
  //       schemaData,
  //       competitorData,
  //     });
  //   } catch (exc: any) {
  //     errors.step5 = exc.message;
  //     logger.error(`[step5] ERROR: `, exc);
  //   }

  elapsedSeconds = (Date.now() - startTime) / 1000;
  printSummary(errors, elapsedSeconds);
}

export async function dailyWPPagesTasks() {
  logger.info(`[daily_page_meta] Fetching configuration from database...`);

  // Fetch all configuration data from MySQL via controllers
  // Using a large limit to ensure all configs are loaded for the pipeline
  const [sitesRes] = await Promise.all([listSitesConfigs({ limit: 1000 })]);

  // 1. Populate Sites Configuration
  sitesConfig = sitesRes.sites;

  logger.info(
    `[daily_page_meta] Loaded ${sitesConfig.length} sites. Starting processing...`,
  );

  // Run pipeline for each configured site
  for (const site of sitesConfig.filter((s) => [1, 2].includes(s.site_id))) {
    await runDailyWPPagesTasks(site.site_id);
  }
}
