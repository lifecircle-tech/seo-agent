import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta.js";
import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";
import { getSheetsClient, getSpreadsheetId } from "../../libs/google.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";
import { upsertKeywords } from "../controllers/keywords.controller.js";
import { createOpportunity } from "../controllers/opportunities.controller.js";
import { listCitiesConfigs } from "../controllers/cities.controller.js";

// MCP Server Imports
import {
  prioritiseKeywords,
  KeywordOpportunity,
  discoverSiteKeywords,
} from "../mcp-servers/keyword-researcher/server.js";
import { postMonthlyDiscoveryToSlack } from "../mcp-servers/reporting/server.js";

// ── Types ─────────────────────────────────────────────────────────────

interface SiteDiscoveryConfig {
  site_id: number;
  domain: string;
  brand_name: string;
  industry: string;
  cities: string[];
}

interface ContentOpportunity {
  title: string;
  topic: string;
  target_keywords: string[];
  reasoning: string;
  priority: "High" | "Medium" | "Low";
}

// ── Config ──────────────────────────────────────────────────
dotenv.config();

const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000]; // milliseconds between retries

// ── Helper ────────────────────────────────────────────────────────────
function extractJson(text: string) {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

// ── Helper ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Appends content opportunities to the "Content Calendar" tab
 */
async function writeToContentCalendar(
  siteId: number,
  opportunities: ContentOpportunity[],
  city: string = "",
) {
  logger.info(`[city] Writing contents to Sheets...`);
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const timestamp = new Date().toISOString().split("T")[0];

  const rows = opportunities.map((opp) => [
    timestamp,
    siteId,
    city,
    opp.title,
    opp.topic,
    opp.target_keywords.join(", "),
    opp.priority,
    opp.reasoning,
    "Planned", // Status
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Content Calendar!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

/**
 * Uses Claude to identify content strategies based on keyword data
 */
async function analyzeWithAI(
  site: Omit<SiteDiscoveryConfig, "cities"> & {
    cities: Array<Record<string, any>>;
  },
  keywords: KeywordOpportunity[],
) {
  const client: Anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const prompt = `You are a world-class SEO strategist.
Analyze these prioritized keywords for ${site.brand_name} (${site.industry}).

Data:
${JSON.stringify(keywords.slice(0, 30), null, 2)}

Task:
- Using the data provided, identify the top 10 content opportunities (blog posts, landing pages, or local guides).

Return ONLY a JSON object with an "opportunities" array.
  - Each object MUST have: "title", "topic", "target_keywords" (array), "reasoning", "priority" ("High"|"Medium"|"Low").
`;

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
    logger.warn(`[city] Could not parse JSON from response`, { raw: text });
    return [];
  }

  logger.info(`[city] Claude analysis complete`);
  return parsed || [];
}

/**
 * Main Discovery Pipeline
 */
async function runMonthlyDiscovery() {
  const startTime = Date.now();

  logger.info(`[monthly-discovery] ══════════════════════════════════════════`);
  logger.info(`[monthly-discovery] Starting Monthly Discovery...`);
  logger.info(`[monthly-discovery] ══════════════════════════════════════════`);

  // 1. Fetch Config from Database
  let { sites } = await listSitesConfigs({ limit: 1000 });
  const { cities } = await listCitiesConfigs({ limit: 100 });

  const detailed_sites = sites.map((site) => {
    const city = cities.filter((city) => city.site_id == site.site_id);
    return {
      ...site,
      cities: city.map((city) => ({
        city: city.city,
        state: city.state,
        country: city.country,
        services: city.services,
        get fullLocation() {
          return `${this.city},${this.state},${this.country}`;
        },
      })),
    };
  });

  const overallSummary: string[] = [];

  // 2. Loop Sites
  const site = detailed_sites[0];

  // for (const site of sites) {
  logger.info(`[site] ${site.domain} (${site.brand_name})`);
  let siteKeywordsTotal = 0;
  let siteOpportunitiesTotal = 0;

  try {
    logger.info(`[city] Researching: ${site.brand_name}...`);

    // Call keyword-researcher MCP logic
    const rawKeywords = await discoverSiteKeywords(site.domain);

    const pages = new Map();

    rawKeywords.map((item) => {
      if (pages.has(item.keyword)) {
        if (item.page) {
          pages.set(item.keyword, [...pages.get(item.keyword), item.page]);
        }
      } else {
        if (item.page) {
          pages.set(item.keyword, [item.page]);
        }
      }
    });
    if (rawKeywords.length > 0) {
      try {
        await upsertKeywords(
          rawKeywords.map((k) => ({
            id: randomUUID(),
            site_id: site.site_id,
            keyword: k.keyword,
            is_new: true,
            search_volume: k.volume ?? null,
            difficulty: k.difficulty ?? null,
            position: k.current_position ?? null,
            clicks: k.clicks,
            impressions: k.impressions,
            ctr: k.ctr,
            cpc: k.cpc ?? null,
            competition: k.competition ?? null,
            competition_level: k.competition_level ?? null,
            monthly_searches: k.monthly_searches || null,
            pages_used: pages.get(k.keyword),
          })),
        );
        logger.info(`[city] Persisted ${rawKeywords.length} keywords to DB`);
      } catch (err) {
        logger.error(`[city] Failed to persist keywords:`, err);
      }
    }

    // const clustered = getKeywordClusters(rawKeywords);
    const prioritised = prioritiseKeywords(rawKeywords);

    siteKeywordsTotal += prioritised.length;

    if (!DRY_RUN) {
      // Write to Keywords Matrix
      // await writeKeywordMatrix(site.site_id, city, prioritised);

      // AI Analysis
      const { opportunities } = await analyzeWithAI(site, prioritised);
      siteOpportunitiesTotal += opportunities.length;

      if (opportunities.length > 0) {
        for (const opp of opportunities) {
          try {
            await createOpportunity({
              id: randomUUID(),
              site_id: site.site_id,
              opportunity_type: "content",
              priority: opp.priority ?? null,
              reasoning: opp.reasoning ?? null,
              opportunity_details: {
                title: opp.title,
                topic: opp.topic,
                target_keywords: opp.target_keywords,
              },
            });
          } catch (err) {
            logger.error(
              `[monthly-discovery] Failed to save opportunity:`,
              err,
            );
          }
        }
        logger.info(
          `[monthly-discovery] Persisted ${opportunities.length} opportunities to DB`,
        );
      }
    }
  } catch (err: any) {
    logger.error(
      `[error] Failed discovery for ${site.brand_name}: ${err.message}`,
    );
  }

  const siteReport = `${site.brand_name}(${site.domain}): Discovered ${siteKeywordsTotal} keywords for ${site.brand_name}. Created ${siteOpportunitiesTotal} content ideas.`;
  overallSummary.push(siteReport);
  logger.info(
    `[monthly-discovery] All Cities for site_id ${site.site_id} Finished`,
  );
  // }

  // 3. Post to Slack
  if (!DRY_RUN) {
    logger.info(`[monthly-discovery] Summary `, overallSummary);

    await postMonthlyDiscoveryToSlack({
      summary: overallSummary,
    });
  }

  const elapsed = (Date.now() - startTime) / 1000;
  logger.info(
    `[monthly-discovery] Finished in ${elapsed.toFixed(1)}s. All Sites Finished.`,
  );
  logger.info(`[monthly-discovery] ══════════════════════════════════════════`);
}

export async function monthlyDiscovery() {
  runMonthlyDiscovery().catch((err) =>
    logger.error(`[monthly-discovery] Fatal error`, err),
  );
}
