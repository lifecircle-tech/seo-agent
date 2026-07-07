import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  SeoReport,
  SeoReportJSON,
  ReportType,
  ReportPayload,
} from "../models/seo-report.model.js";
import { pool } from "../../db.js";

// ── Row serialiser ────────────────────────────────────────────────────

function toJSON(row: SeoReport): SeoReportJSON {
  return {
    ...row,
    data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

// ── CREATE ────────────────────────────────────────────────────────────

export async function createSeoReport(data: {
  id: string;
  site_id: number;
  report_type: ReportType;
  summary: string;
  payload: ReportPayload;
}): Promise<SeoReportJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO seo_reports (id, site_id, report_type, summary, data, created_at)
     VALUES (?, ?, ?, ?, ?, NOW(3))`,
    [
      data.id,
      data.site_id,
      data.report_type,
      data.summary,
      JSON.stringify(data.payload),
    ],
  );
  const report = await getSeoReportById(data.id);
  return report!;
}

// ── GET BY ID ─────────────────────────────────────────────────────────

export async function getSeoReportById(
  id: string,
): Promise<SeoReportJSON | null> {
  const [rows] = await pool.query<SeoReport[]>(
    "SELECT * FROM seo_reports WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── GET LATEST ────────────────────────────────────────────────────────

export async function getLatestSeoReport(
  siteId: number,
  reportType: ReportType,
): Promise<SeoReportJSON | null> {
  const [rows] = await pool.query<SeoReport[]>(
    `SELECT * FROM seo_reports
     WHERE site_id = ? AND report_type = ?
     ORDER BY created_at DESC
     LIMIT 3`,
    [siteId, reportType],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

export async function getAllLatestSeoReport(): Promise<SeoReportJSON[] | null> {
  const [rows] = await pool.query<SeoReport[]>(
    `SELECT * FROM seo_reports
     WHERE created_at >= CURRENT_DATE - INTERVAL 7 DAY
     ORDER BY created_at DESC
     LIMIT 5`,
  );
  return rows.length ? rows.map(toJSON) : null;
}

// ── LIST ──────────────────────────────────────────────────────────────

export async function listSeoReports(filters: {
  site_id?: number;
  report_type?: ReportType;
  limit?: number;
  offset?: number;
}): Promise<{
  reports: SeoReportJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.site_id !== undefined) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }
  if (filters.report_type) {
    conditions.push("report_type = ?");
    params.push(filters.report_type);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM seo_reports ${where}`,
      params,
    ),
    pool.query<SeoReport[]>(
      `SELECT * FROM seo_reports ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  const reports = (rows as SeoReport[]).map(toJSON);
  return { reports, total, limit, offset };
}

// ── LIST LATEST PER TYPE ──────────────────────────────────────────────
// Returns one row per report_type for a given site — useful for dashboards.

export async function getLatestReportsForSite(
  siteId: number,
): Promise<Record<ReportType, SeoReportJSON | null>> {
  const types: ReportType[] = ["backlinks", "sitemap_ads", "missing_pages"];
  const results = await Promise.all(
    types.map((t) => getLatestSeoReport(siteId, t)),
  );
  return Object.fromEntries(types.map((t, i) => [t, results[i]])) as Record<
    ReportType,
    SeoReportJSON | null
  >;
}
