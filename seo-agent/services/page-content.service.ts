import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { randomUUID } from "node:crypto";

import { wpFetch } from "../../libs/wordpress.js";
import { getApprovalById } from "../controllers/approvals.controller.js";
import {
  createPageContent,
  updatePageContentBody,
  updatePageContentError,
} from "../controllers/page-content.controller.js";
import { analyseWithAI } from "../orchestrators/content.js";
import { io } from "../../server.js";

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
  { label: "FAQ", selector: '[class*="faq"], [class*="accordion"]' },
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
export async function getPageContent(siteId: number, url: string) {
  const parsedUrl = new URL(url);
  const slug =
    parsedUrl.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .pop() ?? "";

  const result = (await wpFetch(
    siteId,
    "GET",
    `/posts?slug=${encodeURIComponent(slug)}&_fields=id,content`,
  )) as any[];

  if (!result.length) throw new Error(`Post not found for slug: ${slug}`);

  const rawContent = extractWordPressContent(result[0].content.rendered);
  console.log(
    `[page-content.service] Extracted Content for ${url}:\n`,
    rawContent,
  );

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

export async function runPageContentAgent(id: string) {
  let recordId = "";
  try {
    // get approval record by ID
    const approval = await getApprovalById(id);
    if (!approval) throw new Error("Approval not found");
    const { site_id, original_content } = approval as any;
    const url = original_content.url as string;

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
    const content = await getPageContent(site_id, url);
    console.log("Page Content : ", content);
    // Here you would call your AI analysis/orchestrator functions with the content
    console.log(`[page-content.service] Running agent for ${url}...`);

    // Example: const insights = await analyseWithAI(content);
    const response = await analyseWithAI(content, pageDetails);

    // Then update the content record with any changes or insights
    const record = await updatePageContentBody(
      recordId,
      response.content,
      response.reason,
    );
    io.emit("content:updated", record);

    return { success: true, record };
  } catch (err) {
    console.error(`[page-content.service] Error processing :`, err);
    const record = await updatePageContentError(recordId);
    io.emit("content:updated", record);
    return { success: false, error: "Database error" };
  }
}
