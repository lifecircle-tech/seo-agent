import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";
import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";
import { getSheetsClient, getSpreadsheetId } from "../../libs/google.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";
import {
  upsertKeywords,
  getKeywordsAnalytics,
  getSiteKeywords,
} from "../controllers/keywords.controller.js";
import { createOpportunity } from "../controllers/opportunities.controller.js";
import { listCitiesConfigs } from "../controllers/cities.controller.js";
import { bulkUpsertPaaQuestions } from "../controllers/paa.controller.js";
import { getPaaQuestions } from "../services/dataForSEO.service.js";

// MCP Server Imports
import {
  prioritiseKeywords,
  KeywordOpportunity,
  discoverSiteKeywords,
} from "../mcp-servers/keyword-researcher/server.js";
import { postMonthlyDiscoveryToSlack } from "../mcp-servers/reporting/server.js";
import {
  bulkLinkKeywords,
  getPageIdsByUrls,
  upsertPages,
} from "../controllers/page.controller.js";
import { getPageRankings } from "../mcp-servers/keyword-tracker/server.js";
import { getWPPageDetails } from "../services/wordpress.service.js";
import { isUrlRedirected, redirectingToURL } from "../../libs/functions.js";
import { getPagePerformance } from "../services/google.service.js";
import { getCompetitorBySiteId } from "../controllers/competitor.controller.js";
import { getKeywordsGapForCompetitorDomain } from "../mcp-servers/competitor-intel/server.js";
import { createApprovalQueue } from "../mcp-servers/cms-connector/server.js";
import { getStreamedAIResponse } from "../services/anthropic.service.js";

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
  keywords: KeywordOpportunity[],
  pages: any[],
  competitors_keyword_gap: any[],
) {
  const client: Anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  logger.info("Analyzing opportunities by AI...");

  let prompt_keywords = keywords.map((k) => {
    return {
      keyword: k.keyword,
      volume: k.volume,
      difficulty: k.difficulty,
      current_position: k.current_position,
      opportunity_score: k.opportunity_score,
      clicks: k.clicks,
      impressions: k.impressions,
      ctr: k.ctr,
      cpc: k.cpc,
      competition: k.competition_level,
      monthlySearches: k.monthly_searches?.slice(0, 2),
    };
  });

  logger.info("[monthly-discovery] Analyzing all details with AI...", {
    keywords: prompt_keywords.length,
    pages: pages.length,
    competitors: competitors_keyword_gap.length,
  });

  const prompt = `You are an SEO analyst.
You are provide with keywords data, page data and performance data.
Analyze this data to identify concrete opportunities to improve rankings and traffic.

KEYWORD DATA:
${JSON.stringify(prompt_keywords.slice(0, 150))}

PAGE DATA AND SEO PERFORMANCE (pages containing above keywords):
${JSON.stringify(pages)}

COMPETITOR'S KEYWORD GAPS:
${JSON.stringify(competitors_keyword_gap)}

TASK
- Analyze the input using the diagnostic patterns below. For every genuine 
opportunity found, produce one content brief in the output format.
- Cluster related keywords together for content.

DIAGNOSTIC PATTERNS TO CHECK

1. NEW CONTENT NEEDED
  - A keyword or keyword cluster has meaningful search_volume, clear intent, 
  and no page_url currently targeting it (content gap / missing coverage).
  - opportunity_type: "new_content"

2. LOW CTR DESPITE GOOD POSITION
  - Position ≤10 but ctr is well below the expected benchmark for that position 
  (roughly: pos 1-3 expect >10%, pos 4-10 expect 2-5%).
  - opportunity_type: "meta_rewrite"

3. CONTENT DECAY
  - A page shows declining clicks/position versus its own earlier performance, 
  or last_updated is old (9-12+ months) while still receiving meaningful traffic.
  - opportunity_type: "refresh_content"

4. KEYWORD CANNIBALIZATION
  - Multiple pages appear to target the same or very similar keyword, splitting relevance/rankings.
  - opportunity_type: "consolidate_or_differentiate"

PRIORITIZATION
- Assign each action a priority: 1(HIGH), 2(MEDIUM), 3(LOW) based on:
  - 1: high search volume + striking distance, or high impressions with 
    fixable CTR/position issue.
  - 2: moderate volume, content gap, or decay issues.
  - 3: low volume or minor/optional improvements.
- Sort the final output by priority (HIGH first).

Return ONLY a JSON object matching following structure:
{
  opportunities: [
  {
    "opportunity_type": "new_content | meta_rewrite | consolidate_or_differentiate | refresh_content",
    "priority": "1 | 2 | 3 | null",
    "reasoning": 2-3 sentences on WHY this was flagged, citing the specific 
      metric(s) that triggered it, e.g. 'Ranks position 12 for a 
      keyword with 2,400 monthly searches; content covers the 
      topic but lacks depth compared to top-10 pages.' Use null 
      only if no diagnostic rule applied but item is still 
      surfaced for review.,
    "topic": "topic scope for the change" ,
    "description": "Specific, actionable instruction written as a direct 
      command — specific enough that a content-writing agent 
      could execute it without asking a clarifying question.",
    "opportunity_details": {
      "title": "page title",
      "url": "{page_url}",
      "target_keywords": ["keyword1", "keyword2"],

      // ADD fields below based on opportunity_type — only include the ones 
      // relevant to that type, omit the rest:

      // new_content
      "title": "suggested page title", // overwrite for new_content
      "type": "type of page", // 'post' or 'page' for wordpress page

      // consolidate_or_differentiate:
      "competing_urls": ["url1", "url2"],
      "recommended_primary_url": "{url}",

      // refresh_content:
      "last_updated": "{date}",
      "sections_to_update": ["section name 1", "section name 2"],
      "type": "current type of page (type)"
    }
  }
  ]
}

"target_keywords": mention primary keyword as first element of the array followed by secondary keywords

CONSTRAINTS
- Do not combine keywords for different city
- Do not fabricate metrics or keywords not present in the input.
- Do not generate speculative opportunities unsupported by the data.
- Do not exceed 20 opportunities per run; if more exist, include only the 
  top 20 by priority.
- Sort the array by priority (1 first, then 2, then 3).
- If no genuine opportunities are found, return an empty array: []
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

  logger.debug(`[monthly-discovery] Stop reason: ${response.stop_reason}`);
  logger.debug(`[monthly-discovery] Usage: `, response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const parsed = extractJson(text);
  if (!parsed) {
    logger.warn(`[monthly-discovery] Could not parse JSON from response`, {
      raw: text,
    });
    return [];
  }

  logger.info(`[monthly-discovery] Claude analysis complete`);
  return parsed || [];
}

async function updateNewUrlAndLinkKeywords(
  site: any,
  pagesMap: Map<string, string[]>,
) {
  const { keywords: allKeywords } = await getSiteKeywords({
    site_id: site.site_id,
    limit: 1000,
  });
  const keywordIdMap = new Map(
    allKeywords.map((k) => [k.keyword.toLowerCase(), k.id]),
  );

  const uniqueUrls = new Set<string>();
  for (const pages of pagesMap.values()) {
    for (const u of pages) uniqueUrls.add(u);
  }

  if (uniqueUrls.size > 0) {
    try {
      await upsertPages(
        [...uniqueUrls].map((url) => ({
          id: randomUUID(),
          site_id: site.site_id,
          url,
        })),
      );
      logger.info(`[monthly-discovery] Upserted ${uniqueUrls.size} page(s)`);
    } catch (err) {
      logger.error(`[monthly-discovery] Failed to upsert pages:`, err);
    }

    // 6. Resolve URL → page_id, then bulk-link keywords to pages with metrics
    try {
      const urlToPageId = await getPageIdsByUrls(site.site_id, [...uniqueUrls]);
      const links: Array<{
        page_id: string;
        keyword_id: string;
        site_id: number;
        position: number | null;
        clicks: number | null;
        impressions: number | null;
        ctr: number | null;
      }> = [];

      for (const [keyword, pages] of pagesMap) {
        const keywordId = keywordIdMap.get(keyword);
        if (!keywordId) continue;

        const { pages: rank_pages } = await getPageRankings(
          site.domain,
          keyword,
        );
        const matched_page = rank_pages
          ?.filter((p) => !!p.url)
          .find((p) => pages.includes(p.url as string));

        for (const url of pages) {
          const pageId = urlToPageId.get(url);
          if (!pageId) continue;
          links.push({
            page_id: pageId,
            keyword_id: keywordId,
            site_id: site.site_id,
            position: matched_page?.position ?? null,
            clicks: matched_page?.clicks ?? null,
            impressions: matched_page?.impressions ?? null,
            ctr: null, // GSC page-level endpoint does not return CTR per keyword
          });
        }
      }

      if (links.length > 0) {
        await bulkLinkKeywords(links);
        logger.info(
          `[monthly-discovery] Linked ${links.length} keyword-page pair(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `[monthly-discovery] Failed to link keywords to pages:`,
        err,
      );
    }
  }
}

