import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";

import * as dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

import {
  getStreamedAIResponse,
} from "../services/anthropic.service.js";

import { createApprovalQueue } from "../mcp-servers/cms-connector/server.js";

import { getPagesAndKeywords } from "../controllers/page.controller.js";
import { createOpportunity } from "../controllers/opportunities.controller.js";
import { redirectingToURL, isUrlRedirected } from "../../libs/functions.js";
import { getWPPageDetails } from "../services/wordpress.service.js";

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000]; // milliseconds between retries

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

async function getPagesWithKeywords(siteId: number) {
  const pages = await getPagesAndKeywords(siteId);

  const new_pages = [] as any[];
  let keywords = [] as any[];
  const keywordsMap = new Map();

  for await (let page of pages) {
    try {
      JSON.parse(page.keywords);
    } catch {
      logger.error("[weekly_performance] page keywords \n", page.url);
      continue;
    }

    const page_keywords =
      typeof page.keywords == "string"
        ? JSON.parse(page.keywords)
        : page.keywords;
    const wp_page = await getWPPageDetails(siteId, page.url);

    if (!wp_page) {
      continue;
    }

    const is_redirecting = await isUrlRedirected(wp_page.url);

    new_pages.push({
      type: page.type,
      url: page.url,
      title: wp_page?.title,
      meta_description: wp_page?.meta_description,
      last_modified: wp_page?.last_modified,
      clicks: page.clicks,
      impressions: page.impressions,
      avg_position: page.position,
      ctr: (page.clicks / page.impressions) * 100,
      canonical_to: wp_page.canonical_url,
      is_redirecting_url: is_redirecting,
      ...(is_redirecting
        ? {
            redirected_to: await redirectingToURL(wp_page.url),
          }
        : null),
    });

    for (let keyword of page_keywords.slice(0, 5)) {
      if (keywordsMap.has(keyword.keyword)) {
        let temp_keyword = keywordsMap.get(keyword.keyword);
        temp_keyword = {
          ...temp_keyword,
          page_urls: [...temp_keyword.page_urls, page.url],
        };
        keywordsMap.set(keyword.keyword, temp_keyword);
      } else {
        keywordsMap.set(keyword.keyword, {
          page_urls: [page.url],
          keyword: keyword.keyword,
          search_volume: keyword.search_volume,
          position: keyword.position,
          clicks: keyword.clicks,
          impressions: keyword.impressions,
          ctr: (keyword.clicks / keyword.impressions) * 100,
          keyword_difficulty: keyword.difficulty,
        });
      }
    }
  }
  keywords = [...keywordsMap.values()];

  return {
    pages: new_pages,
    keywords,
  };
}

