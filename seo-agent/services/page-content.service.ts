import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { randomUUID } from "node:crypto";

import { wpFetch } from "../../libs/wordpress.js";
import { getApprovalById } from "../controllers/approvals.controller.js";
import {
  createPageContent,
  getPageContentById,
  updatePageContentBody,
  updatePageContentError,
} from "../controllers/page-content.controller.js";
import { analyseFAQwithAI, analyseWithAI } from "../orchestrators/content.js";
import { io } from "../../server.js";
import { getKeywordsOverview } from "./dataForSEO.service.js";
import { logger } from "../utils/logger.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
});

// Remove these from Markdown output entirely — they carry zero content value
turndown.remove(["script", "style", "img", "video", "iframe", "noscript"]);

const WIDGET_SELECTORS = [
  {
    label: "TESTIMONIAL",
    selector: '[class*="testimonial"], [class*="review"], [class*="quote"]',
  },
  {
    label: "CTA",
    selector: '[class*="cta"], [class*="call-to-action"], [class*="banner"]',
  },
  {
    label: "TRUST_BADGE",
    selector: '[class*="trust"], [class*="badge"], [class*="award"]',
  },
  {
    label: "CARD",
    selector: '[class*="card"], [class*="feature-box"], [class*="icon-box"]',
  },
  // { label: "FAQ", selector: '[class*="faq"], [class*="accordion"]' },
  {
    label: "TEAM_MEMBER",
    selector: '[class*="team"], [class*="staff"], [class*="member"]',
  },
  { label: "PRICING", selector: '[class*="pricing"], [class*="price-table"]' },
  {
    label: "STAT",
    selector: '[class*="counter"], [class*="stat"], [class*="number"]',
  },
];

/**
 * Extracts FAQ/accordion blocks from WordPress HTML and returns markdown.
 * Each question is an ## heading; each answer is a paragraph beneath it.
 *
 * Strategy (in priority order):
 *  1. <details>/<summary> — Elementor accordion and native HTML5 accordions
 *  2. CSS-class pairs — classic FAQ plugins (question + answer siblings)
 *  3. <dl>/<dt>/<dd> — definition-list style FAQs
 */
export function extractFAQSection(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, svg, noscript, iframe, img").remove();
  $('[aria-hidden="true"]').remove();

  const items: Array<{ question: string; answer: string }> = [];

  // ── Strategy 1: <details>/<summary> (Elementor + native HTML5) ───────
  $("details").each((_: any, details: any) => {
    const $details = $(details).clone();
    const question = $details
      .children("summary")
      .text()
      .replace(/\s+/g, " ")
      .trim();
    $details.children("summary").remove();
    const answer = $details.text().replace(/\s+/g, " ").trim();
    if (question && answer) items.push({ question, answer });
  });

  // ── Strategy 2: CSS class-based pairs ────────────────────────────────
  if (!items.length) {
    const questionSel =
      '[class*="faq-question"], [class*="accordion-title"], [class*="accordion-header"], ' +
      '[class*="question"], [class*="faq-title"]';

    $(questionSel).each((_: any, qEl: any) => {
      const question = $(qEl).text().replace(/\s+/g, " ").trim();
      const answerSel =
        '[class*="faq-answer"], [class*="accordion-content"], [class*="accordion-body"], ' +
        '[class*="answer"], [class*="faq-content"]';
      const answer = (
        $(qEl).next(answerSel).text() ||
        $(qEl).siblings(answerSel).first().text() ||
        $(qEl).parent().siblings(answerSel).first().text()
      )
        .replace(/\s+/g, " ")
        .trim();
      if (question && answer) items.push({ question, answer });
    });
  }

  // ── Strategy 3: <dl>/<dt>/<dd> ───────────────────────────────────────
  if (!items.length) {
    $("dl dt").each((_: any, dt: any) => {
      const question = $(dt).text().replace(/\s+/g, " ").trim();
      const answer = $(dt).next("dd").text().replace(/\s+/g, " ").trim();
      if (question && answer) items.push({ question, answer });
    });
  }

  if (!items.length) return "";

  return items
    .map(({ question, answer }) => `## ${question}\n\n${answer}`)
    .join("\n\n---\n\n");
}

/**
 * Extracts clean, token-efficient content from WordPress HTML.
 * Implementation copied from content orchestrator.
 */
export function extractWordPressContent(html: string): string {
  const $ = cheerio.load(html);
  const sections: string[] = [];

  // --- Step 1: Remove purely decorative/structural noise ---
  $("script, style, svg, noscript, iframe").remove();
  $("img").remove();
  $('[aria-hidden="true"]').remove();

  // --- Step 2: Extract & label widget blocks BEFORE generic conversion ---
  WIDGET_SELECTORS.forEach(({ label, selector }) => {
    $(selector).each((_: any, el: any) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text.length > 10) {
        sections.push(`[${label}]\n${text}`);
      }
      $(el).remove();
    });
  });

  // --- Step 3: Convert remaining HTML to Markdown ---
  const remainingHtml = $.html("body") || $.html();
  const markdown = turndown.turndown(remainingHtml);

  const cleanedMarkdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  if (cleanedMarkdown) {
    sections.unshift(`[PAGE_CONTENT]\n${cleanedMarkdown}`);
  }

  return cleanedMarkdown;
}

