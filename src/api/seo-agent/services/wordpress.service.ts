/**
 * WordPress service — HTTP calls to the WordPress REST API.
 */

import { getWpAuth } from "../../libs/wordpress.js";


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
