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
export type GeneratedPage = {
  site_id: number;
  city: string;
  service: string;
  slug: string;
  title: string;
  meta_description: string;
  html_content: string;
  faq_schema: object;
};

export type CmsDraftResult = {
  site_id: number;
  wp_page_id: number;
  status: "draft";
  title: string;
  link: string;
};

export type MissingCityPage = {
  city: string;
  state: string;
  country: string;
  missingServices: string[];
  normalized_slug: string;
};

// ── Tool: generate_city_page ──────────────────────────────────────────
export async function generateCityPage(
  siteId: number,
  city: string,
  service: string,
  keywords: string[],
): Promise<GeneratedPage> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const [primaryKeyword = `${service} in ${city}`, ...secondaryKeywords] =
    keywords;
  const slug = `${service}-${city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const prompt = `You are an expert local SEO content writer. Write a complete, SEO-optimised service landing page for the following:

City: ${city}
Service: ${service}
Primary keyword: ${primaryKeyword}
Secondary keywords: ${secondaryKeywords.join(", ")}

Requirements:
- H1 must contain the primary keyword
- Introduction (150 words) must include the primary keyword in the first sentence and mention ${city} naturally
- 3-4 service sections with H2 subheadings containing secondary keywords
- Local signals: reference ${city} landmarks, neighbourhoods, or local context at least 3 times
- FAQ section with 5 Q&A pairs targeting common local search queries
- Meta title (max 60 chars) and meta description (max 155 chars) with primary keyword
- Total word count 1600-2000 words
- Write in HTML (h1, h2, h3, p, ul, li tags only — no divs or classes)
- FAQ section must be plain HTML (h2 + h3 + p pattern); the faq_schema field must be valid JSON-LD FAQPage schema

Return ONLY a JSON object with keys:
- title: string (meta title, max 60 chars)
- meta_description: string (max 155 chars)
- html_content: string (full page HTML body)
- faq_schema: object (valid JSON-LD FAQPage schema with @context, @type, mainEntity array)

No extra text outside the JSON.`;

  logger.info(
    `[generate_city_page] Generating page for ${service} in ${city}...`,
  );

  const response = await callWithRetry(client, "generate_city_page", {
    model: "claude-sonnet-4-6",
    max_tokens: 12000,
    messages: [{ role: "user", content: prompt }],
    betas: ["mcp-client-2025-04-04"],
  });

  logger.info(`[generate_city_page] Stop reason: ${response.stop_reason}`);
  logger.info(`[generate_city_page] Usage: `, response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const parsed = extractJson(text);
  if (!parsed) {
    throw new Error(
      `[generate_city_page] Failed to parse Claude response. Raw: ${text}`,
    );
  }

  logger.info("[generated page] html content");
  logger.info(slug);
  logger.info(parsed);

  return {
    site_id: siteId,
    city,
    service,
    slug,
    title: parsed.title,
    meta_description: parsed.meta_description,
    html_content: parsed.html_content,
    faq_schema: parsed.faq_schema,
  };
}

// ── Tool: create_cms_draft ────────────────────────────────────────────
// HARD RULE: status is ALWAYS 'draft'. This function will never publish.
export async function createCmsDraft(
  siteId: number,
  pageContent: GeneratedPage & {
    primary_keyword?: string;
    focus_keywords?: string;
  },
): Promise<CmsDraftResult> {
  // PUBLISH GUARD — this function must never create a published page
  const incomingStatus = (pageContent as any).status;
  if (incomingStatus === "publish" || incomingStatus === "published") {
    throw new Error(
      "PUBLISH GUARD: create_cms_draft must never set status to 'publish'. Draft only.",
    );
  }

  const focusKeyword =
    pageContent.focus_keywords ??
    pageContent.primary_keyword ??
    `${pageContent.service} ${pageContent.city}`;

  logger.info(
    `[create_cms_draft] Creating draft page "${pageContent.title}" for site_id=${siteId}...`,
  );

  const wpPayload = {
    title: pageContent.title,
    content: pageContent.html_content,
    status: "draft" as const, // HARD RULE: always draft
    slug: "seo-agent-" + pageContent.slug,
    meta: {
      rank_math_focus_keyword: focusKeyword,
      rank_math_description: pageContent.meta_description,
      // JSON-LD FAQ schema injected as page meta for RankMath
      rank_math_schema_data: JSON.stringify(pageContent.faq_schema),
    },
  };

  const created = (await wpFetch(siteId, "POST", "/pages", wpPayload)) as {
    id: number;
    status: string;
    title: { rendered: string };
    link: string;
  };

  // Verify the CMS respected the draft status
  if (created.status !== "draft") {
    throw new Error(
      `PUBLISH GUARD: WordPress returned status '${created.status}' instead of 'draft'. Aborting.`,
    );
  }

  logger.info(
    `[create_cms_draft] Draft created: wp_page_id=${created.id}, link=${created.link}`,
  );

  return {
    site_id: siteId,
    wp_page_id: created.id,
    status: "draft",
    title: pageContent.title,
    link: created.link,
  };
}

// ── Tool: get_missing_city_pages ──────────────────────────────────────
export async function getMissingCityPages(siteId: number): Promise<{
  site_id: number;
  total_cities: number;
  missing_count: number;
  missing: MissingCityPage[];
}> {
  logger.info(
    `[get_missing_city_pages] Checking cities for site_id=${siteId}...`,
  );

  // 1. Fetch all cities from cities_config for this site
  const [cityRows] = await pool.query<RowDataPacket[]>(
    "SELECT city, state, country, services, target_keywords FROM cities_config WHERE site_id = ?",
    [siteId],
  );

  if (cityRows.length === 0) {
    logger.warn(
      `[get_missing_city_pages] No cities configured for site_id=${siteId}.`,
    );
    return { site_id: siteId, total_cities: 0, missing_count: 0, missing: [] };
  }

  // 2. Fetch all published pages from WordPress (paginate up to 500)
  const allSlugs = new Set<string>();
  const allLinks = new Set<string>();
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const wpPages = (await wpFetch(
      siteId,
      "GET",
      `/pages?per_page=${pageSize}&offset=${offset}&status=publish&_fields=id,slug,link`,
    )) as Array<{ id: number; slug: string; link: string }>;

    for (const page of wpPages) {
      allSlugs.add(page.slug.toLowerCase());
      allLinks.add(page.link.toLowerCase());
    }

    if (wpPages.length < pageSize) break;
    offset += pageSize;
  }

  // 3. For each city, check if a page exists whose slug or URL contains the city slug
  const missing: MissingCityPage[] = [];

  for (const row of cityRows) {
    const citySlug = (row.city as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const cityPages =
      [...allSlugs].filter((s) => s.includes(citySlug) && s) ||
      [...allLinks].filter((l) => l.includes(citySlug) && l);

    const services =
      typeof row.services == "string" ? JSON.parse(row.services) : row.services;

    const missingServicePages = ((services as string[]) ?? []).filter(
      (service) => {
        return ![...cityPages].some((s) =>
          s.includes(service.replaceAll(" ", "-")),
        );
      },
    );

    if (missingServicePages.length) {
      missing.push({
        city: row.city as string,
        state: row.state as string,
        country: row.country as string,
        missingServices: missingServicePages,
        normalized_slug: citySlug,
      });
    }
  }

  logger.info(
    `[get_missing_city_pages] ${missing.length}/${cityRows.length} cities missing pages.`,
  );
  logger.info("[get_missing_city_pages] Missing Pages : ", missing);

  return {
    site_id: siteId,
    total_cities: cityRows.length,
    missing_count: missing.length,
    missing,
  };
}
