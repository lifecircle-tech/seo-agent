import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { PaaQuestion, PaaQuestionJSON } from "../models/paa.model.js";
import { pool } from "../../db.js";

// ── Row serialiser ────────────────────────────────────────────────────

function toJSON(row: PaaQuestion): PaaQuestionJSON {
  return {
    ...row,
    used_in_content: Boolean(row.used_in_content),
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

export async function createPaaQuestion(data: {
  id: string;
  site_id: number;
  keyword_id: string;
  question: string;
  answer?: string | null;
  source_url?: string | null;
  category?: string | null;
}): Promise<PaaQuestionJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO paa_questions
       (id, site_id, keyword_id, question, answer, source_url, category, used_in_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, false)`,
    [
      data.id,
      data.site_id,
      data.keyword_id,
      data.question,
      data.answer ?? null,
      data.source_url ?? null,
      data.category ?? null,
    ],
  );
  return (await getPaaQuestionById(data.id))!;
}

// ── BULK UPSERT ───────────────────────────────────────────────────────
// Idempotent: duplicate (keyword_id, question) updates answer/source/category.

export async function bulkUpsertPaaQuestions(
  items: Array<{
    id: string;
    site_id: number;
    keyword_id: string;
    question: string;
    answer?: string | null;
    source_url?: string | null;
    category?: string | null;
  }>,
): Promise<number> {
  if (items.length === 0) return 0;

  const placeholders = items
    .map(() => "(?, ?, ?, ?, ?, ?, ?, false)")
    .join(", ");

  const params = items.flatMap((i) => [
    i.id,
    i.site_id,
    i.keyword_id,
    i.question,
    i.answer ?? null,
    i.source_url ?? null,
    i.category ?? null,
  ]);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO paa_questions
       (id, site_id, keyword_id, question, answer, source_url, category, used_in_content)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       answer     = COALESCE(VALUES(answer), answer),
       source_url = COALESCE(VALUES(source_url), source_url),
       category   = COALESCE(VALUES(category), category),
       updated_at = NOW(3)`,
    params,
  );

  return result.affectedRows;
}

// ── LIST ──────────────────────────────────────────────────────────────

export async function listPaaQuestions(filters: {
  site_id?: number;
  keyword_id?: string;
  category?: string;
  used_in_content?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{
  questions: PaaQuestionJSON[];
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
  if (filters.keyword_id) {
    conditions.push("keyword_id = ?");
    params.push(filters.keyword_id);
  }
  if (filters.category) {
    conditions.push("category = ?");
    params.push(filters.category);
  }
  if (filters.used_in_content !== undefined) {
    conditions.push("used_in_content = ?");
    params.push(filters.used_in_content);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 20, 200);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM paa_questions ${where}`,
      params,
    ),
    pool.query<PaaQuestion[]>(
      `SELECT * FROM paa_questions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  return {
    questions: (rows as PaaQuestion[]).map(toJSON),
    total,
    limit,
    offset,
  };
}

// ── GET BY ID ─────────────────────────────────────────────────────────

export async function getPaaQuestionById(
  id: string,
): Promise<PaaQuestionJSON | null> {
  const [rows] = await pool.query<PaaQuestion[]>(
    "SELECT * FROM paa_questions WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── GET BY KEYWORD ────────────────────────────────────────────────────
// Fetch all PAA questions for a keyword, optionally filtering unused ones.
// Primary use case: feed into content generation prompt.

export async function getPaaQuestionsForKeyword(
  keywordId: string,
  onlyUnused = false,
): Promise<PaaQuestionJSON[]> {
  const where = onlyUnused
    ? "WHERE keyword_id = ? AND used_in_content = false"
    : "WHERE keyword_id = ?";

  const [rows] = await pool.query<PaaQuestion[]>(
    `SELECT * FROM paa_questions ${where} ORDER BY created_at ASC`,
    [keywordId],
  );
  return (rows as PaaQuestion[]).map(toJSON);
}

// ── GET BY KEYWORD IDs (batch) ────────────────────────────────────────
// Fetch PAA questions for multiple keywords at once.
// Returns a map: keyword_id → PaaQuestionJSON[]

export async function getPaaQuestionsForKeywords(
  keywordIds: string[],
  onlyUnused = false,
): Promise<Map<string, PaaQuestionJSON[]>> {
  if (keywordIds.length === 0) return new Map();

  const usedFilter = onlyUnused ? " AND used_in_content = false" : "";
  const [rows] = await pool.query<PaaQuestion[]>(
    `SELECT * FROM paa_questions WHERE keyword_id IN (?)${usedFilter} ORDER BY created_at ASC`,
    [keywordIds],
  );

  const result = new Map<string, PaaQuestionJSON[]>();
  for (const row of rows as PaaQuestion[]) {
    const list = result.get(row.keyword_id) ?? [];
    list.push(toJSON(row));
    result.set(row.keyword_id, list);
  }
  return result;
}

// ── MARK AS USED ──────────────────────────────────────────────────────
// Call this after questions are consumed by content generation.

export async function markPaaQuestionsAsUsed(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE paa_questions SET used_in_content = true, updated_at = NOW(3) WHERE id IN (?)",
    [ids],
  );
  return result.affectedRows;
}

// ── DELETE ────────────────────────────────────────────────────────────

export async function deletePaaQuestion(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM paa_questions WHERE id = ?",
    [id],
  );
  return result.affectedRows > 0;
}
