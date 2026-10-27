/**
 * Guards that stop the agent repeating work that doesn't move rankings.
 *
 * - Meta rewrite cooldown: no new title/description rewrite for a URL that has a
 *   pending rewrite, was rewritten in the last COOLDOWN_DAYS, or whose last rewrite
 *   measurably improved clicks. Data showed single pages rewritten up to 21 times
 *   in 3 months, which never lets Google settle.
 * - Cannibalisation: before creating a NEW page for a keyword, check whether an
 *   existing page already ranks for it; and find keywords where several of our
 *   pages compete, so they can be merged instead of multiplied.
 */

import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

export const META_REWRITE_COOLDOWN_DAYS = 90;
/** Keep a title that worked: don't rewrite within this many days of a measured improvement. */
export const KEEP_IMPROVED_DAYS = 180;

export function normalizeUrl(url: string | null | undefined): string {
  return String(url ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

// ── Meta rewrite cooldown ─────────────────────────────────────────────

/** URL (normalised) → human-readable reason it must not be rewritten now. */
export async function getMetaRewriteBlocks(siteId: number): Promise<Map<string, string>> {
  const blocks = new Map<string, string>();

  const [approvals] = await pool.query<RowDataPacket[]>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(original_content, '$.url')) AS url, status,
            COALESCE(actioned_at, created_at) AS at
     FROM approvals
     WHERE site_id = ? AND type = 'meta_rewrite'
       AND (status = 'pending'
            OR (status = 'approved' AND actioned_at >= NOW() - INTERVAL ? DAY))
     ORDER BY at DESC`,
    [siteId, META_REWRITE_COOLDOWN_DAYS],
  );
  for (const row of approvals) {
    const key = normalizeUrl(row.url);
    if (!key || blocks.has(key)) continue;
    if (row.status === "pending") {
      blocks.set(key, "a meta rewrite is already waiting for approval");
    } else {
      const until = new Date(new Date(row.at).getTime() + META_REWRITE_COOLDOWN_DAYS * 86_400_000);
      blocks.set(key, `rewritten on ${new Date(row.at).toISOString().slice(0, 10)}; cooldown until ${until.toISOString().slice(0, 10)}`);
    }
  }

  // Last measured rewrite improved clicks → leave the winning title alone
  try {
    const [improved] = await pool.query<RowDataPacket[]>(
      `SELECT url, changed_at FROM change_impact
       WHERE site_id = ? AND change_type = 'meta_rewrite' AND status = 'measured'
         AND changed_at >= NOW() - INTERVAL ? DAY
         AND after_clicks - before_clicks >= GREATEST(3, before_clicks * 0.1)`,
      [siteId, KEEP_IMPROVED_DAYS],
    );
    for (const row of improved) {
      const key = normalizeUrl(row.url);
      if (key && !blocks.has(key)) {
        blocks.set(key, `the rewrite on ${new Date(row.changed_at).toISOString().slice(0, 10)} improved clicks; keeping it`);
      }
    }
  } catch {
    // change_impact table not created yet (migration 002 not run) — cooldown still applies
  }

  return blocks;
}

// ── Cannibalisation ───────────────────────────────────────────────────

export interface RankingPage {
  url: string;
  keyword: string;
  position: number | null;
  impressions: number;
  clicks: number;
}

/**
 * Existing pages on the site that rank (have impressions) for any of these keywords,
 * strongest first. Used before generating a new page.
 */
export async function findRankingPagesForKeywords(
  siteId: number,
  keywords: string[],
): Promise<RankingPage[]> {
  const kws = [...new Set(keywords.map((k) => (k ?? "").trim().toLowerCase()).filter(Boolean))];
  if (!kws.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.url, k.keyword, pk.position, pk.impressions, pk.clicks
     FROM page_keywords pk
     JOIN keywords k ON k.id = pk.keyword_id
     JOIN pages p ON p.id = pk.page_id
     WHERE pk.site_id = ? AND LOWER(k.keyword) IN (?) AND pk.impressions > 0
     ORDER BY pk.impressions DESC, pk.position ASC`,
    [siteId, kws],
  );
  return rows.map((r) => ({
    url: r.url,
    keyword: r.keyword,
    position: r.position == null ? null : Number(r.position),
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
  }));
}

export interface CannibalisedKeyword {
  keyword: string;
  search_volume: number | null;
  pages: { url: string; impressions: number; clicks: number; position: number | null }[];
}

/**
 * Keywords where `minPages`+ of our pages get impressions — candidates for merging.
 * Strongest problems first (most total impressions).
 */
export async function findCannibalisedKeywords(
  siteId: number,
  minPages = 3,
  limit = 20,
): Promise<CannibalisedKeyword[]> {
  const [keywords] = await pool.query<RowDataPacket[]>(
    `SELECT pk.keyword_id, k.keyword, k.search_volume, SUM(pk.impressions) total
     FROM page_keywords pk JOIN keywords k ON k.id = pk.keyword_id
     WHERE pk.site_id = ? AND pk.impressions > 0
     GROUP BY pk.keyword_id, k.keyword, k.search_volume
     HAVING COUNT(DISTINCT pk.page_id) >= ?
     ORDER BY total DESC
     LIMIT ?`,
    [siteId, minPages, limit],
  );
  if (!keywords.length) return [];

  const [pages] = await pool.query<RowDataPacket[]>(
    `SELECT pk.keyword_id, p.url, pk.impressions, pk.clicks, pk.position
     FROM page_keywords pk JOIN pages p ON p.id = pk.page_id
     WHERE pk.site_id = ? AND pk.keyword_id IN (?) AND pk.impressions > 0
     ORDER BY pk.impressions DESC`,
    [siteId, keywords.map((k) => k.keyword_id)],
  );

  return keywords.map((k) => ({
    keyword: k.keyword,
    search_volume: k.search_volume == null ? null : Number(k.search_volume),
    pages: pages
      .filter((p) => p.keyword_id === k.keyword_id)
      .map((p) => ({
        url: p.url,
        impressions: Number(p.impressions) || 0,
        clicks: Number(p.clicks) || 0,
        position: p.position == null ? null : Number(p.position),
      })),
  }));
}
