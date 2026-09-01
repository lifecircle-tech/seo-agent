import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";

import * as dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

import { OpportunityJSON } from "../models/opportunities.model.js";
import {
  getPlannedOpportunitiesByType,
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
    model: "claude-sonnet-5",
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
${JSON.stringify({
  url: wpPage.url,
  type: wpPage.type,
  current_title: wpPage.title,
  current_meta_description: wpPage.meta_description,
  last_modified: wpPage.last_modified,
  target_keywords: targetKeywords,
  canonical_to: wpPage.canonical_url,
})}

PAGE PERFORMANCE (last 28 days):
${JSON.stringify(pagePerformance)}

KEYWORD PERFORMANCE (last 28 days):
${JSON.stringify(keywordPerformance)}

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
- reasoning: simple explanation of what changed and the expected SEO impact
No extra text.`;

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
${JSON.stringify({
  url: wpPage.url,
  type: pageType,
  current_title: wpPage.title,
  last_modified: wpPage.last_modified,
  target_keywords: targetKeywords,
  canonical_to: wpPage.canonical_url,
})}

PAGE PERFORMANCE (last 28 days):
${JSON.stringify(pagePerformance)}

KEYWORD PERFORMANCE (last 28 days):
${JSON.stringify(keywordPerformance)}

PEOPLE ALSO ASK:
${JSON.stringify(paaQuestions.map((q) => q.question).slice(0, 8))}

SITE PAGES (Internal link opportunities):
${JSON.stringify(sitePages)}

OPPORTUNITY CONTEXT:
- Reason flagged: ${opp.reasoning}
- Suggested focus: ${opp.description}
- Sections to update: ${JSON.stringify(details.sections_to_update ?? [])}

INSTRUCTIONS:
${contentInstruction}

Do not fabricate statistics, studies, or metrics not present in the data above.
Do not mention about (---) in reasoning.
If page is city specific, omit the PAA questions that contains different city.

Return ONLY a JSON object with keys:
- suggested_content: the refreshed content described above, in Markdown
- reasoning: simple and brief about what changed and the expected SEO impact, in markdown
- source: list source about any information added from outside like testimonial, pricing
- paa: return non-modified PAA list used in suggested content
No extra text.`;

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
      ? `This is a idea for new blog post. Write the FULL page content in Markdown to
improve ranking — add depth around the target keywords, and weave in the "People Also Ask"
questions as a dedicated FAQ section near the end.`
      : `This is a idea for new static page (not a blog post). For all static page, a
fixed template and similar content is used. Only FAQs are dynamic on all static page.
Do NOT write the full page — only produce an improved/expanded FAQ section in
Markdown (use "## Question" headings) that answers the target keywords' intent,
incorporating the "People Also Ask" questions where relevant.
Omit structure and readability rules for this.
`;

  const prompt = `
  You are an expert SEO content writer and strategist with deep knowledge of on-page 
SEO, search intent, and readable, high-quality writing. Your job is to turn 
structured content briefs into publish-ready, SEO-optimized articles that rank well 
AND genuinely help the reader.

PAGE DETAILS:
${JSON.stringify({
  url: details.url,
  type: pageType,
  title: details.title,
  target_keywords: targetKeywords,
})}

KEYWORD PERFORMANCE (last 28 days):
${JSON.stringify(keywordPerformance)}

PEOPLE ALSO ASK:
${JSON.stringify(paaQuestions.map((q) => q.question).slice(0, 8))}

SITE PAGES (Internal link opportunities):
${JSON.stringify(sitePages)}

OPPORTUNITY CONTEXT:
- Reason flagged: ${opp.reasoning}
- Suggested focus: ${opp.description}
- Target Audience: Professional caregiver, family member
- Target Word Count: 1500-2000

INSTRUCTIONS:
${contentInstruction}

Do not fabricate statistics, studies, or metrics not present in the data above.
Do not mention about (---) in reasoning.
If page is city specific, omit the PAA questions that contains different city.

Follow these rules:

1. TITLE & META
  - Refine the given title if needed (keep it under 60 characters, include the 
    primary keyword near the front).
  - Write a meta description (150-160 characters) that includes the primary 
    keyword and a clear value proposition or CTA.

2. STRUCTURE
  - Use one H1 (the title).
  - Break the body into logical H2/H3 sections based on the content description.
  - Include a short, compelling introduction that states what the reader will 
    learn and includes the primary keyword within the first 100 words.
  - End with a conclusion and a clear next step or CTA.

3. KEYWORD USAGE
  - Use the primary keyword naturally in: title, meta description, intro, at 
    least one H2, and the conclusion.
  - Distribute secondary keywords naturally across subheadings and body text.
  - Do NOT keyword-stuff. Prioritize natural, human-readable language over 
    exact-match repetition. Use variations and related terms (LSI keywords).

4. READABILITY
  - Short paragraphs (2-4 sentences).
  - Use bullet points or numbered lists where helpful.
  - Use active voice and concrete examples.

5. ON-PAGE SEO EXTRAS
  - Suggest 2-3 internal linking opportunities (topics/anchor text).
  - Suggest 1-2 external authoritative sources that could be linked.
  - Recommend alt text for any implied images based on section content.

6. FAQ SECTION (if PAA questions are provided)
  - If People Also Ask questions are listed above, include a dedicated FAQ
    section answering each one concisely (2-4 sentences per answer).
  - Use the question text verbatim as the H3 heading inside the FAQ section.
  - Neglect repeated question, if any present.
  - Include this section near the end of the article, before the conclusion.

Return ONLY a JSON object with keys:
  - title,
  - meta_description,
  - url,
  - content: the new content described above, in Markdown
  - suggestions : object of internal and external links suggestion,
  - reason: simple and brief about what changed and the expected SEO impact, in Markdown
  - images : [{
      context: ideas about image to generate,
      alt_text: Alternate text for image,
      title: title of the image,
      description: brief detail about image,
    }],
  - source: list source about any information added from outside like testimonial, pricing
  - paa: return non-modified PAA list used in suggested content

Before response check if the JSON is possible to parse in JS code. Return only parsable JSON.
No extra text.`;

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

  let site = sites.find((s) => s.site_id == 1) as any;

  // for (const site of sites) {
  if (!site) {
    logger.error(
      `[daily_opportunity_tasks] No site config found for site_id=${site.site_id}`,
    );
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

  const refreshContentOpportunities = await getPlannedOpportunitiesByType(
    "refresh_content",
    OPPORTUNITY_LIMIT,
  );
  logger.info(
    `[daily_opportunity_tasks] Processing ${refreshContentOpportunities.length} refresh_content opportunities`,
  );
  for (const opp of refreshContentOpportunities) {
    try {
      await processRefreshContentOpportunity(opp, site, site_pages);
    } catch (err: any) {
      logger.error(
        `[daily_opportunity_tasks] refresh_content failed for opp=${opp.id}: ${err.message}`,
        err,
      );
    }
  }

  const newContentOpportunities = await getPlannedOpportunitiesByType(
    "new_content",
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
  // }
}
