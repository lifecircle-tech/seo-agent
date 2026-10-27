import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";

import * as dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import { renderPrompt, seoAgentModel } from "../prompts/index.js";
import {
  findRankingPagesForKeywords,
  getMetaRewriteBlocks,
  normalizeUrl,
} from "../services/seo-guards.service.js";

import { OpportunityJSON } from "../models/opportunities.model.js";
import {
  getPlannedOpportunitiesByType,
  ignoreOpportunity,
  updateOpportunity,
  updateStatusToCompleted,
} from "../controllers/opportunities.controller.js";
import { listSitesConfigs } from "../controllers/sites.controller.js";
import {
  createApproval,
  getMetaRewriteApprovedApprovalByUrl,
} from "../controllers/approvals.controller.js";
import {
  createNewPageContent,
  createPageContent,
  getAcknowledgedPageByUrl,
  updatePageContentBody,
} from "../controllers/page-content.controller.js";

import {
  getAllWPPages,
  getWPPageDetails,
} from "../services/wordpress.service.js";
import {
  getKeywordPerformance,
  getPagePerformance,
} from "../services/google.service.js";
import { getPaaQuestions } from "../services/dataForSEO.service.js";
import { getPageContent } from "../services/page-content.service.js";
import {
  getPaaQuestionsByQuestions,
  markPaaQuestionsAsUsed,
} from "../controllers/paa.controller.js";
import { getKeywordRankings } from "../mcp-servers/keyword-tracker/server.js";
import { upsertKeywords } from "../controllers/keywords.controller.js";
import { getAIResponse } from "../services/anthropic.service.js";

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

