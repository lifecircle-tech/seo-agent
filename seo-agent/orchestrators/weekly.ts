import Anthropic from "@anthropic-ai/sdk";
import {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta.js";
import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";
import { listKeywordsConfigs } from "../controllers/keywords.controller.js";
import { listCompetitorConfigs } from "../controllers/competitor.controller.js";

// MCP Server Imports
import { getKeywordRankings } from "../mcp-servers/keyword-tracker/server.js";
import {
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
import {
  listLocations,
  getInsights,
} from "../mcp-servers/gbp-manager/server.js";
import {
  getNewReviews,
  draftReviewResponse,
  getReviewMetrics,
} from "../mcp-servers/reputation-manager/server.js";

// ── Types ─────────────────────────────────────────────────────────────

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

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);
const TIMEOUT_SECONDS = 15 * 60; // 15 minutes hard limit
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000]; // milliseconds between retries

let sitesConfig: SitesConfig[] = [];
let sitesKeywordsConfig: Record<string | number, SitesKeywordsConfig> = {};
let sitesCompetitorsConfig: Record<string | number, CompetitorsConfig> = {};

// ── Helper ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJson(text: string) {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
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

// ── Step 1: Keyword rankings ──────────────────────────────────────────
async function step1KeywordRankings(siteId: number) {
  logger.info(`[step1] Getting keyword rankings for site_id=${siteId}...`);
  const siteKeywords = sitesKeywordsConfig[siteId].keywords || [];
  const site = sitesConfig.find((site) => site.site_id === siteId);

  const keywordRanking = await getKeywordRankings(
    siteId,
    site?.domain as string,
    siteKeywords,
  );

  logger.info(`[step1] Done`);
  return {
    rankings: keywordRanking.rankings || [],
    top_movers: { movers: [] },
    velocity: {},
    summary: "",
  };
}

// ── Step 2: Schema Manager ────────────────────────────────────────────
async function step2SchemaManager(siteId: number) {
  logger.info(`[step2] Analysing schema gaps for site_id=${siteId}...`);

  const site = sitesConfig.find((site) => site.site_id === siteId);

  const impressionsVsCtr = await getPagesWithHighImpressionLowCtr(
    siteId,
    site?.domain as string,
    28,
  );

  let topPages = [];
  for await (const row of impressionsVsCtr) {
    const page = await getPage(siteId, row.url);
    if (page) {
      topPages.push(page.url as string);
    }
  }

  const improvements = await suggestSchemaImprovementsForPages(
    topPages.slice(0, 5),
  );

  const paaQuestions = await getPaaQuestionsForKeywords(
    siteId,
    sitesKeywordsConfig[siteId].keywords.slice(0, 5),
  );

  logger.info(`[step2] Done`);
  return {
    pages: improvements || [],
    paa_questions: paaQuestions || [],
  };
}