async function getPagesDetails(site: any, pagesMap: Map<string, string[]>) {
  const uniqueUrls = new Set<string>();
  for (const pages of pagesMap.values()) {
    for (const u of pages) uniqueUrls.add(u);
  }

  let pages = [];

  logger.info(`Getting Page details for ${uniqueUrls.size} pages`);

  for (let url of uniqueUrls.keys()) {
    const wp_page = await getWPPageDetails(site.site_id, url);

    if (wp_page) {
      const page_performance = await getPagePerformance(site.domain, url);
      const is_redirecting = await isUrlRedirected(wp_page.url);

      pages.push({
        url: wp_page.url,
        title: wp_page.title,
        meta_description: wp_page.meta_description,
        last_modified: wp_page.last_modified,
        target_keywords: [
          wp_page.primary_keywords,
          ...wp_page.secondary_keywords,
        ],
        canonical_to: wp_page.canonical_url,
        is_redirecting_url: is_redirecting,
        ...(is_redirecting
          ? {
              redirected_to: await redirectingToURL(wp_page.url),
            }
          : null),
        page_performance: page_performance?.[0],
      });
    }
  }

  return pages;
}

/**
 * Main Discovery Pipeline
 */
async function runMonthlyDiscovery() {
  const startTime = Date.now();
  const reportText = [] as string[];

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
  let site = detailed_sites.find((s) => s.site_id == 1) as any;

  // for (const site of sites) {
  logger.info(`[site] ${site.domain} (${site.brand_name})`);
  let siteKeywordsTotal = 0;
  let siteOpportunitiesTotal = 0;

  try {
    logger.info(`[city] Researching: ${site.brand_name}...`);

    // Finding competitors keywords gap
    const competitor_config = await getCompetitorBySiteId(site.site_id);
    let competitors_keywords_gap: any[] = [];

    if (competitor_config) {
      const keywordGaps = await getKeywordsGapForCompetitorDomain(
        competitor_config.site_id,
        competitor_config?.domain as string,
        competitor_config.competitor_domain,
      );

      competitors_keywords_gap = keywordGaps.map(
        ({ competitor_domain, gaps }) => ({
          competitor_domain,
          keywords: gaps,
        }),
      );
    }

    // Call keyword-researcher MCP logic
    const rawKeywords = await discoverSiteKeywords(site.domain, site.cities);
    const pagesMap = new Map();

    rawKeywords.map((item) => {
      if (pagesMap.has(item.keyword)) {
        if (item.page) {
          pagesMap.set(item.keyword, [
            ...pagesMap.get(item.keyword),
            item.page,
          ]);
        }
      } else {
        if (item.page) {
          pagesMap.set(item.keyword, [item.page]);
        }
      }
    });

    if (!DRY_RUN) {
      if (rawKeywords.length > 0) {
        try {
          await upsertKeywords(
            rawKeywords.map((k) => ({
              id: randomUUID(),
              site_id: site.site_id,
              keyword: k.keyword,
              is_new: pagesMap.get(k.keyword) ? false : true,
              search_volume: k.volume ?? null,
              difficulty: k.difficulty ?? null,
              position: k.current_position ?? null,
              clicks: k.clicks,
              impressions: k.impressions,
              ctr: k.ctr,
              cpc: k.cpc,
              competition: k.competition ?? null,
              competition_level: k.competition_level ?? null,
              monthly_searches: k.monthly_searches || null,
            })),
          );
          logger.info(`[city] Persisted ${rawKeywords.length} keywords to DB`);
        } catch (err) {
          logger.error(`[city] Failed to persist keywords:`, err);
        }
      }

      await updateNewUrlAndLinkKeywords(site, pagesMap);

      // const clustered = getKeywordClusters(rawKeywords);
      const prioritised = prioritiseKeywords(rawKeywords);
      const pagesDetails = await getPagesDetails(site, pagesMap);

      siteKeywordsTotal += prioritised.length;

      // AI Analysis
      const { opportunities } = await analyzeWithAI(
        prioritised,
        pagesDetails,
        competitors_keywords_gap,
      );
      siteOpportunitiesTotal += opportunities.length;

      if (opportunities.length > 0) {
        // ── PAA Discovery ──────────────────────────────────────────────
        // Collect target keywords across all opportunities,
        // fetch their PAA questions, and persist before creating opportunities.
        try {
          const allTargetKeywords = Array.from(
            new Set<string>(
              opportunities.flatMap(
                (opp: any) => opp.target_keywords as string[],
              ),
            ),
          );

          // Resolve keyword text → DB id for junction FK
          const keywords = await getKeywordsAnalytics(
            rawKeywords.map((k) => k.keyword),
          );
          const kwIdMap = new Map(
            keywords.map((k) => [k.keyword.toLowerCase(), k.id]),
          );

          logger.info(
            `[monthly-discovery] Fetching PAA for ${allTargetKeywords.length} opportunity keywords...`,
          );

          const paaItems: Parameters<typeof bulkUpsertPaaQuestions>[0] = [];

          await Promise.all(
            allTargetKeywords.map(async (kwText) => {
              try {
                const results = await getPaaQuestions(kwText);
                const keywordId = kwIdMap.get(kwText.toLowerCase());
                if (!keywordId) return; // keyword not in DB yet — skip
                for (const r of results) {
                  paaItems.push({
                    id: randomUUID(),
                    site_id: site.site_id,
                    keyword_id: keywordId,
                    question: r.question,
                    answer: r.answer,
                    source_url: r.source_url,
                    category: null,
                  });
                }
              } catch (err: any) {
                logger.warn(
                  `[monthly-discovery] PAA fetch failed for "${kwText}": ${err.message}`,
                );
              }
            }),
          );

          if (paaItems.length > 0) {
            await bulkUpsertPaaQuestions(paaItems);
            logger.info(
              `[monthly-discovery] Persisted ${paaItems.length} PAA questions to DB`,
            );
            reportText.push(`    - Found ${paaItems.length} PAA opportunities`);
          }
        } catch (err) {
          logger.error(`[monthly-discovery] PAA discovery failed:`, err);
        }

        for (const opp of opportunities) {
          try {
            if (opp.opportunity_type === "consolidate_or_differentiate") {
              await createApprovalQueue([
                {
                  site_id: site.site_id,
                  module: "cms-connector",
                  type: "canonical",
                  priority: opp.priority,
                  title: opp.opportunity_details.title,
                  original_content: {
                    url: opp.opportunity_details.url,
                    keywords: opp.opportunity_details.target_keywords,
                    current_title: opp.opportunity_details.title,
                  },
                  suggested_content: {
                    recommended_primary_url:
                      opp.opportunity_details.recommended_primary_url,
                    competing_urls: opp.opportunity_details.competing_urls,
                  },
                  reason: opp.reasoning,
                  preview_url: opp.opportunity_details.url,
                },
              ]);
            } else {
              await createOpportunity({
                id: randomUUID(),
                site_id: site.site_id,
                opportunity_type: opp.opportunity_type,
                priority: opp.priority ?? null,
                reasoning: opp.reasoning ?? null,
                topic: opp.topic,
                description: opp.content_description,
                opportunity_details: {
                  title: opp.title,
                  target_keywords: opp.target_keywords,
                  type: opp.opportunity_type,
                },
              });
            }
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

  const siteReport = `${site.brand_name} (${site.domain}):
    - Discovered ${siteKeywordsTotal} keywords.
    - Created ${siteOpportunitiesTotal} content ideas.
    ${reportText.join("\n")}`;
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