const OPPORTUNITY_LIMIT = 5;
/** An existing page with this many impressions (or a top-30 position) already "owns" a keyword. */
const EXISTING_PAGE_MIN_IMPRESSIONS = 10;
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJson(text: string) {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

async function callWithRetry(
  label: string,
  params: MessageCreateParamsNonStreaming,
): Promise<Message> {
  let lastExc: Error = new Error("No attempts made");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await getAIResponse(label, params);
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

async function getResponse(label: string, prompt: string) {
  const response = await callWithRetry(label, {
    model: seoAgentModel(),
    max_tokens: 15000,
    messages: [{ role: "user", content: prompt }],
  });

  logger.debug(`[${label}] Stop reason: ${response.stop_reason}`);
  logger.debug(`[${label}] Usage: `, response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return extractJson(text);
}

// ── meta_rewrite ──────────────────────────────────────────────────────
async function processMetaRewriteOpportunity(
  opp: OpportunityJSON,
  site: { site_id: number; domain: string; brand_name: string },
) {
  const details = opp.opportunity_details ?? {};
  const url: string = details.url;
  const targetKeywords: string[] = details.target_keywords ?? [];

  // Cooldown: don't rewrite the same page's title/description again too soon
  const blockReason = (await getMetaRewriteBlocks(opp.site_id)).get(normalizeUrl(url));
  if (blockReason) {
    await ignoreOpportunity(opp.id, "agent", `Skipped by agent: ${blockReason}`);
    logger.info(`[daily_opportunity_tasks] meta_rewrite skipped for ${url}: ${blockReason}`);
    return;
  }

  const wpPage = await getWPPageDetails(opp.site_id, url);
  if (!wpPage) {
    logger.warn(`[daily_opportunity_tasks] Page not found for URL: ${url}`);
    return;
  }

  const pagePerformance = await getPagePerformance(site.domain, url);
  const keywordPerformance = (
    await Promise.all(
      targetKeywords.map((keyword) =>
        getKeywordPerformance(site.domain, keyword),
      ),
    )
  ).flat();

  const prompt = renderPrompt("opportunity_meta_rewrite", {
    brand_name: site.brand_name,
    page_details: JSON.stringify({
  url: wpPage.url,
  type: wpPage.type,
  current_title: wpPage.title,
  current_meta_description: wpPage.meta_description,
  last_modified: wpPage.last_modified,
  target_keywords: targetKeywords,
  canonical_to: wpPage.canonical_url,
}),
    page_performance: JSON.stringify(pagePerformance),
    keyword_performance: JSON.stringify(keywordPerformance),
    reason_flagged: opp.reasoning,
    suggested_focus: opp.description,
  });

  const response = await getResponse("daily_opportunity.meta_rewrite", prompt);
  if (!response) {
    logger.warn(
      `[daily_opportunity_tasks] Could not parse AI response for meta_rewrite opp=${opp.id}`,
    );
    return;
  }

  const last_updated_at = await getMetaRewriteApprovedApprovalByUrl(
    wpPage.url as string,
  );

  await createApproval({
    id: randomUUID(),
    site_id: opp.site_id,
    module: "cms-connector",
    type: "meta_rewrite",
    priority: response.priority,
    title: wpPage.title,
    original_content: {
      url: wpPage.url,
      type: wpPage.type,
      focus_keywords: targetKeywords,
      current_title: wpPage.title,
      current_description: wpPage.meta_description,
      last_updated_at: last_updated_at?.actioned_at,
    },
    updated_content: {
      url: wpPage.url,
      type: wpPage.type,
      suggested_title: response.suggested_title,
      suggested_description: response.suggested_description,
    },
    reason: response.reasoning ?? opp.reasoning,
    update_page: false,
    preview_url: wpPage.url as string,
  });

  await updateStatusToCompleted(opp.id, "agent");
  logger.info(
    `[daily_opportunity_tasks] meta_rewrite approval created for ${wpPage.url}`,
  );
}

// ── refresh_content ──────────────────────────────────────────────────
async function processRefreshContentOpportunity(
  opp: OpportunityJSON,
  site: { site_id: number; domain: string; brand_name: string },
  sitePages: any[],
) {
  const details = opp.opportunity_details ?? {};
  const url: string = details.url;
  const targetKeywords: string[] = details.target_keywords ?? [];

  let wpPage = await getWPPageDetails(opp.site_id, url);
  if (!wpPage) {
    logger.warn(`[daily_opportunity_tasks] Page not found for URL: ${url}`);
    return;
  }

  const pageType: "post" | "page" =
    (wpPage.type ?? details.type) === "post" ? "post" : "page";

  const pagePerformance = await getPagePerformance(site.domain, url);
  const keywordPerformance = (
    await getKeywordRankings(site.site_id, site.domain, targetKeywords)
  ).rankings.flat();

  await upsertKeywords(
    keywordPerformance.map((r) => {
      return {
        id: randomUUID(),
        site_id: site.site_id,
        keyword: r.keyword,
        is_new: false,
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position ?? null,
        ctr: r.ctr,
        search_volume: r.volume ?? null,
        difficulty: r.difficulty ?? null,
        cpc: r.cpc ?? null,
        competition: r.competition ?? null,
        competition_level: r.competition_level ?? null,
        monthly_searches: r.monthly_searches ?? null,
      };
    }),
  );

  let paaQuestions: any[] = (
    await Promise.all(targetKeywords.map((keyword) => getPaaQuestions(keyword)))
  ).flat();

  const paaFromRecords = await getPaaQuestionsByQuestions(
    paaQuestions.map((q) => q.question),
  );

  const currentContent = await getPageContent(opp.site_id, url, pageType);

  const contentInstruction =
    pageType === "post"
      ? renderPrompt("refresh_content_post_instruction")
      : renderPrompt("refresh_content_page_instruction");

  const prompt = renderPrompt("refresh_content", {
    brand_name: site.brand_name,
    current_content: currentContent,
    page_details: JSON.stringify({
  url: wpPage.url,
  type: pageType,
  current_title: wpPage.title,
  last_modified: wpPage.last_modified,
  target_keywords: targetKeywords,
  canonical_to: wpPage.canonical_url,
}),
    page_performance: JSON.stringify(pagePerformance),
    keyword_performance: JSON.stringify(keywordPerformance),
    paa_questions: JSON.stringify(paaQuestions.map((q) => q.question).slice(0, 8)),
    site_pages: JSON.stringify(sitePages),
    reason_flagged: opp.reasoning,
    suggested_focus: opp.description,
    sections_to_update: JSON.stringify(details.sections_to_update ?? []),
    content_instruction: contentInstruction,
  });

  const response = await getResponse(
    "daily_opportunity.refresh_content",
    prompt,
  );
  logger.debug(
    "[daily_opportunity_tasks] Content generation complete",
    response.source,
  );

  if (!response) {
    logger.warn(
      `[daily_opportunity_tasks] Could not parse AI response for refresh_content opp=${opp.id}`,
    );
    return;
  }

  const keywords_analytics = keywordPerformance.map((keyword) => ({
    keyword: keyword.keyword,
    cpc: keyword.cpc,
    search_volume: keyword.volume,
    position: keyword?.position ?? null,
    clicks: keyword?.clicks ?? 0,
    impressions: keyword?.impressions ?? 0,
    ctr: keyword?.ctr ?? 0,
  }));

  // Mark PAA as used
  const used_paa = response.paa;
  const paaInRecords = paaFromRecords.filter((q) =>
    used_paa.includes(q.question),
  );
  markPaaQuestionsAsUsed(paaInRecords.map((q) => q.id));
  // TODO: Add New PAA in records with keywords

  const page = await getAcknowledgedPageByUrl(url);

  const record = await createPageContent({
    id: randomUUID(),
    site_id: opp.site_id,
    url: wpPage.url as string,
    page_meta_details: {
      page_type: pageType,
      page_title: wpPage.title,
      meta_description: wpPage.meta_description,
      keywords: targetKeywords,
    },
    keywords_analytics,
    update_details: {
      previous_updated_at: page?.acknowledged_at,
    },
  });

  await updatePageContentBody(
    record.id,
    response.suggested_content,
    response.reasoning,
  );

  await updateStatusToCompleted(opp.id, "agent");
  logger.info(
    `[daily_opportunity_tasks] refresh_content page-content created for ${wpPage.url}`,
  );
}

// ── refresh_content ──────────────────────────────────────────────────
async function processNewContentOpportunity(
  opp: OpportunityJSON,
  site: { site_id: number; domain: string; brand_name: string },
  sitePages: any[],
) {
  const details = opp.opportunity_details ?? {};
  const url: string = details.url;
  const targetKeywords: string[] = details.target_keywords ?? [];

  let wpPage = await getWPPageDetails(opp.site_id, url);
  if (wpPage) {
    logger.warn(
      `[daily_opportunity_tasks] Page already exists for URL: ${url}`,
    );
    // Previously left 'planned' and retried every day
    await ignoreOpportunity(opp.id, "agent", `Skipped by agent: a page already exists at ${url}`);
    return;
  }

  // Cannibalisation guard: if an existing page already ranks for the primary keyword,
  // strengthen that page instead of creating another one competing for the same search.
  const primaryKeyword = targetKeywords[0];
  const existing = (await findRankingPagesForKeywords(opp.site_id, primaryKeyword ? [primaryKeyword] : []))
    .find((p) => p.impressions >= EXISTING_PAGE_MIN_IMPRESSIONS || (p.position != null && p.position <= 30));
  if (existing) {
    const note = `Converted by agent: "${existing.keyword}" already ranks on ${existing.url} (position ${existing.position ?? "?"}, ${existing.impressions} impressions) — improving that page instead of creating a competing one.`;
    await updateOpportunity(opp.id, {
      opportunity_type: "refresh_content",
      description: `${note}\n\n${opp.description ?? ""}`.trim(),
      opportunity_details: {
        ...details,
        url: existing.url,
        converted_from: "new_content",
        original_new_url: url,
      },
    });
    logger.info(`[daily_opportunity_tasks] ${note}`);
    return;
  }

  const pageType: "post" | "page" = details.type === "post" ? "post" : "page";

  const keywordPerformance = (
    await getKeywordRankings(site.site_id, site.domain, targetKeywords)
  ).rankings.flat();

  await upsertKeywords(
    keywordPerformance.map((r) => {
      return {
        id: randomUUID(),
        site_id: site.site_id,
        keyword: r.keyword,
        is_new: false,
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position ?? null,
        ctr: r.ctr,
        search_volume: r.volume ?? null,
        difficulty: r.difficulty ?? null,
        cpc: r.cpc ?? null,
        competition: r.competition ?? null,
        competition_level: r.competition_level ?? null,
        monthly_searches: r.monthly_searches ?? null,
      };
    }),
  );

  let paaQuestions: any[] = (
    await Promise.all(targetKeywords.map((keyword) => getPaaQuestions(keyword)))
  ).flat();

  const paaFromRecords = await getPaaQuestionsByQuestions(
    paaQuestions.map((q) => q.question),
  );

  const contentInstruction =
    pageType === "post"
      ? renderPrompt("new_content_post_instruction")
      : renderPrompt("new_content_page_instruction");

  const prompt = renderPrompt("new_content", {
    page_details: JSON.stringify({
  url: details.url,
  type: pageType,
  title: details.title,
  target_keywords: targetKeywords,
}),
    keyword_performance: JSON.stringify(keywordPerformance),
    paa_questions: JSON.stringify(paaQuestions.map((q) => q.question).slice(0, 8)),
    site_pages: JSON.stringify(sitePages),
    reason_flagged: opp.reasoning,
    suggested_focus: opp.description,
    content_instruction: contentInstruction,
  });

  const response = await getResponse("daily_opportunity.new_content", prompt);
  logger.debug(
    "[daily_opportunity_tasks] Content generation complete",
    response.source,
  );

  if (!response) {
    logger.warn(
      `[daily_opportunity_tasks] Could not parse AI response for new_content opp=${opp.id}`,
    );
    return;
  }

  const keywords_analytics = keywordPerformance.map((keyword) => ({
    keyword: keyword.keyword,
    cpc: keyword.cpc,
    search_volume: keyword.volume,
    position: keyword?.position ?? null,
    clicks: keyword?.clicks ?? 0,
    impressions: keyword?.impressions ?? 0,
    ctr: keyword?.ctr ?? 0,
  }));

  // Mark PAA as used
  const used_paa = response.paa;
  const paaInRecords = paaFromRecords.filter((q) =>
    used_paa.includes(q.question),
  );
  markPaaQuestionsAsUsed(paaInRecords.map((q) => q.id));
  // TODO: Add New PAA in records with keywords

  await createNewPageContent({
    id: randomUUID(),
    site_id: opp.site_id,
    url: response.url,
    page_meta_details: {
      page_type: pageType,
      page_title: response.title,
      meta_description: response.meta_description,
      keywords: targetKeywords,
    },
    reasoning: response.reason,
    content: response.content,
    images: response.images,
    links: response.suggestions,
    keywords_analytics: keywords_analytics,
  });

  await updateStatusToCompleted(opp.id, "agent");
  logger.info(
    `[daily_opportunity_tasks] new_content page-content created for ${response.url}`,
  );
}

// ── Main pipeline ─────────────────────────────────────────────────────
export async function dailyOpportunityTasks() {
  logger.info(
    `[daily_opportunity_tasks] ══════════════════════════════════════════`,
  );
  logger.info(
    `[daily_opportunity_tasks] Starting daily opportunity task pipeline`,
  );
  logger.info(
    `[daily_opportunity_tasks] ══════════════════════════════════════════`,
  );

  let { sites } = await listSitesConfigs({ limit: 1000 });

  // let site = sites.find((s) => s.site_id == 1) as any;

  for (const site of sites.filter((s) => [1, 2].includes(s.site_id))) {
    if (!site) {
      logger.error(`[daily_opportunity_tasks] No site config found`);
      return;
    }

    let site_pages = (await getAllWPPages(site.site_id)) as any[];
    site_pages = site_pages
      .filter((page) => !page.redirecting_to)
      .map((page) => ({
        url: page.url,
        type: page.type,
        // title: page.title,
        canonical: page.canonical,
      }));

    const metaRewriteOpportunities = await getPlannedOpportunitiesByType(
      "meta_rewrite",
      site.site_id,
      OPPORTUNITY_LIMIT,
    );
    logger.info(
      `[daily_opportunity_tasks] Processing ${metaRewriteOpportunities.length} meta_rewrite opportunities`,
    );
    for (const opp of metaRewriteOpportunities) {
      try {
        await processMetaRewriteOpportunity(opp, site);
      } catch (err: any) {
        logger.error(
          `[daily_opportunity_tasks] meta_rewrite failed for opp=${opp.id}: ${err.message}`,
          err,
        );
      }
    }

    // optimize_content and content_gap (from weekly_performance_check) are also
    // "improve an existing page" work with the same fields (url, target_keywords,
    // type); the refresh handler passes their description/reasoning to the prompt.
    // Previously they were created but never processed.
    for (const type of ["refresh_content", "optimize_content", "content_gap"]) {
      const existingPageOpportunities = await getPlannedOpportunitiesByType(
        type,
        site.site_id,
        OPPORTUNITY_LIMIT,
      );
      logger.info(
        `[daily_opportunity_tasks] Processing ${existingPageOpportunities.length} ${type} opportunities`,
      );
      for (const opp of existingPageOpportunities) {
        try {
          await processRefreshContentOpportunity(opp, site, site_pages);
        } catch (err: any) {
          logger.error(
            `[daily_opportunity_tasks] ${type} failed for opp=${opp.id}: ${err.message}`,
            err,
          );
        }
      }
    }

    const newContentOpportunities = await getPlannedOpportunitiesByType(
      "new_content",
      site.site_id,
      OPPORTUNITY_LIMIT,
    );
    logger.info(
      `[daily_opportunity_tasks] Processing ${newContentOpportunities.length} new_content opportunities`,
    );
    for (const opp of newContentOpportunities) {
      try {
        await processNewContentOpportunity(opp, site, site_pages);
      } catch (err: any) {
        logger.error(
          `[daily_opportunity_tasks] new_content failed for opp=${opp.id}: ${err.message}`,
          err,
        );
      }
    }
  }
}
