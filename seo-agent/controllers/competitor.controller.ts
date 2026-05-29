import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";
import {
  CompetitorConfig,
  CompetitorConfigJSON,
} from "../models/competitor-config.model.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: CompetitorConfig): CompetitorConfigJSON {
  return {
    ...row,
    competitor_domain:
      typeof row.competitor_domain === "string"
        ? JSON.parse(row.competitor_domain)
        : row.competitor_domain,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createCompetitorConfig(
  data: Pick<
    CompetitorConfig,
    "id" | "site_id" | "domain" | "competitor_domain"
  >,
): Promise<CompetitorConfigJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO competitor_config (id, site_id, domain, competitor_domain, created_at)
     VALUES (?, ?, ?, ?, NOW(3))`,
    [
      data.id,
      data.site_id,
      data.domain,
      JSON.stringify(data.competitor_domain),
    ],
  );
  const config = await getCompetitorConfigById(data.id);
  return config!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listCompetitorConfigs(filters: {
  limit?: number;
  offset?: number;
}): Promise<{
  competitors: CompetitorConfigJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // if (filters.site_id) {
  //   conditions.push("site_id = ?");
  //   params.push(filters.site_id);
  // }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 10, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM competitor_config ${where}`,
      params,
    ),
    pool.query<CompetitorConfig[]>(
      `SELECT * FROM competitor_config ${where} ORDER BY site_id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  const competitors = (rows as CompetitorConfig[]).map(toJSON);
  return { competitors, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getCompetitorConfigById(
  id: string,
): Promise<CompetitorConfigJSON | null> {
  const [rows] = await pool.query<CompetitorConfig[]>(
    "SELECT * FROM competitor_config WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── UPDATE ────────────────────────────────────────────────────────────
export async function updateCompetitorConfig(
  id: string,
  data: Partial<Pick<CompetitorConfig, "competitor_domain">>,
): Promise<CompetitorConfigJSON | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.competitor_domain !== undefined) {
    fields.push("competitor_domain = ?");
    params.push(JSON.stringify(data.competitor_domain));
  }

  if (fields.length === 0) return getCompetitorConfigById(id);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE competitor_config SET ${fields.join(", ")} WHERE id = ?`,
    [...params, id],
  );

  if (result.affectedRows === 0) return null;
  return getCompetitorConfigById(id);
}

// ── DELETE ────────────────────────────────────────────────────────────
export async function deleteCompetitorConfig(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM competitor_config WHERE id = ?",
    [id],
  );
  return result.affectedRows > 0;
}
