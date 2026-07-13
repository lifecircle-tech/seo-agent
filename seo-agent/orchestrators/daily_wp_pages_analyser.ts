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
  createApprovalQueue,
  getPage,
  getPagesWithHighImpressionLowCtr,
} from "../mcp-servers/cms-connector/server.js";

// ── Types ─────────────────────────────────────────────────────────────

interface SitesConfig {
  site_id: number;
  domain: string;
  brand_name: string;
  industry: string;
  cities: string[];
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

// ── Step 1: CMS Connector ─────────────────────────────────────────────
async function step1CmsConnector(client: Anthropic, siteId: number) {
  logger.info(`[step1] Analyzing low-CTR pages for site_id=${siteId}...`);
  const site = sitesConfig.find((site) => site.site_id === siteId);

  const impressionsVsCtr = await getPagesWithHighImpressionLowCtr(
    siteId,
    site?.domain as string,
    28,
  );
  const pages: any[] = [];
  for await (const row of impressionsVsCtr) {
    const page = await getPage(siteId, row.url);
    if (page) {
      pages.push({ ...page, ...row });
    }
  }

  if (pages.length === 0) {
    logger.warn(`[step1] No pages found for site_id=${siteId}.`);
    return { opportunities: [], summary: "No pages identified." };
  }

  const promptPages = pages.map((page) => ({
    id: page.id,
    primary_keyword: page.primary_keyword,
    secondary_keywords: page.secondary_keywords,
    title: page.title,
    meta_description: page.meta_description,
  }));

  const prompt = `You are an SEO content analyst for site '${site?.brand_name}'.
  Here are the rules for SEO content:
  - primary keywords must be present in title
  - primary keywords must be present in meta description

  ${JSON.stringify(promptPages, null, 2)}

  For each page from data above, follow the rules
  - write an improved title (max 60 chars) and meta description (max 155 chars)

  Return ONLY a JSON object with keys:
  - opportunities: array of objects with id, suggested_title, suggested_description, reasoning (detailed reason with impact), priority (1-3 based on potential impact)
  - summary: string with 2-3 overall action items

  Do NOT omit any pages.
  Do NOT include about rules in reasoning, mention impacting reason.
  No extra text.`;

  const response = await callWithRetry(client, "step1", {
    model: "claude-sonnet-4-6",
    max_tokens: 15000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    betas: ["mcp-client-2025-04-04"],
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
    parsed.opportunities.map((opp: any) => {
      const page = pages.find((p: any) => p.id === opp.id);
      return {
        site_id: siteId,
        module: "cms-connector",
        type: "meta_rewrite",
        priority: opp.priority,
        title: page.title,
        original_content: {
          focus_keywords: page.secondary_keywords,
          url: page.url,
          type: page.type,
          current_title: page.title,
          current_description: page.meta_description,
        },
        suggested_content: {
          type: page.type,
          suggested_title: opp.suggested_title,
          suggested_description: opp.suggested_description,
          reasoning: opp.reasoning,
        },
        preview_url: page.url,
      };
    }),
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
  const client: Anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const startTime = Date.now();
  const errors = {} as StepError;

  logger.info(`[daily_page_meta] ══════════════════════════════════════════`);
  logger.info(`[daily_page_meta] Starting Daily WP Pages meta analyzer pipeline — site_id=${siteId}`);
  logger.info(`[daily_page_meta] ══════════════════════════════════════════`);

  // ── Step 1: CMS connector — low-CTR page analysis ────────────────
  let cmsData = {};
  try {
    cmsData = await step1CmsConnector(client, siteId);
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
  const [sitesRes] = await Promise.all([
    listSitesConfigs({ limit: 1000 }),
  ]);

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