import { getSearchConsoleClient } from "../../../libs/google.js";
import { getWpAuth, wpFetch } from "../../../libs/wordpress.js";
import { getStartIndex } from "../../../libs/functions.js";

// ── GSC date helpers ──────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function dateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

// ── Tool: get_page ────────────────────────────────────────────────────
export async function getPage(siteId: number, pageUrl: string) {
  // Extract slug from URL path
  const parsed = new URL(pageUrl);
  const slug =
    parsed.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .pop() ?? "";

  // Try pages first, then posts
  let wpPage = null;
  console.log("============= CMS Getting Page ***************", pageUrl, slug);
  for (const postType of ["pages", "posts"]) {
    const results = (await wpFetch(
      siteId,
      "GET",
      `/${postType}?slug=${encodeURIComponent(slug)}&_fields=id,title,type,modified,link,rank_math_meta,meta,content&context=edit`,
    )) as Record<string, unknown>[];
    if (results.length > 0) {
      wpPage = results[0];
      break;
    }
  }
  if (!wpPage) throw new Error(`Page not found for URL: ${pageUrl}`);
  console.log("============= CMS Page Found ***************");

  // Extract meta description (RankMath preferred, custom meta fallback)
  const rank_math = wpPage.rank_math_meta as
    | Record<string, unknown>
    | undefined
    | null;
  const meta = wpPage.meta as Record<string, unknown> | undefined | null;
  const metaDescription =
    (rank_math?.description as string | undefined) ??
    (meta?.meta_description as string | undefined) ??
    null;
  const title = rank_math?.title as string;
  const content = wpPage.content as { raw: string };
  const primary_keywords = ((rank_math?.focus_keyword as string) || "").split(
    ",",
  )[0];
  const secondary_keywords = ((rank_math?.focus_keyword as string) || "").split(
    ",",
  );

  return {
    id: wpPage.id,
    url: wpPage.link ?? pageUrl,
    type: wpPage.type,
    title: title,
    meta_description: metaDescription,
    last_modified: wpPage.modified,
    primary_keywords,
    secondary_keywords,
  };
}

// ── Tool: list_pages ──────────────────────────────────────────────────
export async function listPages(
  siteId: number,
  siteUrl: string,
  limit: number,
  offset: number,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }

  // Fetch WP pages
  console.log("============= CMS Listing Pages ***************");
  const wpPages = (await wpFetch(
    siteId,
    "GET",
    `/pages?per_page=${limit}&offset=${offset}&status=publish&_fields=id,title,link,modified`,
  )) as Array<{
    id: number;
    title: { rendered: string };
    link: string;
    modified: string;
  }>;

  // Fetch GSC metrics for all pages in a single query (last 28 days)
  const searchConsole = getSearchConsoleClient();
  const { startDate, endDate } = dateRange(28);

  const gscResponse = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["page"],
      rowLimit: 1000,
    },
  });

  // Build URL → GSC metrics map
  const gscByUrl = new Map();
  for (const row of gscResponse.data.rows ?? []) {
    const pageKey = row.keys?.[0] ?? "";
    gscByUrl.set(pageKey, {
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? null,
    });
  }

  const pages = wpPages.map((page) => {
    const gsc = gscByUrl.get(page.link) ?? {
      impressions: 0,
      clicks: 0,
      ctr: 0,
      position: null,
    };
    return {
      id: page.id,
      url: page.link,
      title: page.title.rendered,
      modified: page.modified,
      impressions: gsc.impressions,
      clicks: gsc.clicks,
      ctr: gsc.ctr,
      position: gsc.position,
    };
  });

  return { site_id: siteId, total: wpPages.length, offset, pages };
}

// ── Tool: get_page_metrics ────────────────────────────────────────────
export async function getPageMetrics(
  siteId: number,
  siteUrl: string,
  pageUrl: string,
) {
  const searchConsole = getSearchConsoleClient();
  const { startDate, endDate } = dateRange(28);

  console.log("============= CMS Getting Page Metrics ***************");
  const response = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["page"],
      dimensionFilterGroups: [
        {
          filters: [
            { dimension: "page", operator: "equals", expression: pageUrl },
          ],
        },
      ],
      rowLimit: 1,
    },
  });

  const row = response.data.rows?.[0];
  return {
    site_id: siteId,
    url: pageUrl,
    impressions: row?.impressions ?? 0,
    clicks: row?.clicks ?? 0,
    ctr: row?.ctr ?? 0,
    position: row?.position ?? null,
    date_range: { startDate, endDate },
  };
}

