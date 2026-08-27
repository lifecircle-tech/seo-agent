import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";
import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

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

  for await (const row of impressionsVsCtr) {
    const page = await getWPPageDetails(siteId, row.url);
    if (page) {
      const { content: _content, ...pageWithoutContent } = page;
      const is_redirected = await isUrlRedirected(page.url);
      const redirected_to = await redirectingToURL(page.url);

      pages.push({ ...pageWithoutContent, ...row, is_redirected, redirected_to });

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
    target_keywords: [page.primary_keyword, ...page.secondary_keywords],
    title: page.title,
    meta_description: page.meta_description,

    impressions: page.impressions ?? 0,
    clicks: page.clicks ?? 0,
    ctr: page.ctr ?? 0,
    position: page.position ?? null,

    is_redirected: page.is_redirected,
    redirected_to: page.redirected_to,
    canonical_url: page.canonical_url
  }));

  const prompt = `You are an SEO meta-tag specialist. You will be given a list of pages, each 
  with their current title tag, meta description, target keyword(s), and 
  performance data. Your job is to analyze each one and, where there is a clear 
  opportunity, write an improved title and meta description designed to improve 
  ranking relevance and click-through rate.

  Only suggest a change when you have a specific, defensible reason to. Do not 
  rewrite meta tags that are already well-optimized just to produce output.

  PAGES DETAILS AND PERFORMANCE:
  ${JSON.stringify(promptPages)}

  KEYWORD PERFORMANCE (last 28 days):
  ${JSON.stringify([...keyword_performance_map.values()])}

  For each page in the input, evaluate the current title and meta description 
  against the rules below, then decide whether to suggest a rewrite.

  WHEN TO FLAG FOR IMPROVEMENT
  - Target primary keyword is missing or buried late in the title.
  - Title exceeds ~70 characters (will get truncated in search results) or is 
    under ~30 characters (wasting available space).
  - Meta description is missing, empty, duplicate of another page, or outside 
    ~150-170 characters.
  - Meta description doesn't include the primary keyword or a clear value 
    proposition/reason to click.
  - CTR is meaningfully below the expected benchmark for the current position 
    (roughly: position 1-3 expect >10%, position 4-10 expect 2-5%, position 
    11-20 expect <2%) — when position/ctr data is available.
  - Title/description is generic, vague, or doesn't differentiate from 
    competitor_titles when that data is provided.
  - Search intent mismatch — e.g. transactional intent but the title reads as 
    purely informational, or vice versa.

  WHEN TO SKIP (no suggestion needed)
  - Title and description already include the primary keyword naturally, are 
    within length guidelines, have a clear value proposition, and CTR (if 
    available) is at or above the position benchmark.
  - Do not include these pages in the output array at all — do not pad the 
    response with unchanged suggestions.

  WRITING NEW TITLES & DESCRIPTIONS
  - Title: include the primary keyword as early as possible without sounding 
    forced; keep to 60-90 characters; make it specific and distinct, not generic.
  - Description: include the primary keyword naturally, state the clear value 
    or answer to the searcher's intent, and end with a soft prompt to click 
    where appropriate (avoid clickbait or unverifiable claims); keep to 
    150-170 characters.
  - Match tone to search_intent: transactional/commercial pages can be more 
    direct and benefit-driven; informational pages should emphasize clarity 
    and what the reader will learn.
  - Never fabricate claims, numbers, discounts, or credentials not supported by 
    the input data.
  - If competitor_titles are provided, differentiate rather than mimic — 
    identify what's missing or generic across competitors and fill that gap.

  PRIORITY
  Assign priority based on potential impact:
  - HIGH: high impressions with a clear, fixable CTR gap, or missing primary 
    keyword on a page with meaningful search volume/position.
  - MEDIUM: moderate impressions, or best-practice issues (length, missing 
    value prop) without strong CTR-gap evidence.
  - LOW: minor polish with limited traffic impact.

  OUTPUT FORMAT
  Return ONLY a valid JSON object:
  - opportunities: [
      {
        "id": {page id},
        "suggested_title": "{new title, 50-60 characters}",
        "suggested_description": "{new meta description, 150-160 characters}",
        "reasoning": "3-4 simple sentences explaining what was wrong with the current 
          meta and why the new version fixes it — cite the specific 
          issue (e.g. missing keyword, CTR gap vs. benchmark, length, 
          weak value proposition).",
        "priority": "1 | 2 | 3" (1=high, 2=medium, 3=low)
      }
    ]

  Include only pages that received a suggestion (per the skip rule above):

  CONSTRAINTS
  - Do not invent or assume metrics not present in the input.
  - Do not exceed the character guidelines given above.
  - Do not include pages that don't need changes.
  - Sort the array by priority: HIGH first, then MEDIUM, then LOW.
  - If the input array is empty or no pages need changes, return an empty array: []
  `;

  const response = await callWithRetry("step1", {
    model: "claude-sonnet-5",
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
            focus_keywords: [page.primary_keyword, ...page.secondary_keywords],
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
  // for (const site of sitesConfig) {
  await runDailyWPPagesTasks(1);
  // }
}
