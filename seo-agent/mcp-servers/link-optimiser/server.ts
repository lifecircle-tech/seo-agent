import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
import {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta.js";
import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../db.js";
import { wpFetch } from "../../../libs/wordpress.js";
import { logger } from "../../utils/logger.js";

// ── Retry helpers ─────────────────────────────────────────────────────
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function extractJson(text: string): any {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fallthrough
      }
    }
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────
type WpPage = {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  rank_math_meta: { title: string };
};

export type LinkOpportunity = {
  source_url: string;
  source_title: string;
  mention_text: string;
  suggested_target_url: string;
  suggested_target_title: string;
  context_snippet: string;
};

export type OrphanPage = {
  url: string;
  title: string;
  slug: string;
  inbound_link_count: number;
};

export type LinkStructureSuggestion = {
  site_id: number;
  hub_pages: Array<{
    url: string;
    title: string;
    type: "service" | "city" | "blog" | "other";
    spoke_pages: Array<{ url: string; title: string }>;
  }>;
  priority_actions: Array<{
    action: string;
    from_url: string;
    to_url: string;
    anchor_text: string;
    rationale: string;
  }>;
  summary: string;
};

// ── WP page fetcher (paginated) ───────────────────────────────────────
export async function fetchAllPages(siteId: number): Promise<WpPage[]> {
  const all: WpPage[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const batch = (await wpFetch(
      siteId,
      "GET",
      `/pages?per_page=${pageSize}&offset=${offset}&status=publish&_fields=id,slug,link,title,content,rank_math_meta&context=view`,
    )) as WpPage[];

    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  logger.info(`Pages Counts : ${all.length}`);

  return all;
}

// ── Target keyword map builder ────────────────────────────────────────
async function buildKeywordTargetMap(
  siteId: number,
  pages: WpPage[],
): Promise<Map<string, { url: string; title: string }>> {
  // Map: normalised keyword/city/service phrase → target page
  const map = new Map<string, { url: string; title: string }>();

  logger.info(`[taget_map] Site_id : ${siteId}`);

  // Pull target keywords from DB for this site
  const [kwRows] = await pool.query<RowDataPacket[]>(
    "SELECT target_keywords FROM keywords_config WHERE site_id = ?",
    [siteId],
  );

  for (const row of kwRows) {
    const keywords: string[] =
      typeof row.target_keywords === "string"
        ? JSON.parse(row.target_keywords)
        : (row.target_keywords ?? []);

    for (const kw of keywords) {
      // Find the page most likely to target this keyword (slug match)
      const kwSlug = kw.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const match = pages.find(
        (p) => p.slug.includes(kwSlug) || p.link.toLowerCase().includes(kwSlug),
      );
      if (match) {
        map.set(kw.toLowerCase(), {
          url: match.link,
          title: match.rank_math_meta.title ?? match.title.rendered,
        });
      }
    }
  }

  // Also index page titles directly so pages can link to sibling pages by title
  for (const page of pages) {
    const titleKey = page.title.rendered.toLowerCase().trim();
    if (!map.has(titleKey)) {
      map.set(titleKey, {
        url: page.link,
        title: page.rank_math_meta.title ?? page.title.rendered,
      });
    }
  }

  return map;
}

// ── Tool: find_internal_link_opportunities ────────────────────────────
export async function findInternalLinkOpportunities(
  siteId: number,
  pages: WpPage[],
): Promise<{
  site_id: number;
  pages_scanned: number;
  opportunities_count: number;
  opportunities: LinkOpportunity[];
}> {
  logger.info(
    `[find_internal_link_opportunities] Scanning pages for site_id=${siteId}...`,
  );

  const keywordTargetMap = await buildKeywordTargetMap(siteId, pages);
  const opportunities: LinkOpportunity[] = [];

  for (const page of pages) {
    const rawHtml = page.content.rendered;
    const $ = cheerio.load(rawHtml);

    // Collect all text that is already inside an <a> tag
    const linkedTexts = new Set<string>();
    $("a").each((_i, el) => {
      linkedTexts.add($(el).text().toLowerCase().trim());
    });

    // For each keyword target, search for unlinked mentions in plain text nodes
    for (const [keyword, target] of keywordTargetMap.entries()) {
      // Don't suggest linking a page to itself
      if (page.link === target.url) continue;

      // Walk text nodes outside <a> tags
      $("p, li, h2, h3, h4").each((_i, el) => {
        const $el = $(el);
        // Skip if this element is inside an anchor
        if ($el.closest("a").length > 0) return;

        const text = $el.text();
        const lowerText = text.toLowerCase();
        const keywordIndex = lowerText.indexOf(keyword);

        if (keywordIndex === -1) return;

        // Check if the matched text is already linked
        const alreadyLinked = linkedTexts.has(keyword);
        if (alreadyLinked) return;

        // Build context snippet (± 60 chars around the mention)
        const start = Math.max(0, keywordIndex - 60);
        const end = Math.min(text.length, keywordIndex + keyword.length + 60);
        const snippet = `...${text.slice(start, end)}...`;

        opportunities.push({
          source_url: page.link,
          source_title: page.title.rendered,
          mention_text: keyword,
          suggested_target_url: target.url,
          suggested_target_title: target.title,
          context_snippet: snippet,
        });
      });
    }
  }

  // De-duplicate: one opportunity per source_url + mention_text + target_url combo
  const seen = new Set<string>();
  const deduped = opportunities.filter((o) => {
    const key = `${o.source_url}|${o.mention_text}|${o.suggested_target_url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(
    `[find_internal_link_opportunities] ${deduped.length} opportunities across ${pages.length} pages.`,
  );

  return {
    site_id: siteId,
    pages_scanned: pages.length,
    opportunities_count: deduped.length,
    opportunities: deduped,
  };
}

// ── Tool: get_orphan_pages ────────────────────────────────────────────
export async function getOrphanPages(
  siteId: number,
  pages: WpPage[],
): Promise<{
  site_id: number;
  total_pages: number;
  orphan_count: number;
  orphans: OrphanPage[];
}> {
  logger.info(
    `[get_orphan_pages] Analysing inbound links for site_id=${siteId}...`,
  );

  // Build set of all known page URLs (normalised: no trailing slash)
  const normalise = (url: string) => url.replace(/\/$/, "").toLowerCase();

  const allPageUrls = new Set(pages.map((p) => normalise(p.link)));

  // Count inbound internal links per page
  const inboundCount = new Map<string, number>();
  for (const url of allPageUrls) inboundCount.set(url, 0);

  for (const page of pages) {
    const $ = cheerio.load(page.content.rendered);
    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      const target = normalise(href);
      if (allPageUrls.has(target) && target !== normalise(page.link)) {
        inboundCount.set(target, (inboundCount.get(target) ?? 0) + 1);
      }
    });
  }

  // Orphans: pages with 0 inbound links (exclude homepage)
  const orphans: OrphanPage[] = pages
    .filter((p) => {
      const normUrl = normalise(p.link);
      const count = inboundCount.get(normUrl) ?? 0;
      // Don't flag homepage (slug is empty string or "home")
      const isHomepage = p.slug === "" || p.slug === "home";
      return !isHomepage && count === 0 && !p.slug.includes("template");
    })
    .map((p) => ({
      url: p.link,
      title: p.rank_math_meta.title ?? p.title.rendered,
      slug: p.slug,
      inbound_link_count: 0,
    }));

  logger.info(
    `[get_orphan_pages] ${orphans.length}/${pages.length} orphan pages found.`,
  );

  return {
    site_id: siteId,
    total_pages: pages.length,
    orphan_count: orphans.length,
    orphans,
  };
}

// ── Tool: suggest_link_structure ──────────────────────────────────────
export async function suggestLinkStructure(
  siteId: number,
): Promise<LinkStructureSuggestion> {
  logger.info(
    `[suggest_link_structure] Building hub-and-spoke plan for site_id=${siteId}...`,
  );

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const pages = await fetchAllPages(siteId);
  const orphanResult = await getOrphanPages(siteId, pages);
  const opportunitiesResult = await findInternalLinkOpportunities(
    siteId,
    pages,
  );

  // Pass a condensed page inventory to Claude
  const pageInventory = pages.map((p) => ({
    url: p.link,
    title: p.title.rendered,
    slug: p.slug,
  }));

  const prompt = `You are an SEO internal linking strategist for site_id=${siteId}.

Here is the current page inventory (${pageInventory.length} pages):
${JSON.stringify(pageInventory.slice(0, 80), null, 2)}

Orphan pages (no inbound links): ${orphanResult.orphan_count}
${JSON.stringify(
  orphanResult.orphans.map((o) => ({ url: o.url, title: o.title })),
  null,
  2,
)}

Top unlinked keyword mentions: ${opportunitiesResult.opportunities_count}
${JSON.stringify(opportunitiesResult.opportunities.slice(0, 20), null, 2)}

Design a hub-and-spoke internal linking plan:
- Identify 3–6 "hub" pages (service or category pages that should attract the most internal links)
- For each hub, list the "spoke" pages that should link to it
- Suggest 10–15 specific link insertions (from_url, to_url, anchor_text) prioritised by SEO impact
- Explain the rationale for the top 5 actions
- Write a 2–3 sentence executive summary

Return ONLY a JSON object with keys:
- hub_pages: array of { url, title, type ("service"|"city"|"blog"|"other"), spoke_pages: [{url, title}] }
- priority_actions: array of { action, from_url, to_url, anchor_text, rationale } (max 15, sorted by impact)
- summary: string

No extra text outside the JSON.`;

  const response = await callWithRetry(client, "suggest_link_structure", {
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
    betas: ["mcp-client-2025-04-04"],
  });

  logger.info(`[suggest_link_structure] Stop reason: ${response.stop_reason}`);
  logger.info(`[suggest_link_structure] Usage: `, response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const parsed = extractJson(text);
  if (!parsed) {
    throw new Error(
      `[suggest_link_structure] Failed to parse Claude response. Raw: ${text.substring(0, 300)}`,
    );
  }

  return {
    site_id: siteId,
    hub_pages: parsed.hub_pages ?? [],
    priority_actions: parsed.priority_actions ?? [],
    summary: parsed.summary ?? "",
  };
}
