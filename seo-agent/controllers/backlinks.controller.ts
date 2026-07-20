import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Backlink, BacklinkJSON } from "../models/backlinks.model.js";
import { pool } from "../../db.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: Backlink): BacklinkJSON {
  return {
    ...row,
    is_new: Boolean(row.is_new),
    is_lost: Boolean(row.is_lost),
    is_broken: Boolean(row.is_broken),
    anchor_details:
      typeof row.anchor_details === "string"
        ? JSON.parse(row.anchor_details)
        : row.anchor_details,
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
export async function createBacklink(
  data: Pick<
    Backlink,
    | "id"
    | "site_id"
    | "url_from"
    | "url_to"
    | "owner_type"
    | "domain_from_rank"
    | "anchor_details"
    | "is_new"
    | "is_lost"
    | "is_broken"
    | "first_seen"
    | "last_seen"
    | "spam_score"
  >,
): Promise<BacklinkJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO backlinks
      (id, site_id, owner_type, url_from, url_to, domain_from_rank,
       anchor_details, is_new, is_lost, is_broken, first_seen, last_seen, spam_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.site_id,
      data.owner_type ?? null,
      data.url_from,
      data.url_to,
      data.domain_from_rank ?? null,
      data.anchor_details != null ? JSON.stringify(data.anchor_details) : null,
      data.is_new ?? false,
      data.is_lost ?? false,
      data.is_broken ?? false,
      data.first_seen ?? null,
      data.last_seen ?? null,
      data.spam_score ?? null,
    ],
  );
  return (await getBacklinkById(data.id))!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listBacklinks(filters: {
  site_id?: number;
  is_new?: boolean;
  is_lost?: boolean;
  is_broken?: boolean;
  owner_type?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  backlinks: BacklinkJSON[];
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
  if (filters.is_lost !== undefined) {
    conditions.push("is_lost = ?");
    params.push(filters.is_lost);
  }
  if (filters.is_broken !== undefined) {
    conditions.push("is_broken = ?");
    params.push(filters.is_broken);
  }
  if (filters.owner_type) {
    conditions.push("owner_type = ?");
    params.push(filters.owner_type);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM backlinks ${where}`,
      params,
    ),
    pool.query<Backlink[]>(
      `SELECT * FROM backlinks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  const backlinks = (rows as Backlink[]).map(toJSON);
  return { backlinks, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getBacklinkById(
  id: string,
): Promise<BacklinkJSON | null> {
  const [rows] = await pool.query<Backlink[]>(
    "SELECT * FROM backlinks WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── UPDATE ────────────────────────────────────────────────────────────
export async function updateBacklink(
  id: string,
  data: Partial<
    Pick<
      Backlink,
      | "owner_type"
      | "domain_from_rank"
      | "anchor_details"
      | "is_new"
      | "is_lost"
      | "is_broken"
      | "first_seen"
      | "last_seen"
      | "spam_score"
    >
  >,
): Promise<BacklinkJSON | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.owner_type !== undefined) {
    fields.push("owner_type = ?");
    params.push(data.owner_type);
  }
  if (data.domain_from_rank !== undefined) {
    fields.push("domain_from_rank = ?");
    params.push(data.domain_from_rank);
  }
  if (data.anchor_details !== undefined) {
    fields.push("anchor_details = ?");
    params.push(
      data.anchor_details != null ? JSON.stringify(data.anchor_details) : null,
    );
  }
  if (data.is_new !== undefined) {
    fields.push("is_new = ?");
    params.push(data.is_new);
  }
  if (data.is_lost !== undefined) {
    fields.push("is_lost = ?");
    params.push(data.is_lost);
  }
  if (data.is_broken !== undefined) {
    fields.push("is_broken = ?");
    params.push(data.is_broken);
  }
  if (data.first_seen !== undefined) {
    fields.push("first_seen = ?");
    params.push(data.first_seen);
  }
  if (data.last_seen !== undefined) {
    fields.push("last_seen = ?");
    params.push(data.last_seen);
  }
  if (data.spam_score !== undefined) {
    fields.push("spam_score = ?");
    params.push(data.spam_score);
  }

  if (fields.length === 0) return getBacklinkById(id);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE backlinks SET ${fields.join(", ")} WHERE id = ?`,
    [...params, id],
  );

  if (result.affectedRows === 0) return null;
  return getBacklinkById(id);
}

// ── DELETE ────────────────────────────────────────────────────────────
export async function deleteBacklink(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM backlinks WHERE id = ?",
    [id],
  );
  return result.affectedRows > 0;
}

// ── BULK UPSERT ───────────────────────────────────────────────────────
export async function upsertBacklinks(
  records: Array<
    Pick<
      Backlink,
      | "id"
      | "site_id"
      | "url_from"
      | "url_to"
      | "owner_type"
      | "domain_from_rank"
      | "anchor_details"
      | "is_new"
      | "is_lost"
      | "is_broken"
      | "first_seen"
      | "last_seen"
      | "spam_score"
    >
  >,
): Promise<number> {
  if (records.length === 0) return 0;

  const placeholders = records
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");

  const params = records.flatMap((r) => [
    r.id,
    r.site_id,
    r.owner_type ?? null,
    r.url_from,
    r.url_to,
    r.domain_from_rank ?? null,
    r.anchor_details != null ? JSON.stringify(r.anchor_details) : null,
    r.is_new ?? false,
    r.is_lost ?? false,
    r.is_broken ?? false,
    r.first_seen ?? null,
    r.last_seen ?? null,
    r.spam_score ?? null,
  ]);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO backlinks
      (id, site_id, owner_type, url_from, url_to, domain_from_rank,
       anchor_details, is_new, is_lost, is_broken, first_seen, last_seen, spam_score)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       owner_type        = COALESCE(VALUES(owner_type), owner_type ),
       domain_from_rank  = COALESCE(VALUES(domain_from_rank), domain_from_rank),
       anchor_details    = COALESCE(VALUES(anchor_details), anchor_details),
       is_new            = COALESCE(VALUES(is_new), is_new),
       is_lost           = COALESCE(VALUES(is_lost), is_lost),
       is_broken         = COALESCE(VALUES(is_broken), is_broken),
       first_seen        = COALESCE(VALUES(first_seen), first_seen),
       last_seen         = COALESCE(VALUES(last_seen), last_seen),
       spam_score        = COALESCE(VALUES(spam_score), spam_score)`,
    params,
  );

  return result.affectedRows;
}