// ── Step 3: Competitor Intel ──────────────────────────────────────────
async function step3CompetitorIntel(siteId: number) {
  logger.info(`[step3] Running competitor analysis for site_id=${siteId}...`);
  const site = sitesConfig.find((site) => site.site_id === siteId);

  const siteCompetitors =
    sitesCompetitorsConfig[siteId].competitors_domain || [];
  if (siteCompetitors.length === 0) {
    logger.warn(
      `[step3] No competitors configured for site_id=${siteId}, skipping.`,
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

  logger.info(`[step3] Done`);
  return data;
}

// ── Step 4: GBP Manager ───────────────────────────────────────────────
async function step4GbpManager(siteId: number) {
  logger.info(`\n[step4] Collecting GBP insights for site_id=${siteId}...`);
  const site = sitesConfig.find((s) => s.site_id == siteId);

  const { locations } = await listLocations(siteId, site?.brand_name as string);
  if (locations.length === 0) {
    logger.info(
      `[step4] No GBP locations found for site_id=${siteId}, skipping.`,
    );
    return { locations: [], insights: [] };
  }

  const insights = [] as any[];
  for await (let loc of locations.slice(0, 2)) {
    try {
      const data = await getInsights(siteId, loc.location_id, 7);
      insights.push({ ...loc, ...data, site_id: siteId });
    } catch (err: any) {
      logger.info(
        `[step4] getInsights failed for ${loc.location_id}: ${err.message}`,
      );
      insights.push({
        ...loc,
        views: 0,
        searches: 0,
        actions: 0,
        site_id: siteId,
      });
    }
  }

  logger.info(
    `[step4] Done — ${locations.length} locations, Insights for ${insights.length}`,
  );
  // TODO : Post insight data to google sheet.
  return { locations, insights };
}

// ── Step 7: Reputation Manager ────────────────────────────────────────
async function step7ReputationManager(siteId: number) {
  logger.info(`\n[step7] Checking new reviews for site_id=${siteId}...`);

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 7);

  const { reviews } = await getNewReviews(siteId, sinceDate.toISOString());
  const unanswered = reviews.filter((r) => !r.has_reply);

  if (unanswered.length === 0) {
    logger.info(`[step7] No unanswered reviews for site_id=${siteId}.`);
    return { metrics: null, queued: 0 };
  }

  logger.info(
    `[step7] Drafting responses for ${unanswered.length} unanswered reviews...`,
  );

  const drafts = [];
  for (const review of unanswered) {
    try {
      const draft = await draftReviewResponse(
        review.review_id,
        review.rating,
        review.comment,
      );
      drafts.push({ review, draft });
    } catch (err: any) {
      logger.error(
        `[step7] draftReviewResponse failed for ${review.review_id}: ${err.message}`,
        err,
      );
    }
  }

  const metrics = await getReviewMetrics(siteId);
  logger.info(`[step7] Done — ${drafts.length} responses queued`);
  return { metrics, queued: drafts.length };
}

// ── Step 5: Reporting ─────────────────────────────────────────────────
async function step5Reporting(
  siteId: number,
  data: {
    keywords: any;
    schemaData: any;
    competitorData: Array<any>;
    locationsData: any;
  },
  client: Anthropic,
) {
  logger.info(`[step5] Posting weekly digest for site_id=${siteId}...`);

  const {
    keywords,
    schemaData = null,
    competitorData = [],
    locationsData,
  } = data || {};

  if (DRY_RUN) {
    logger.info("[step5] DRY_RUN=true — skipping Slack post and Sheets writes");
    logger.info(
      `[step5] Would post digest with ${(keywords.rankings || []).length} rankings`,
    );
    return;
  }

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

  const locationsInsight = (locationsData.insights || []).map(
    (insight: any) => ({
      name: insight.name,
      city: insight.city,
      views: insight.views,
      searches: insight.searches,
      actions: insight.actions,
    }),
  );

  const prompt = `You are an SEO reporting agent for site_id=${siteId}.

  Here is all data collected this week:

  ## Module 1 — Keyword Performance
  ${JSON.stringify(keywords.rankings?.slice(0, 100), null, 2)}

  ## Module 2 — Schema Gaps
  ${schemaPages.length ? JSON.stringify(schemaPages, null, 2) : "No schema gap data."}
  PAA questions identified: ${paaQuestions.length ? JSON.stringify(paaQuestions.slice(0, 5)) : "None"}

  ## Module 3 — Competitor Intelligence
  Competitors Keyword gaps: ${competitorKeywordGaps.length ? JSON.stringify(competitorKeywordGaps.slice(0, 5), null, 2) : "No gaps identified."}
  Competitors Content gaps: ${competitorContentGaps.length ? JSON.stringify(competitorContentGaps.slice(0, 5), null, 2) : "No content gaps."}
  Competitors Backlinks: ${competitorBacklinks.length ? JSON.stringify(competitorBacklinks.slice(0, 5), null, 2) : "No backlinks."}

  ## Module 4 — Google Business Locations insight
  Insights: ${JSON.stringify(locationsInsight)}

  Please do all of the following in order:
  1. From above data, create a concise summary of key insights and recommendations for next week (bullet points).
  2. For every module, write a recommendation with site_id=${siteId}, module=<module_name>, a concise recommendation from the module data

  Return ONLY a JSON object with keys:
  - summary: string with concise insights and recommendations
  - recommendations: array of objects with module, recommendation_text`;

  logger.info("Prompt Length ", prompt.split(" ").length);

  const response = await callWithRetry(client, "step5", {
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    betas: ["mcp-client-2025-04-04"],
  });

  logger.debug(`[step5] Stop reason: ${response.stop_reason}`);
  logger.debug(`[step5] Usage: `, response.usage);

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
    schemaGaps: (schemaData || {}).pages || [],
    competitorsAlerts: competitorData,
    locationsInsight,
    summary: parsed.summary || "No summary",
  });

  logger.info(`[step5] Done`);
}

