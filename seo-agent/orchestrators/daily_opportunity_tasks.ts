import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";

import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

import { OpportunityJSON } from "../models/opportunities.model.js";
import {
  getPlannedOpportunitiesByType,
  updateStatusToCompleted,
} from "../controllers/opportunities.controller.js";
import { getSiteBySiteID } from "../controllers/sites.controller.js";
import {
  createApproval,
  getMetaRewriteApprovedApprovalByUrl,
} from "../controllers/approvals.controller.js";
import {
  createPageContent,
  getAcknowledgedPageByUrl,
  updatePageContentBody,
} from "../controllers/page-content.controller.js";

import { getWPPageDetails } from "../services/wordpress.service.js";
import {
  getKeywordPerformance,
  getPagePerformance,
} from "../services/google.service.js";
import { getPaaQuestions } from "../services/dataForSEO.service.js";
import { getPageContent } from "../services/page-content.service.js";

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

const OPPORTUNITY_LIMIT = 5;
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
  client: Anthropic,
  label: string,
  params: MessageCreateParamsNonStreaming,
): Promise<Message> {
  let lastExc: Error = new Error("No attempts made");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await client.messages.create(params);
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

async function getAIResponse(client: Anthropic, label: string, prompt: string) {
  const response = await callWithRetry(client, label, {
    model: "claude-sonnet-4-6",
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
  client: Anthropic,
  opp: OpportunityJSON,
  site: { site_id: number; domain: string; brand_name: string },
) {
  const details = opp.opportunity_details ?? {};
  const url: string = details.url;
  const targetKeywords: string[] = details.target_keywords ?? [];

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

  const prompt = `You are an SEO analyst for '${site.brand_name}'.

Analyze the WordPress page below along with its search performance and keyword
performance data, then suggest an improved title tag and meta description to
increase CTR and rankings.

PAGE DETAILS:
${JSON.stringify(
  {
    url: wpPage.url,
    type: wpPage.type,
    current_title: wpPage.title,
    current_meta_description: wpPage.meta_description,
    last_modified: wpPage.last_modified,
    target_keywords: targetKeywords,
  },
  null,
  2,
)}

PAGE PERFORMANCE (last 28 days):
${JSON.stringify(pagePerformance, null, 2)}

KEYWORD PERFORMANCE (last 28 days):
${JSON.stringify(keywordPerformance, null, 2)}

OPPORTUNITY CONTEXT:
- Reason flagged: ${opp.reasoning}
- Suggested focus: ${opp.description}

RULES:
- Title max 60 characters, include the primary keyword near the front.
- Meta description 150-160 characters, include the primary keyword and a clear
  value proposition or CTA.
- Do not fabricate metrics not present in the data above.

Return ONLY a JSON object with keys:
- priority: 1-3 based on potential impact, 1 = high, 2 = medium, 3 = low
- suggested_title
- suggested_description
- reasoning: detailed explanation of what changed and the expected SEO impact
No extra text.`;

  const response = await getAIResponse(
    client,
    "daily_opportunity.meta_rewrite",
    prompt,
  );
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
    module: "opportunities",
    type: "meta_rewrite",
    priority: response.priority,
    title: wpPage.title,
    original_content: {
      url: wpPage.url,
      type: wpPage.type,
      focus_keywords: targetKeywords,
      current_title: wpPage.title,
      current_description: wpPage.meta_description,
      last_updated_at: last_updated_at?.actioned_at || wpPage.last_modified,
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
  client: Anthropic,
  opp: OpportunityJSON,
  site: { site_id: number; domain: string; brand_name: string },
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
    await Promise.all(
      targetKeywords.map((keyword) =>
        getKeywordPerformance(site.domain, keyword),
      ),
    )
  ).flat();

  const paaQuestions = (
    await Promise.all(targetKeywords.map((keyword) => getPaaQuestions(keyword)))
  )
    .flat()
    .slice(0, 8);

  const currentContent = await getPageContent(opp.site_id, url, pageType);

  const contentInstruction =
    pageType === "post"
      ? `This is a blog post. Rewrite/refresh the FULL page content in Markdown to
improve ranking — keep what already works, strengthen weak or outdated sections,
add depth around the target keywords, and weave in the "People Also Ask"
questions as a dedicated FAQ section near the end.`
      : `This is a static page (not a blog post). Do NOT rewrite the full page —
only produce an improved/expanded FAQ section in Markdown (use "## Question"
headings) that answers the target keywords' intent, incorporating the "People
Also Ask" questions where relevant.`;

  const prompt = `You are an SEO content strategist for '${site.brand_name}'.

CURRENT PAGE CONTENT (Markdown):
${currentContent}

PAGE DETAILS:
${JSON.stringify(
  {
    url: wpPage.url,
    type: pageType,
    current_title: wpPage.title,
    last_modified: wpPage.last_modified,
    target_keywords: targetKeywords,
  },
  null,
  2,
)}

PAGE PERFORMANCE (last 28 days):
${JSON.stringify(pagePerformance, null, 2)}

KEYWORD PERFORMANCE (last 28 days):
${JSON.stringify(keywordPerformance, null, 2)}

PEOPLE ALSO ASK:
${JSON.stringify(paaQuestions, null, 2)}

OPPORTUNITY CONTEXT:
- Reason flagged: ${opp.reasoning}
- Suggested focus: ${opp.description}
- Sections to update: ${JSON.stringify(details.sections_to_update ?? [])}

INSTRUCTIONS:
${contentInstruction}

Do not fabricate statistics, studies, or metrics not present in the data above.

Return ONLY a JSON object with keys:
- suggested_content: the refreshed content described above, in Markdown
- reasoning: detailed explanation of what changed and the expected SEO impact
No extra text.`;

  logger.debug(
    "[daily_opportunity_tasks] Running content generation prompt...",
  );
  const response = await getAIResponse(
    client,
    "daily_opportunity.refresh_content",
    prompt,
  );
  logger.debug("[daily_opportunity_tasks] Content generation complete");

  if (!response) {
    logger.warn(
      `[daily_opportunity_tasks] Could not parse AI response for refresh_content opp=${opp.id}`,
    );
    return;
  }

  const keywords_analytics = keywordPerformance;

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
      previous_updated_at: page?.acknowledged_at || wpPage.last_modified,
      reasoning: opp.reasoning,
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

// ── Main pipeline ─────────────────────────────────────────────────────
export async function dailyOpportunityTasks(siteId: number = 1) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const site = await getSiteBySiteID(siteId);
  if (!site) {
    logger.error(
      `[daily_opportunity_tasks] No site config found for site_id=${siteId}`,
    );
    return;
  }

  const metaRewriteOpportunities = await getPlannedOpportunitiesByType(
    "meta_rewrite",
    OPPORTUNITY_LIMIT,
  );
  logger.info(
    `[daily_opportunity_tasks] Processing ${metaRewriteOpportunities.length} meta_rewrite opportunities`,
  );
  for (const opp of metaRewriteOpportunities) {
    try {
      await processMetaRewriteOpportunity(client, opp, site);
    } catch (err: any) {
      logger.error(
        `[daily_opportunity_tasks] meta_rewrite failed for opp=${opp.id}: ${err.message}`,
        err,
      );
    }
  }

  const refreshContentOpportunities = await getPlannedOpportunitiesByType(
    "refresh_content",
    OPPORTUNITY_LIMIT,
  );
  logger.info(
    `[daily_opportunity_tasks] Processing ${refreshContentOpportunities.length} refresh_content opportunities`,
  );
  for (const opp of refreshContentOpportunities) {
    try {
      await processRefreshContentOpportunity(client, opp, site);
    } catch (err: any) {
      logger.error(
        `[daily_opportunity_tasks] refresh_content failed for opp=${opp.id}: ${err.message}`,
        err,
      );
    }
  }
}
