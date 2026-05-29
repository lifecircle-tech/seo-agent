import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";
import {
  KeywordConfig,
  KeywordConfigJSON,
} from "../models/keywords-config.model.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: KeywordConfig): KeywordConfigJSON {
  return {
    ...row,
    target_keywords:
      typeof row.target_keywords === "string"
        ? JSON.parse(row.target_keywords)
        : row.target_keywords,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createKeywordConfig(
  data: Pick<KeywordConfig, "id" | "site_id" | "domain" | "target_keywords">,
): Promise<KeywordConfigJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO keywords_config (id, site_id, domain, target_keywords, created_at)
     VALUES (?, ?, ?, ?, NOW(3))`,
    [data.id, data.site_id, data.domain, JSON.stringify(data.target_keywords)],
  );
  const config = await getKeywordConfigById(data.id);
  return config!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listKeywordsConfigs(filters: {
  limit?: number;
  offset?: number;
}): Promise<{
  keywords: KeywordConfigJSON[];
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
      `SELECT COUNT(*) AS count FROM keywords_config ${where}`,
      params,
    ),
    pool.query<KeywordConfig[]>(
      `SELECT * FROM keywords_config ${where} ORDER BY site_id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  const keywords = (rows as KeywordConfig[]).map(toJSON);
  return { keywords, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getKeywordConfigById(
  id: string,
): Promise<KeywordConfigJSON | null> {
  const [rows] = await pool.query<KeywordConfig[]>(
    "SELECT * FROM keywords_config WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── UPDATE ────────────────────────────────────────────────────────────
export async function updateKeywordConfig(
  id: string,
  data: Partial<Pick<KeywordConfig, "domain" | "target_keywords">>,
): Promise<KeywordConfigJSON | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.domain !== undefined) {
    fields.push("domain = ?");
    params.push(data.domain);
  }
  if (data.target_keywords !== undefined) {
    fields.push("target_keywords = ?");
    params.push(JSON.stringify(data.target_keywords));
  }

  if (fields.length === 0) return getKeywordConfigById(id);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE keywords_config SET ${fields.join(", ")} WHERE id = ?`,
    [...params, id],
  );

  if (result.affectedRows === 0) return null;
  return getKeywordConfigById(id);
}

// ── DELETE ────────────────────────────────────────────────────────────
export async function deleteKeywordConfig(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM keywords_config WHERE id = ?",
    [id],
  );
  return result.affectedRows > 0;
}