async function analyzeWithAI(pages: any[], keywords: any[]) {
  const prompt = `
  You are an SEO analyst agent. Your job is to analyze page-level and keyword-level 
performance data and output a prioritized, structured list of specific actions to 
improve rankings, traffic, and CTR.
 
Your output will be consumed programmatically by another AI agent that executes 
content changes. Therefore:
- Every action must be specific and unambiguous (no vague advice like "improve content").
- Every action must reference the exact page URL and/or keyword it applies to.
- Output must strictly follow the schema provided — no extra commentary outside it.

PAGE METRICS:
${JSON.stringify(pages)};

KEYWORD METRICS:
${JSON.stringify(keywords)};

Analyze the provided PAGE METRICS and KEYWORD METRICS together. For each page, 
identify opportunities and problems using the diagnostic rules below, then 
generate a prioritized action list.

DIAGNOSTIC RULES — check each page/keyword against these patterns:

1. STRIKING DISTANCE KEYWORDS
  - Keyword ranks position 8-20 with decent search volume (>100/mo).
  - Action type: "optimize_content" — recommend specific on-page changes
    (add keyword to H2, expand section, add FAQ) to push into top 10.

2. LOW CTR DESPITE GOOD POSITION
  - Position ≤10 but CTR is below expected benchmark for that position 
    (roughly: pos 1-3 expect >10% CTR, pos 4-10 expect 2-5%).
  - Action type: "meta_rewrite" — recommend new title tag / meta description 
    with stronger hook, numbers, or clarity.

3. HIGH IMPRESSIONS, LOW CLICKS/RANKING
  - Impressions high but position >20 or clicks near zero.
  - Action type: "content_gap" — page may be thin, off-intent, or missing the 
    keyword; recommend rewriting or expanding relevant section.

4. KEYWORD CANNIBALIZATION
  - Same/similar keyword appears across multiple page_urls with split rankings.
  - Action type: "consolidate_or_differentiate" — recommend merging pages or 
    clearly differentiating target keyword per page.

5. CONTENT DECAY
  - Page traffic/position declining and last_updated is old (>6-9 months) 
    relative to publish norms in the data.
  - Action type: "refresh_content" — recommend updating stats, examples, 
    sections; specify what to check/update.

PRIORITIZATION
- Assign each action a priority: 1(HIGH), 2(MEDIUM), 3(LOW) based on:
  - 1: high search volume + striking distance, or high impressions with 
    fixable CTR/position issue.
  - 2: moderate volume, content gap, or decay issues.
  - 3: low volume or minor/optional improvements.
- Sort the final output by priority (HIGH first).

OUTPUT FORMAT
Return ONLY a valid JSON array matching this schema — no prose before or after, 
no markdown code fences:

[
  {
    "opportunity_type": "optimize_content | meta_rewrite | content_gap | 
      consolidate_or_differentiate | refresh_content",
    "priority": "1 | 2 | 3 | null",
    "reasoning": "2-3 sentences on WHY this was flagged, citing the specific 
      metric(s) that triggered it, e.g. 'Ranks position 12 for a 
      keyword with 2,400 monthly searches; content covers the 
      topic but lacks depth compared to top-10 pages.' Use null 
      only if no diagnostic rule applied but item is still 
      surfaced for review.",
    "topic": "topic scope for the change",
    "description": "Specific, actionable instruction written as a direct 
      command — specific enough that a content-writing agent 
      could execute it without asking a clarifying question. 
      E.g. 'Add a new H2 section titled \"Cost of X vs Y\" 
      covering pricing comparison; include target keyword 
      naturally 2-3 times. Target 300-400 additional words.'",
    "opportunity_details": {
      "title": "current or suggested page title",
      "url": "{page_url}",
      "target_keywords": ["keyword1", "keyword2"],

      // ADD fields below based on opportunity_type — only include the ones 
      // relevant to that type, omit the rest:

      // optimize_content:
      "current_position": {value},
      "target_position_range": "1-10",
      "type": "current type of page (type)"

      // content_gap:
      "current_word_count": {value},
      "impressions": {value},
      "clicks": {value},
      "type": "current type of page (type)"

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

CONSTRAINTS
- Do not invent metrics not present in the input.
- If data is insufficient to diagnose an issue, do not fabricate — omit that 
  opportunity or use "monitor" with "monitor_reason" explaining what's missing.
- Every "description" must be specific enough that a content-writing agent could 
  execute it without asking a clarifying question.
- Only include the opportunity_details sub-fields relevant to that opportunity_type 
  — do not include fields from other types, and do not leave irrelevant fields 
  as null clutter.
- Do not exceed 10 opportunities per run. If more exist, include only the top 10 
  by priority.
- Sort the array by priority: HIGH first, then MEDIUM, then LOW, then null.
`;

  // expand_content | realign_intent | monitor

  // 6. THIN CONTENT
  //    - word_count is low relative to top-ranking competitors for that keyword's
  //      intent (informational keywords generally need more depth).
  //    - Action type: "expand_content" — specify which subtopics/sections to add.

  // 7. MISSING INTENT MATCH
  //    - search_intent suggests transactional/commercial but content reads as
  //      purely informational (or vice versa).
  //    - Action type: "realign_intent" — recommend structural/content changes to
  //      match intent (e.g., add comparison table, CTA, pricing info).

  // 8. UNDERPERFORMING NEW CONTENT
  //    - Recently published (<3 months) but zero/low movement — flag as "monitor"
  //      rather than urgent action, unless a clear technical/on-page issue exists.

  // // expand_content:
  // "sections_to_add": ["subtopic 1", "subtopic 2"],
  // "target_word_count_increase": {value},

  // // realign_intent:
  // "current_intent": "informational | commercial | transactional | navigational",
  // "target_intent": "informational | commercial | transactional | navigational",

  // // monitor:
  // "monitor_reason": "why this is being watched rather than acted on now",
  // "recheck_after_days": {value}

  const response = await callWithRetry("[weekly_performance]", {
    model: "claude-sonnet-5",
    max_tokens: 40000,
    messages: [{ role: "user", content: prompt }],
  });

  logger.debug(`[weekly_performance] Stop reason: ${response.stop_reason}`);
  logger.debug(`[weekly_performance] Usage: `, response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const parsed = extractJson(text);
  return parsed;
}

async function runWeeklyPerformanceCheckTasks(siteId: number) {
  const startTime = Date.now();

  logger.info(
    `[weekly_performance] ══════════════════════════════════════════`,
  );
  logger.info(
    `[weekly_performance] Starting weekly Performance Check pipeline`,
  );
  logger.info(
    `[weekly_performance] ══════════════════════════════════════════`,
  );

  try {
    const { keywords, pages } = await getPagesWithKeywords(siteId);

    logger.info(
      "[weekly_performance] Analyzing information and preparing actions",
    );

    const opportunities = await analyzeWithAI(pages, keywords);

    for (let opp of opportunities) {
      if (opp.opportunity_type === "meta_rewrite") {
        // create opportunity
        await createOpportunity({
          ...opp,
          id: randomUUID(),
          site_id: siteId,
        });
        logger.info(
          `[create_opportunity_queue] Opportunity created : ${opp.topic}`,
        );
      } else if (opp.opportunity_type === "consolidate_or_differentiate") {
        // create approvals
        await createApprovalQueue([
          {
            site_id: siteId,
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
          ...opp,
          id: randomUUID(),
          site_id: siteId,
        });
        logger.info(
          `[create_opportunity_queue] Opportunity created : ${opp.topic}`,
        );
      }
    }
  } catch (error: any) {
    logger.error(`[weekly_performance] Error : ${error.message}`, error);
  }
  // ── Timeout check ─────────────────────────────────────────────────
  let elapsedSeconds = (Date.now() - startTime) / 1000;

  logger.info(
    `[weekly_performance] Pipeline complete in ${elapsedSeconds.toFixed(1)}s`,
  );
}

export async function weeklyPerformanceCheck() {
  await runWeeklyPerformanceCheckTasks(1);
}