// ── Summary Printer ───────────────────────────────────────────────────
function printSummary(errors: StepError, elapsed: number) {
  logger.info(`[weekly] Pipeline complete in ${elapsed.toFixed(1)}s`);
  if (Object.keys(errors).length > 0) {
    for (const [step, msg] of Object.entries(errors)) {
      logger.error(`[weekly] ${step} failed`, { message: msg });
    }
  } else {
    logger.info(`[weekly] All steps succeeded`);
  }
}

interface StepError {
  step1: string;
  step2: string;
  step3: string;
  step4: string;
  step5: string;
  step7: string;
}

// ── Main pipeline ─────────────────────────────────────────────────────
async function runWeeklyTasks(siteId: number) {
  const client: Anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const startTime = Date.now();
  const errors = {} as StepError;

  logger.info(`[weekly] ══════════════════════════════════════════`);
  logger.info(`[weekly] Starting weekly pipeline — site_id=${siteId}`);
  logger.info(`[weekly] ══════════════════════════════════════════`);

  // ── Step 1: Keyword rankings ──────────────────────────────────────
  let keywordData = {};
  try {
    keywordData = await step1KeywordRankings(siteId);
  } catch (exc: any) {
    errors.step1 = exc.message;
    logger.error(`[step1] ERROR: `, exc);
  }

  // ── Step 2: Schema manager ────────────────────────────────────────
  let schemaData = {};
  try {
    schemaData = await step2SchemaManager(siteId);
  } catch (exc: any) {
    errors.step2 = exc.message;
    logger.error(`[step2] ERROR: `, exc);
  }

  // ── Step 3: Competitor intel ──────────────────────────────────────
  let competitorData: any[] = [];
  try {
    competitorData = await step3CompetitorIntel(siteId);
  } catch (exc: any) {
    errors.step3 = exc.message;
    logger.error(`[step3] ERROR: `, exc);
  }

  // ── Step 4: GBP Manager ───────────────────────────────────────────
  let gbpData = {};
  try {
    gbpData = await step4GbpManager(siteId);
  } catch (exc: any) {
    errors.step4 = exc.message;
    logger.error(`[step4] ERROR: `, exc);
  }

  // ── Timeout check ─────────────────────────────────────────────────
  let elapsedSeconds = (Date.now() - startTime) / 1000;
  if (elapsedSeconds > TIMEOUT_SECONDS) {
    logger.warn(
      `\n[weekly] TIMEOUT: pipeline exceeded ${TIMEOUT_SECONDS}s (${elapsedSeconds.toFixed(0)}s elapsed)`,
    );
    printSummary(errors, elapsedSeconds);
    return;
  }

  // ── Step 5: Reporting ─────────────────────────────────────────────
  try {
    await step5Reporting(
      siteId,
      {
        keywords: keywordData,
        schemaData,
        competitorData,
        locationsData: gbpData,
      },
      client,
    );
  } catch (exc: any) {
    errors.step5 = exc.message;
    logger.error(`[step5] ERROR: `, exc);
  }

  // ── Step 7: Reputation Manager ────────────────────────────────────
  // try {
  //   await step7ReputationManager(siteId);
  // } catch (exc: any) {
  //   errors.step7 = exc.message;
  //   logger.error(`[step7] ERROR: `, exc);
  // }

  elapsedSeconds = (Date.now() - startTime) / 1000;
  printSummary(errors, elapsedSeconds);
}

export async function weeklyTasks() {
  logger.info(`[weekly] Fetching configuration from database...`);

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
    sitesCompetitorsConfig[config.site_id] = {
      site_id: config.site_id,
      domain: config.domain || "", // Ensure domain exists if needed by the interface
      competitors_domain: config.competitor_domain,
    };
  });

  logger.info(
    `[weekly] Loaded ${sitesConfig.length} sites. Starting processing...`,
  );

  // Run pipeline for each configured site
  // for (const site of sitesConfig) {
  await runWeeklyTasks(1);
  // }
}
