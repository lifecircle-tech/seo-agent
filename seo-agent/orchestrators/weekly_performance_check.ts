import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";

import * as dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import { renderPrompt, seoAgentModel } from "../prompts/index.js";
import { buildGroundingText, groundOpportunityKeywords } from "../utils/grounding.js";

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
  const prompt = renderPrompt("weekly_performance", {
    pages: JSON.stringify(pages),
    keywords: JSON.stringify(keywords),
  });

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
    model: seoAgentModel(),
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

  // Enforce "do not invent": keep only keywords present in the input data
  return groundOpportunityKeywords<any>(
    parsed,
    buildGroundingText(pages, keywords),
    "weekly_performance",
  );
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
  for (let site of [1, 2]) {
    await runWeeklyPerformanceCheckTasks(site);
  }
}
