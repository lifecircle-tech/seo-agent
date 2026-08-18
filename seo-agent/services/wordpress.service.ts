/**
 * WordPress service — HTTP calls to the WordPress REST API.
 */

import { getWpAuth, wpFetch } from "../../libs/wordpress.js";

// ── Result types ──────────────────────────────────────────────────────
export interface UpdatePageMetaResult {
  ok: true;
  url: string;
  title: string;
  description: string;
  updated: number;
}

export interface UpdatePageMetaError {
  ok: false;
  error: string;
}

export async function getWPPageDetails(siteId: number, pageUrl: string) {
  // Extract slug from URL path
  const parsed = new URL(pageUrl);
  const slug =
    parsed.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .pop() ?? "";

  // Try pages first, then posts
  let wpPage = null;

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
  if (!wpPage) {
    return null;
  }

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
    content: content,
    meta_description: metaDescription,
    last_modified: wpPage.modified,
    primary_keywords,
    secondary_keywords,
  };
}

// ── updatePageMeta ────────────────────────────────────────────────────
/**
 * Update a WordPress page's Rank Math title and meta description via the
 * claude-seo plugin endpoint (POST /wp-json/claude-seo/v1/bulk-meta-update).
 *
 * Uses the plugin because Rank Math fields are not writable through the
 * standard WP REST API — the plugin calls update_post_meta() directly.
 */
export async function updatePageMeta(
  siteId: number,
  pageUrl: string,
  title: string,
  description: string,
): Promise<UpdatePageMetaResult | UpdatePageMetaError> {
  let baseUrl: string;
  let authHeader: string;

  try {
    ({ baseUrl, authHeader } = getWpAuth(siteId));
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  // Strip /wp/v2 suffix if present — plugin lives at /wp-json root
  const pluginBase = baseUrl.replace(/\/wp\/v2\/?$/, "");
  const pluginUrl = `${pluginBase}/claude-seo/v1/bulk-meta-update`;

  try {
    const res = await fetch(pluginUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { url: pageUrl, title, description, status: "publish" },
      ]),
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      return {
        ok: false,
        error: `claude-seo plugin returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      updated: number;
      errors: { url: string; error: string }[];
    };

    if (!res.ok || data.errors?.length) {
      const errMsg = data.errors?.[0]?.error ?? res.statusText;
      return { ok: false, error: `claude-seo plugin error: ${errMsg}` };
    }

    return {
      ok: true,
      url: pageUrl,
      title,
      description,
      updated: data.updated,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function updateCanonicalURL(
  siteId: number,
  page_id: number,
  canonical_url: string,
) {
  let baseUrl: string;
  let authHeader: string;

  try {
    ({ baseUrl, authHeader } = getWpAuth(siteId));
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  const pluginBase = baseUrl.replace(/\/wp\/v2\/?$/, "");
  const pluginUrl = `${pluginBase}/claude-seo/v1/canonical/${page_id}`;

  const res = await fetch(pluginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      canonical_url: canonical_url,
    }),
  });
}

export async function bulkUpdateCanonicalURL(
  siteId: number,
  items: { id: number; canonical_url: string }[],
) {
  let baseUrl: string;
  let authHeader: string;

  try {
    ({ baseUrl, authHeader } = getWpAuth(siteId));
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  const pluginBase = baseUrl.replace(/\/wp\/v2\/?$/, "");
  const pluginUrl = `${pluginBase}/claude-seo/v1/canonical/bulk`;

  const res = await fetch(pluginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      items,
    }),
  });

  const data = (await res.json()) as {
    id: number;
    success: boolean;
    canonical_url?: string;
    errors?: string;
  }[];

  return {
    data: data,
  };
}