/**
 * Queries the WordPress 'posts' path to get post content and processes it.
 */
export async function getPageContent(
  siteId: number,
  url: string,
  type: "post" | "page",
) {
  const parsedUrl = new URL(url);
  const slug =
    parsedUrl.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .pop() ?? "";
  const pageType = type == "post" ? "posts" : "pages";

  const result = (await wpFetch(
    siteId,
    "GET",
    `/${pageType}?slug=${encodeURIComponent(slug)}&_fields=id,content`,
  )) as any[];

  if (!result.length) throw new Error(`Post not found for slug: ${slug}`);

  let rawContent = "";

  if (type === "post") {
    rawContent = extractWordPressContent(result[0].content.rendered);
  } else {
    rawContent = extractFAQSection(result[0].content.rendered);
  }
  logger.info(`[page-content.service] Extracted Content for ${url}`);

  return rawContent;
}

/**
 * Calls the internal PATCH endpoint to update processed content.
 */
export async function updatePageContent(
  id: string,
  content: string,
  reason: string,
) {
  const backendUrl = process.env.BACKEND_API_URL ?? "http://localhost:3002";
  const response = await fetch(`${backendUrl}/content/${id}/content`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, reasoning: reason }),
  });

  return response.json();
}

/**
 * Get focus keywords overview details
 */
export async function getFocusKeywordsOverview(keywords: string[]) {
  try {
    const res = await getKeywordsOverview(keywords);
    let keywords_analytics = keywords.map((k) => {
      const overview = res.find((o: any) => k.toLowerCase() === o.keyword);
      return {
        keyword: k,
        cpc: overview?.keyword_info.cpc ?? undefined,
        search_volume: overview?.keyword_info.search_volume ?? undefined,
        competition: overview?.keyword_info.competition ?? undefined,
        competition_level:
          overview?.keyword_info.competition_level ?? undefined,
      };
    });

    return keywords_analytics;
  } catch (err) {
    logger.error(
      "[page_content.keyword_overview] Error Keywords Overview : ",
      err,
    );
    return null;
  }
}

/**
 * Fetches the stored content for a page-content record and compares it
 * against the live WordPress content, returning the overlap percentage.
 */
export async function verifyPageUpdate(
  id: string,
): Promise<{ matchPercentage: number }> {
  const record = await getPageContentById(id);
  if (!record) throw new Error(`Page content record not found: ${id}`);

  const { site_id, url, content: storedContent, page_meta_details } = record;

  const liveContent = await getPageContent(
    site_id,
    url,
    page_meta_details.page_type as "post" | "page",
  );

  const tokenize = (text: string) =>
    text
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

  const storedTokens = tokenize(storedContent);
  const liveTokens = tokenize(liveContent);

  if (storedTokens.length === 0) {
    return { matchPercentage: 0 };
  }

  // LCS via 1-D rolling DP — O(m×n) time, O(n) space
  const lcsLength = (a: string[], b: string[]): number => {
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const curr = new Array(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        curr[j] =
          a[i - 1] === b[j - 1]
            ? prev[j - 1] + 1
            : Math.max(prev[j], curr[j - 1]);
      }
      prev = curr;
    }
    return prev[b.length];
  };

  const matched = lcsLength(storedTokens, liveTokens);
  const matchPercentage = Math.round((matched / storedTokens.length) * 100);

  return { matchPercentage };
}

export async function runPageContentAgent(id: string) {
  let recordId = "";
  try {
    // get approval record by ID
    const approval = await getApprovalById(id);
    if (!approval) throw new Error("Approval not found");
    const { site_id, original_content } = approval as any;
    const url = original_content.url as string;

    // get keywords overview
    const keywords_overview = await getFocusKeywordsOverview(
      original_content.focus_keywords,
    );

    // create page-content record
    const result = await createPageContent({
      id: randomUUID(),
      site_id,
      url,
      page_meta_details: {
        page_type: original_content.type || "unknown",
        page_title: original_content.current_title || "unknown",
        meta_description: original_content.current_description || "unknown",
        keywords: original_content.focus_keywords || [],
      },
      keywords_analytics: keywords_overview,
    });
    io.emit("content:created", result);
    recordId = result.id;
    const pageDetails = {
      title: original_content.current_title,
      description: original_content.current_description,
      primary_keyword: (original_content.focus_keywords as string[])[0] || null,
      secondary_keywords: original_content.focus_keywords || [],
    };

    // fetch page content from WordPress
    const content = await getPageContent(site_id, url, original_content.type);

    let response = {} as { content: string; reason: any };
    logger.info(`[page-content.service] Running agent for ${url}...`);
    if (original_content.type === "post") {
      response = await analyseWithAI(content, pageDetails);
    } else {
      response = await analyseFAQwithAI(content, pageDetails);
    }

    // Then update the content record with any changes or insights
    const record = await updatePageContentBody(
      recordId,
      response.content,
      response.reason,
    );
    io.emit("content:updated", record);

    return { success: true, record };
  } catch (err) {
    logger.error(`[page-content.service] Error processing :`, err);
    const record = await updatePageContentError(recordId);
    io.emit("content:updated", record);
    return { success: false, error: "Database error" };
  }
}