// ── Tool: update_page_meta ────────────────────────────────────────────
export async function updatePageMeta(
  siteId: number,
  pageUrl: string,
  title: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _extraFields?: Record<string, any>,
) {
  // update_page_meta MUST NEVER set post_status to 'publish'.
  if (
    _extraFields?.status === "publish" ||
    _extraFields?.post_status === "publish"
  ) {
    throw new Error(
      "PUBLISH GUARD: update_page_meta must never set post_status to 'publish'",
    );
  }
  // ─────────────────────────────────────────────────────────────────

  // Use the claude-seo plugin endpoint instead of the standard WP REST API.
  const { baseUrl, authHeader } = getWpAuth(siteId);

  // Replace /wp/v2 suffix with the plugin namespace if present
  const pluginBase = baseUrl.replace(/\/wp\/v2\/?$/, "");
  const pluginUrl = `${pluginBase}/claude-seo/v1/bulk-meta-update`;

  const res = await fetch(pluginUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      { url: pageUrl, title, description, status: "draft" },
    ]),
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `claude-seo plugin returned non-JSON (${res.status}). Body: ${text.slice(0, 200)}`,
    );
  }

  const data = await res.json();

  if (!res.ok || data.errors?.length) {
    const errMsg = data.errors?.[0]?.error ?? res.statusText;
    throw new Error(`claude-seo plugin error: ${errMsg}`);
  }

  return {
    ok: true,
    url: pageUrl,
    title,
    description,
    updated: data.updated,
  };
}

export interface ApprovalQueueItem {
  site_id: number;
  module: string;
  type: string;
  priority?: number; // 1=critical, 2=high, 3=medium (default 3)
  title: string;
  original_content: Record<string, unknown>;
  suggested_content?: Record<string, unknown>;
  preview_url?: string;
}

export async function createApprovalQueue(items: ApprovalQueueItem[]): Promise<{
  queued: number;
  results: unknown[];
  errors: { index: number; error: string }[];
}> {
  const apiUrl = process.env.BACKEND_API_URL ?? "http://localhost:3002";
  const url = `${apiUrl}/approvals`;

  const results = [];
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: item.site_id,
          module: item.module,
          type: item.type,
          priority: item.priority ?? 3,
          title: item.title,
          original_content: item.original_content,
          suggested_content: item.suggested_content,
          preview_url: item.preview_url ?? null,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(
          `non-JSON response (${res.status}): ${text.slice(0, 200)}`,
        );
      }

      const data = await res.json();
      if (!res.ok) {
        const errMsg = data.error ?? res.statusText;
        throw new Error(`HTTP ${res.status}: ${errMsg}`);
      }

      results.push(data);
      console.log(
        `[create_approval_queue] queued item ${i + 1}/${items.length}: ${item.title}`,
      );
    } catch (err) {
      errors.push({ index: i, error: String(err) });
      console.error(`[create_approval_queue] item ${i + 1} failed:`, err);
    }
  }

  return { queued: results.length, results, errors };
}

// ── Tool: get_impressions_vs_ctr ──────────────────────────────────────
export async function getImpressionsVsCtr(
  siteId: number,
  siteUrl: string,
  days: number,
) {
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("days must be an integer between 1 and 90");
  }

  const searchConsole = getSearchConsoleClient();
  const { startDate, endDate } = dateRange(days);

  const response = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["page"],
      rowLimit: 1000,
    },
  });

  // Pages with high impressions but low CTR = content improvement opportunities
  const opportunities = (response.data.rows ?? [])
    .filter(
      (row) =>
        // (row.impressions ?? 0) > 100 &&
        (row.ctr ?? 0) < 0.03 && row.keys?.[0].split("?")[0] !== `${siteUrl}/`,
    )
    .map((row) => ({
      url: row.keys?.[0] ?? "",
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? null,
    }))
    .sort((a, b) => b.impressions - a.impressions);

  return {
    site_id: siteId,
    days,
    threshold: { min_impressions: 100, max_ctr: 0.03 },
    opportunities,
  };
}

const getPagesWithHighImpressionLowCtr = async (
  siteId: number,
  siteUrl: string,
  days: number,
) => {
  let pages: any = await getImpressionsVsCtr(siteId, siteUrl, days);
  pages = pages.opportunities.sort(
    (a: any, b: any) => b.impressions - a.impressions,
  );

  const numberOfExtractionsPerDay = 30;
  const startIndex = getStartIndex(new Date(), numberOfExtractionsPerDay) ?? 0;

  if (typeof startIndex === "number" && startIndex < pages.length) {
    return pages.slice(startIndex, startIndex + numberOfExtractionsPerDay);
  }

  return [];
};

export { getPagesWithHighImpressionLowCtr };
