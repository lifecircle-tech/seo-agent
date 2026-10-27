/**
 * Before/after impact of published SEO changes.
 *
 * When a change goes live (meta rewrite or canonical approved, page content
 * marked created/updated, opportunity completed by a person) we record one row
 * per affected URL. Once the "after" window has passed, a daily job pulls
 * Search Console totals for the 28 days before and the 28 days after the change.
 *
 * Windows (IST dates, change day excluded):
 *   before = [d-28, d-1]   after = [d+1, d+28]
 * Measured when today >= after_end + GSC_LAG_DAYS.
 */

import { createHash, randomUUID } from "node:crypto";
import { ResultSetHeader } from "mysql2/promise";
import { pool } from "../../db.js";
import { logger } from "../utils/logger.js";
import { ChangeImpact, ChangeSourceType } from "../models/change-impact.model.js";
import { getPagePerformanceBetween } from "./google.service.js";
import { getSiteBySiteID } from "../controllers/sites.controller.js";

export const WINDOW_DAYS = 28;
export const GSC_LAG_DAYS = 3;
const MAX_ATTEMPTS = 5;
const MEASURE_BATCH = 300;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** A change counts as improved/declined only past this click delta (absolute, and % of before). */
const MIN_CLICK_DELTA = 3;
const MIN_CLICK_DELTA_PCT = 0.1;

// ── Dates ─────────────────────────────────────────────────────────────

function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function changeWindows(changedAt: Date) {
  const day = istDate(changedAt);
  return {
    before_start: addDays(day, -WINDOW_DAYS),
    before_end: addDays(day, -1),
    after_start: addDays(day, 1),
    after_end: addDays(day, WINDOW_DAYS),
    /** first date the result can be measured */
    ready_on: addDays(day, WINDOW_DAYS + GSC_LAG_DAYS),
  };
}

const hashUrl = (url: string) => createHash("sha256").update(url).digest("hex");

// ── Recording ─────────────────────────────────────────────────────────

/**
 * Records a published change. Never throws — a tracking failure must not fail
 * the approval / status change that triggered it.
 */
