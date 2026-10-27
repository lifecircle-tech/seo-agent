/**
 * Weekly keyword ranking history.
 *
 * snapshotKeywordRanks() copies the current position/impressions/clicks of every
 * tracked keyword (as refreshed by the Monday weekly job) into keyword_rank_history,
 * one row per keyword per week (week_start = Monday, IST). Re-running in the same
 * week overwrites that week's row.
 */

import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";
import { logger } from "../utils/logger.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Monday (yyyy-mm-dd, IST) of the week containing `d`. */
export function weekStartIST(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const dow = ist.getUTCDay(); // 0 = Sunday
  ist.setUTCDate(ist.getUTCDate() - ((dow + 6) % 7));
  return ist.toISOString().slice(0, 10);
}

export async function snapshotKeywordRanks(): Promise<number> {
  const week = weekStartIST();
  try {
    const [result]: any = await pool.query(
      `INSERT INTO keyword_rank_history
         (keyword_id, week_start, site_id, keyword, position, impressions, clicks, ctr, search_volume)
       SELECT id, ?, site_id, LEFT(keyword, 255), NULLIF(position, 0), impressions, clicks, ctr, search_volume
       FROM keywords
       ON DUPLICATE KEY UPDATE
         position = VALUES(position), impressions = VALUES(impressions), clicks = VALUES(clicks),
         ctr = VALUES(ctr), search_volume = VALUES(search_volume)`,
      [week],
    );
    logger.info(`[rank-history] snapshot for week ${week}: ${result.affectedRows ?? 0} row(s)`);
    return result.affectedRows ?? 0;
  } catch (err: any) {
    logger.error(`[rank-history] snapshot failed: ${err.message}`, err);
    return 0;
  }
}

/** Weekly positions for one keyword, oldest first. */
export async function getKeywordHistory(keywordId: string, weeks = 26) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT week_start, position, impressions, clicks, ctr
     FROM keyword_rank_history
     WHERE keyword_id = ? AND week_start >= CURDATE() - INTERVAL ? WEEK
     ORDER BY week_start ASC`,
    [keywordId, weeks],
  );
  return rows.map((r) => ({
    week_start: r.week_start instanceof Date ? r.week_start.toISOString().slice(0, 10) : String(r.week_start).slice(0, 10),
    position: r.position == null ? null : Number(r.position),
    impressions: r.impressions == null ? null : Number(r.impressions),
    clicks: r.clicks == null ? null : Number(r.clicks),
    ctr: r.ctr == null ? null : Number(r.ctr),
  }));
}

/**
 * Site-level trend per week: how many keywords sit in each position band, plus total
 * clicks/impressions. Optionally only keywords naming one of `cities` (city + service searches).
 */
export async function getSiteRankTrend(siteId: number, weeks = 12, cities: string[] = []) {
  const cityFilter = cities.length
    ? `AND (${cities.map(() => "LOWER(keyword) LIKE ?").join(" OR ")})`
    : "";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT week_start,
            COUNT(*) AS tracked,
            SUM(position IS NOT NULL AND position <= 3) AS top3,
            SUM(position > 3 AND position <= 10) AS top4_10,
            SUM(position > 10 AND position <= 20) AS top11_20,
            SUM(position IS NULL OR position > 20) AS beyond20,
            SUM(COALESCE(clicks, 0)) AS clicks,
            SUM(COALESCE(impressions, 0)) AS impressions
     FROM keyword_rank_history
     WHERE site_id = ? AND week_start >= CURDATE() - INTERVAL ? WEEK ${cityFilter}
     GROUP BY week_start
     ORDER BY week_start ASC`,
    [siteId, weeks, ...cities.map((c) => `%${c.toLowerCase()}%`)],
  );
  return rows.map((r) => ({
    week_start: r.week_start instanceof Date ? r.week_start.toISOString().slice(0, 10) : String(r.week_start).slice(0, 10),
    tracked: Number(r.tracked),
    top3: Number(r.top3),
    top4_10: Number(r.top4_10),
    top11_20: Number(r.top11_20),
    beyond20: Number(r.beyond20),
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
  }));
}
