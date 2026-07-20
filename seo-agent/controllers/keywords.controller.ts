import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Keyword, KeywordJSON } from "../models/keywords.model.js";
import { pool } from "../../db.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: Keyword): KeywordJSON {
  return {
    ...row,
    is_new: Boolean(row.is_new),
    monthly_searches:
      typeof row.monthly_searches === "string"
        ? JSON.parse(row.monthly_searches)
        : row.monthly_searches,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createKeyword(
  data: Pick<
    Keyword,
    | "id"
    | "site_id"
    | "keyword"
    | "is_new"
    | "clicks"
    | "impressions"
    | "search_volume"
    | "difficulty"
    | "position"
    | "cpc"
    | "ctr"
    | "competition"
    | "competition_level"
    | "monthly_searches"
    | "pages_used"
  >,
): Promise<KeywordJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO keywords
      (id, site_id, is_new, keyword, clicks, impressions, search_volume,
       difficulty, position, cpc, ctr, competition, competition_level,
       monthly_searches, pages_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.site_id,
      data.is_new ?? false,
      data.keyword,
      data.clicks ?? null,
      data.impressions ?? null,
      data.search_volume ?? null,
      data.difficulty ?? null,
      data.position ?? null,
      data.cpc ?? null,
      data.ctr ?? null,
      data.competition ?? null,
      data.competition_level ?? null,
      data.monthly_searches != null
        ? JSON.stringify(data.monthly_searches)
        : null,
      data.pages_used != null ? JSON.stringify(data.pages_used) : null,
    ],
  );
  return (await getKeywordById(data.id))!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listKeywords(filters: {
  site_id?: number;
  is_new?: boolean;
  keyword?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  keywords: KeywordJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filters.site_id !== undefined) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }
  if (filters.is_new !== undefined) {
    conditions.push("is_new = ?");
    params.push(filters.is_new);
  }
  if (filters.keyword) {
    conditions.push("keyword LIKE ?");
    params.push(`%${filters.keyword}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM keywords ${where}`,
      params,
    ),
    pool.query<Keyword[]>(
      `SELECT * FROM keywords ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  const keywords = (rows as Keyword[]).map(toJSON);
  return { keywords, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getKeywordById(id: string): Promise<KeywordJSON | null> {
  const [rows] = await pool.query<Keyword[]>(
    "SELECT * FROM keywords WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── UPDATE ────────────────────────────────────────────────────────────
export async function updateKeyword(
  id: string,
  data: Partial<
    Pick<
      Keyword,
      | "is_new"
      | "keyword"
      | "clicks"
      | "impressions"
      | "search_volume"
      | "difficulty"
      | "position"
      | "cpc"
      | "ctr"
      | "competition"
      | "competition_level"
      | "monthly_searches"
      | "pages_used"
    >
  >,
): Promise<KeywordJSON | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.is_new !== undefined) {
    fields.push("is_new = ?");
    params.push(data.is_new);
  }
  if (data.keyword !== undefined) {
    fields.push("keyword = ?");
    params.push(data.keyword);
  }
  if (data.clicks !== undefined) {
    fields.push("clicks = ?");
    params.push(data.clicks);
  }
  if (data.impressions !== undefined) {
    fields.push("impressions = ?");
    params.push(data.impressions);
  }
  if (data.search_volume !== undefined) {
    fields.push("search_volume = ?");
    params.push(data.search_volume);
  }
  if (data.difficulty !== undefined) {
    fields.push("difficulty = ?");
    params.push(data.difficulty);
  }
  if (data.position !== undefined) {
    fields.push("position = ?");
    params.push(data.position);
  }
  if (data.cpc !== undefined) {
    fields.push("cpc = ?");
    params.push(data.cpc);
  }
  if (data.ctr !== undefined) {
    fields.push("ctr = ?");
    params.push(data.ctr);
  }
  if (data.competition !== undefined) {
    fields.push("competition = ?");
    params.push(data.competition);
  }
  if (data.competition_level !== undefined) {
    fields.push("competition_level = ?");
    params.push(data.competition_level);
  }
  if (data.monthly_searches !== undefined) {
    fields.push("monthly_searches = ?");
    params.push(
      data.monthly_searches != null
        ? JSON.stringify(data.monthly_searches)
        : null,
    );
  }
  if (data.pages_used != undefined) {
    fields.push("pages_used = ?");
    params.push(
      data.pages_used != undefined ? JSON.stringify(data.pages_used) : null,
    );
  }

  if (fields.length === 0) return getKeywordById(id);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE keywords SET ${fields.join(", ")} WHERE id = ?`,
    [...params, id],
  );

  if (result.affectedRows === 0) return null;
  return getKeywordById(id);
}

// ── DELETE ────────────────────────────────────────────────────────────
export async function deleteKeyword(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM keywords WHERE id = ?",
    [id],
  );
  return result.affectedRows > 0;
}

// ── BULK UPSERT ───────────────────────────────────────────────────────
export async function upsertKeywords(
  records: Array<
    Pick<
      Keyword,
      | "id"
      | "site_id"
      | "keyword"
      | "is_new"
      | "clicks"
      | "impressions"
      | "search_volume"
      | "difficulty"
      | "position"
      | "cpc"
      | "ctr"
      | "competition"
      | "competition_level"
      | "monthly_searches"
      | "pages_used"
    >
  >,
): Promise<number> {
  if (records.length === 0) return 0;

  const placeholders = records
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const params = records.flatMap((r) => [
    r.id,
    r.site_id,
    r.is_new ?? false,
    r.keyword,
    r.clicks ?? null,
    r.impressions ?? null,
    r.search_volume ?? null,
    r.difficulty ?? null,
    r.position ?? null,
    r.cpc ?? null,
    r.ctr ?? null,
    r.competition ?? null,
    r.competition_level ?? null,
    r.monthly_searches != null ? JSON.stringify(r.monthly_searches) : null,
    r.pages_used != null ? JSON.stringify(r.pages_used) : null,
  ]);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO keywords
      (id, site_id, is_new, keyword, clicks, impressions, search_volume,
       difficulty, position, cpc, ctr, competition, competition_level,
       monthly_searches, pages_used)
    VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE
      is_new            = COALESCE(VALUES(is_new), is_new),
      clicks            = COALESCE(VALUES(clicks), clicks),
      impressions       = COALESCE(VALUES(impressions), impressions),
      search_volume     = COALESCE(VALUES(search_volume), search_volume),
      difficulty        = COALESCE(VALUES(difficulty), difficulty),
      position          = COALESCE(VALUES(position), position),
      cpc               = COALESCE(VALUES(cpc), cpc),
      ctr               = COALESCE(VALUES(ctr), ctr),
      competition       = COALESCE(VALUES(competition), competition),
      competition_level = COALESCE(VALUES(competition_level), competition_level),
      monthly_searches  = COALESCE(VALUES(monthly_searches), monthly_searches),
      pages_used        = COALESCE(VALUES(pages_used), pages_used)`,
    params,
  );

  return result.affectedRows;
}