export async function recordChange(input: {
  site_id: number;
  source_type: ChangeSourceType;
  source_id: string;
  change_type: string;
  urls: (string | null | undefined)[];
  changed_at?: Date;
}): Promise<void> {
  try {
    const urls = [...new Set(input.urls.map((u) => (u ?? "").trim()).filter((u) => /^https?:\/\//.test(u)))];
    if (!urls.length) return;

    const changedAt = input.changed_at ?? new Date();
    const w = changeWindows(changedAt);

    for (const url of urls) {
      // Re-recording the same source+URL (e.g. a status set twice) keeps the first change date
      await pool.query(
        `INSERT IGNORE INTO change_impact
           (id, site_id, source_type, source_id, change_type, url, url_hash, changed_at,
            before_start, before_end, after_start, after_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), input.site_id, input.source_type, input.source_id, input.change_type,
          url.slice(0, 1000), hashUrl(url), changedAt,
          w.before_start, w.before_end, w.after_start, w.after_end,
        ],
      );
    }
    logger.info(
      `[change-impact] tracking ${input.change_type} ${input.source_type}=${input.source_id} (${urls.length} url) — result after ${w.ready_on}`,
    );
  } catch (err: any) {
    logger.error(`[change-impact] could not record ${input.source_type}=${input.source_id}: ${err.message}`);
  }
}

// ── Measuring (daily job) ─────────────────────────────────────────────

export async function measureDueChanges(): Promise<{ measured: number; failed: number }> {
  const today = istDate(new Date());
  const cutoff = addDays(today, -GSC_LAG_DAYS);

  const [rows] = await pool.query<ChangeImpact[]>(
    `SELECT * FROM change_impact
     WHERE status = 'waiting' AND after_end <= ?
     ORDER BY after_end ASC
     LIMIT ?`,
    [cutoff, MEASURE_BATCH],
  );
  if (!rows.length) {
    logger.info("[change-impact] nothing due for measurement");
    return { measured: 0, failed: 0 };
  }

  const siteUrls = new Map<number, string | null>();
  let measured = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (!siteUrls.has(row.site_id)) {
        const site = await getSiteBySiteID(row.site_id);
        siteUrls.set(row.site_id, (site as any)?.domain ?? null);
      }
      const siteUrl = siteUrls.get(row.site_id);
      if (!siteUrl) throw new Error(`no domain configured for site ${row.site_id}`);

      const fmt = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
      const before = await getPagePerformanceBetween(siteUrl, row.url, fmt(row.before_start), fmt(row.before_end));
      const after = await getPagePerformanceBetween(siteUrl, row.url, fmt(row.after_start), fmt(row.after_end));

      await pool.query<ResultSetHeader>(
        `UPDATE change_impact SET
           before_clicks = ?, before_impressions = ?, before_ctr = ?, before_position = ?,
           after_clicks = ?, after_impressions = ?, after_ctr = ?, after_position = ?,
           status = 'measured', error = NULL, measured_at = NOW(3), attempts = attempts + 1
         WHERE id = ?`,
        [
          before.clicks, before.impressions, before.ctr, before.position,
          after.clicks, after.impressions, after.ctr, after.position,
          row.id,
        ],
      );
      measured++;
    } catch (err: any) {
      failed++;
      const attempts = row.attempts + 1;
      await pool.query(
        `UPDATE change_impact SET attempts = ?, error = ?, status = ? WHERE id = ?`,
        [attempts, String(err.message).slice(0, 2000), attempts >= MAX_ATTEMPTS ? "failed" : "waiting", row.id],
      );
      logger.warn(`[change-impact] measure failed for ${row.url} (attempt ${attempts}): ${err.message}`);
    }
  }

  logger.info(`[change-impact] measured ${measured}, failed ${failed}`);
  return { measured, failed };
}

// ── Reading ───────────────────────────────────────────────────────────

export type ImpactVerdict = "improved" | "declined" | "unchanged" | "waiting" | "failed";

export function verdict(row: Pick<ChangeImpact, "status" | "before_clicks" | "after_clicks">): ImpactVerdict {
  if (row.status !== "measured") return row.status === "failed" ? "failed" : "waiting";
  const before = row.before_clicks ?? 0;
  const delta = (row.after_clicks ?? 0) - before;
  const threshold = Math.max(MIN_CLICK_DELTA, before * MIN_CLICK_DELTA_PCT);
  if (delta >= threshold) return "improved";
  if (delta <= -threshold) return "declined";
  return "unchanged";
}

function toJSON(row: ChangeImpact) {
  const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  return {
    id: row.id,
    site_id: row.site_id,
    source_type: row.source_type,
    source_id: row.source_id,
    change_type: row.change_type,
    url: row.url,
    changed_at: row.changed_at,
    before: { start: day(row.before_start), end: day(row.before_end), clicks: row.before_clicks, impressions: row.before_impressions, ctr: row.before_ctr, position: row.before_position },
    after: { start: day(row.after_start), end: day(row.after_end), clicks: row.after_clicks, impressions: row.after_impressions, ctr: row.after_ctr, position: row.after_position },
    status: row.status,
    verdict: verdict(row),
    ready_on: addDays(day(row.after_end), GSC_LAG_DAYS),
    measured_at: row.measured_at,
  };
}

export async function listImpactBySources(
  sourceType: ChangeSourceType,
  sourceIds: string[],
) {
  const ids = [...new Set(sourceIds.filter(Boolean))].slice(0, 200);
  if (!ids.length) return [];
  const [rows] = await pool.query<ChangeImpact[]>(
    `SELECT * FROM change_impact WHERE source_type = ? AND source_id IN (?) ORDER BY changed_at DESC`,
    [sourceType, ids],
  );
  return rows.map(toJSON);
}

/** Roll-up for a site over changes made in the last `days` days. */
export async function summarizeImpact(siteId: number, days: number) {
  const [rows] = await pool.query<ChangeImpact[]>(
    `SELECT * FROM change_impact
     WHERE site_id = ? AND changed_at >= NOW(3) - INTERVAL ? DAY`,
    [siteId, days],
  );

  const byType = new Map<string, { tracked: number; measured: number; improved: number; declined: number; unchanged: number; clicks_before: number; clicks_after: number }>();
  const totals = { tracked: 0, waiting: 0, measured: 0, failed: 0, improved: 0, declined: 0, unchanged: 0, clicks_before: 0, clicks_after: 0 };
  let nextReady: string | null = null;

  for (const row of rows) {
    const v = verdict(row);
    const t = byType.get(row.change_type) ?? { tracked: 0, measured: 0, improved: 0, declined: 0, unchanged: 0, clicks_before: 0, clicks_after: 0 };
    totals.tracked++;
    t.tracked++;
    if (row.status === "measured") {
      totals.measured++;
      t.measured++;
      totals.clicks_before += row.before_clicks ?? 0;
      totals.clicks_after += row.after_clicks ?? 0;
      t.clicks_before += row.before_clicks ?? 0;
      t.clicks_after += row.after_clicks ?? 0;
      if (v === "improved") { totals.improved++; t.improved++; }
      if (v === "declined") { totals.declined++; t.declined++; }
      if (v === "unchanged") { totals.unchanged++; t.unchanged++; }
    } else if (row.status === "failed") {
      totals.failed++;
    } else {
      totals.waiting++;
      const ready = toJSON(row).ready_on;
      if (!nextReady || ready < nextReady) nextReady = ready;
    }
    byType.set(row.change_type, t);
  }

  return {
    site_id: siteId,
    days,
    window_days: WINDOW_DAYS,
    ...totals,
    next_result_on: nextReady,
    by_type: [...byType.entries()].map(([change_type, t]) => ({ change_type, ...t })),
  };
}
