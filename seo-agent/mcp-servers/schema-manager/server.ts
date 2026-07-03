import { wpFetch } from "../../../libs/wordpress.js";

// ── Page type detection ────────────────────────────────────────────────
export type PageType =
  | "home"
  | "service"
  | "faq"
  | "blog"
  | "contact"
  | "default";

export const RECOMMENDED_SCHEMA: Record<PageType, string[]> = {
  home: ["Organization", "WebSite", "LocalBusiness"],
  service: ["Service", "LocalBusiness"],
  faq: ["FAQPage"],
  blog: ["BlogPosting", "Article"],
  contact: ["LocalBusiness", "ContactPage"],
  default: ["WebPage"],
};

export function detectPageType(url: string): PageType {
  const path = new URL(url).pathname.toLowerCase();
  if (path === "/" || path === "") return "home";
  if (path.includes("faq") || path.includes("question")) return "faq";
  if (path.includes("contact")) return "contact";
  if (
    path.includes("blog") ||
    path.includes("post") ||
    path.includes("article") ||
    path.includes("news")
  )
    return "blog";
  if (
    path.includes("service") ||
    path.includes("care") ||
    path.includes("solution") ||
    path.includes("treatment")
  )
    return "service";
  return "default";
}

// ── Tool: get_current_schema ──────────────────────────────────────────
export async function getCurrentSchema(siteId: number, pageUrl: string) {
  console.log("========== Fetching Current Schema **********\n", pageUrl);
  const html = await fetch(pageUrl).then((r) => r.text());
  const matches = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];

  const schemas = [];
  for (const m of matches) {
    try {
      schemas.push(JSON.parse(m[1]));
    } catch {
      // skip malformed blocks
    }
  }
  console.log("========== Current Schema Retrieved **********\n", pageUrl);

  return {
    site_id: siteId,
    url: pageUrl,
    schema_count: schemas.length,
    schemas,
  };
}

// ── Tool: get_paa_questions ───────────────────────────────────────────
export async function getPaaQuestions(siteId: number, keyword: string) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("Missing env var SERPAPI_KEY");

  console.log("========== Calling SerpAPI **********");
  const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${apiKey}&location="India"`;
  const res = await fetch(serpUrl);
  if (!res.ok) {
    throw new Error(`SerpAPI error ${res.status}: ${res.statusText}`);
  }
  console.log("========== SerpAPI Fetched **********");
  const data = (await res.json()) as {
    related_questions?: Array<{
      question: string;
      snippet?: string;
      answer?: string;
      type: string;
    }>;
  };

  const questions = (data.related_questions ?? []).map((q) => {
    return {
      question: q.question,
      snippet: q.snippet ?? q.answer ?? null,
      type: q.type
    };
  });

  console.log("========== PAA Questions Retrieved **********");

  return {
    site_id: siteId,
    keyword,
    questions_count: questions.length,
    questions,
  };
}

// ── Tool: suggest_schema_improvements ────────────────────────────────
export async function suggestSchemaImprovements(
  siteId: number,
  pageUrl: string,
) {
  console.log("========== Running Schema Improvement **********\n", pageUrl);
  const current = await getCurrentSchema(siteId, pageUrl);
  const pageType = detectPageType(pageUrl);
  const recommended = RECOMMENDED_SCHEMA[pageType];

  // Extract @type values from existing schemas
  const existingTypes = new Set<string>();
  for (const schema of current.schemas) {
    const s = schema as Record<string, unknown>;
    const t = s["@type"];
    if (typeof t === "string") existingTypes.add(t);
    else if (Array.isArray(t)) t.forEach((v) => existingTypes.add(String(v)));
  }

  const missing = recommended.filter((t) => !existingTypes.has(t));
  const extra = [...existingTypes].filter((t) => !recommended.includes(t));
  console.log("========== Schema Improvement Finish **********\n", pageUrl);

  return {
    site_id: siteId,
    url: pageUrl,
    page_type: pageType,
    existing_types: [...existingTypes],
    recommended_types: recommended,
    missing_types: missing,
    extra_types: extra,
    has_gaps: missing.length > 0,
    suggestions: missing.map((type) => ({
      action: "add",
      schema_type: type,
      reason: `${type} schema is recommended for ${pageType} pages but is missing`,
    })),
  };
}

// ── Tool: push_schema_to_page ─────────────────────────────────────────
export async function pushSchemaToPage(
  siteId: number,
  pageUrl: string,
  schemaJson: unknown,
) {
  // Resolve page ID by slug
  const parsed = new URL(pageUrl);
  const slug =
    parsed.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .pop() ?? "";

  let pageId = null;
  for (const postType of ["pages", "posts"]) {
    const results = (await wpFetch(
      siteId,
      "GET",
      `/${postType}?slug=${encodeURIComponent(slug)}&_fields=id`,
    )) as Array<{ id: number }>;
    if (results.length > 0) {
      pageId = results[0].id;
      break;
    }
  }
  if (!pageId) throw new Error(`Page not found for URL: ${pageUrl}`);

  // ── PERMANENT PUBLISH GUARD ───────────────────────────────────────
  // push_schema_to_page MUST NEVER set post_status to 'publish'.
  // Only meta is written — page status is never touched.
  const payload = {
    meta: { _seo_agent_schema: JSON.stringify(schemaJson) },
  };
  // ─────────────────────────────────────────────────────────────────

  const updated = (await wpFetch(
    siteId,
    "PUT",
    `/pages/${pageId}`,
    payload,
  )) as { id: number; link: string };

  return {
    ok: true,
    id: updated.id,
    url: updated.link,
    schema_stored: true,
  };
}

const suggestSchemaImprovementsForPages = async (pageList: Array<string>) => {
  return await Promise.all(
    pageList.map(async (pageUrl) => {
      try {
        const result = await suggestSchemaImprovements(1, pageUrl);
        console.log("*******************************************");
        console.log(result);
        console.log("*******************************************");
        return result;
      } catch (error) {
        console.error(
          `Error suggesting schema improvements for ${pageUrl}:`,
          error,
        );
      }
    }),
  );
};

const getPaaQuestionsForKeywords = async (
  siteId: number,
  keywords: Array<string>,
) => {
  if (!Array.isArray(keywords)) {
    throw new Error("keywords must be an array");
  }

  const paaQuestions = await Promise.all(
    keywords.map(async (keyword) => {
      try {
        const result = await getPaaQuestions(siteId, keyword);
        return result;
      } catch (error) {
        console.error(
          `Error fetching PAA questions for keyword "${keyword}":`,
          error,
        );
      }
    }),
  );

  return paaQuestions;
};

export { suggestSchemaImprovementsForPages, getPaaQuestionsForKeywords };
