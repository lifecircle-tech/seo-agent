import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Backlink, BacklinkJSON } from "../models/backlinks.model.js";
import { lc_pool, pool } from "../../db.js";

// ── Status labels ─────────────────────────────────────────────────────
const BACKLINK_STATUS: Record<number, string> = {
  1: "added",
  5: "ignored",
  6: "removed",
};

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: Backlink): BacklinkJSON {
  return {
    ...row,
    is_new: Boolean(row.is_new),
    is_lost: Boolean(row.is_lost),
    is_broken: Boolean(row.is_broken),
    status:
      row.status != null
        ? (BACKLINK_STATUS[row.status] ?? String(row.status))
        : null,
    anchor_details:
      typeof row.anchor_details === "string"
        ? JSON.parse(row.anchor_details)
        : row.anchor_details,
    actioned_at: row.actioned_at
      ? row.actioned_at instanceof Date
        ? row.actioned_at.toISOString()
        : String(row.actioned_at)
      : null,
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
    | "domain_from"
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
      (id, site_id, owner_type, url_from, url_to, domain_from, domain_from_rank,
       anchor_details, is_new, is_lost, is_broken, first_seen, last_seen, spam_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.site_id,
      data.owner_type ?? null,
      data.url_from,
      data.url_to,
      data.domain_from ?? null,
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

// ── SORT ──────────────────────────────────────────────────────────────
const BACKLINK_SORTABLE_COLUMNS = [
  "domain_from",
  "url_from",
  "domain_from_rank",
  "spam_score",
  "first_seen",
  "last_seen",
  "status",
  "actioned_at",
  "created_at",
  "updated_at",
] as const;

type BacklinkSortColumn = (typeof BACKLINK_SORTABLE_COLUMNS)[number];

// ── LIST ──────────────────────────────────────────────────────────────
export async function listBacklinks(filters: {
  site_id?: number;
  is_new?: boolean;
  is_lost?: boolean;
  is_broken?: boolean;
  is_prospect?: boolean;
  owner_type?: string;
  limit?: number;
  offset?: number;
  sort_by?: BacklinkSortColumn;
  sort_order?: "asc" | "desc";
}): Promise<{
  backlinks: BacklinkJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params: unknown[] = [50];
  const conditions: string[] = ["spam_score <= ?"];

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
  if (filters.is_prospect !== undefined) {
    conditions.push("is_prospect = ?");
    params.push(filters.is_prospect);
  } else {
    conditions.push("is_prospect = ?");
    params.push(false);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const sortBy = BACKLINK_SORTABLE_COLUMNS.includes(
    filters.sort_by as BacklinkSortColumn,
  )
    ? (filters.sort_by as BacklinkSortColumn)
    : filters.is_prospect ? "status IS NOT NULL, status DESC, created_at" : "created_at";
  const sortOrder = filters.sort_order === "asc" ? "ASC" : "DESC";

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM backlinks ${where}`,
      params,
    ),
    pool.query<Backlink[]>(
      `SELECT * FROM backlinks ${where} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const userIds = new Set<number>();
  rows.forEach((row) => {
    if (row.actioned_by) userIds.add(row.actioned_by);
  });

  const userMap: Record<number, string> = {};
  if (userIds.size > 0) {
    const [users] = await lc_pool.query<any[]>(
      `SELECT emp_name, det_id FROM life_emp_details WHERE det_id IN (?)`,
      [[...userIds]],
    );
    users.forEach((u) => (userMap[u.det_id] = u.emp_name));
  }

  const total = Number((countRow as RowDataPacket[])[0].count);
  const backlinks = (rows as Backlink[]).map(toJSON).map((b) => ({
    ...b,
    actioned_user_name: b.actioned_by ? (userMap[b.actioned_by] ?? null) : null,
  }));
  return { backlinks, total, limit, offset };
}

// ── GET BY Backlinks by Domain Grouping ───────────────────────────────
export async function getBacklinksGroupedDomain(filters: {
  limit?: number;
  offset?: number;
}): Promise<{
  backlinks: {
    domain_from: string;
    domain_from_rank: number;
    spam_score: number;
    backlinks: Backlink[];
  }[];
  total: number;
  limit: number;
  offset: number;
}> {
  const limit = Math.min(filters.limit ?? 10, 100);
  const offset = filters.offset ?? 0;

  const conn = await pool.getConnection();
  try {
    await conn.query("SET SESSION group_concat_max_len = 20000");

    const [[countRow], [rows]] = await Promise.all([
      conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS count FROM (
          SELECT domain_from
          FROM backlinks
          WHERE is_prospect = false
          GROUP BY domain_from
        ) AS grouped_domains;
      `),
      conn.query<RowDataPacket[]>(
        `SELECT domain_from,
          domain_from_rank,
          spam_score,
          CONCAT(
            '[',
            GROUP_CONCAT(
              IF(is_prospect = false,
                JSON_OBJECT(
                  'id', id,
                  'url_from', url_from,
                  'url_to', url_to,
                  'anchor_details', anchor_details,
                  'is_new', is_new,
                  'is_lost', is_lost,
                  'is_broken', is_broken,
                  'spam_score', spam_score,
                  'first_seen', 'first_seen',
                  'last_seen', last_seen,
                  'status', status,
                  'actioned_by', actioned_by,
                  'actioned_at', actioned_at
                ),
                NULL
              )
            ),
            ']'
          ) AS backlink
        FROM backlinks
        GROUP BY domain_from
        HAVING backlink IS NOT NULL
        LIMIT ? OFFSET ?;
      `,
        [limit, offset],
      ),
    ]);

    const userMap = new Map();
    const backlinks = await Promise.all(
      rows.map(async (bl) => {
        const temp_bl = JSON.parse(bl.backlink);

        const userIds = new Set<number>(
          temp_bl.map((row: any) => {
            if (row.actioned_by && !userMap.has(row.actioned_by))
              return row.actioned_by;
          }),
        );

        if (userIds.size > 0) {
          const [users] = await lc_pool.query<any[]>(
            `SELECT emp_name, det_id FROM life_emp_details WHERE det_id IN (?)`,
            [[...userIds]],
          );

          users.forEach((u) => userMap.set(String(u.det_id), u.emp_name));
        }

        return {
          domain_from: bl.domain_from,
          domain_from_rank: bl.domain_from_rank,
          spam_score: bl.spam_score,
          backlinks: JSON.parse(bl.backlink)
            .map(toJSON)
            .map((b: Backlink) => ({
              ...b,
              actioned_user_name: userMap.get(b.actioned_by),
            })),
        };
      }),
    );

    const total = Number(countRow[0].count);
    return { backlinks, total, limit, offset };
  } finally {
    conn.release();
  }
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
      | "domain_from"
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
  if (data.domain_from !== undefined) {
    fields.push("domain_from = ?");
    params.push(data.domain_from);
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
      | "domain_from"
      | "domain_from_rank"
      | "anchor_details"
      | "is_new"
      | "is_lost"
      | "is_broken"
      | "first_seen"
      | "last_seen"
      | "spam_score"
    > & { is_prospect?: boolean }
  >,
): Promise<number> {
  if (records.length === 0) return 0;

  const placeholders = records
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");

  const params = records.flatMap((r) => [
    r.id,
    r.site_id,
    r.owner_type ?? null,
    r.url_from,
    r.url_to,
    r.domain_from ?? null,
    r.domain_from_rank ?? null,
    r.anchor_details != null ? JSON.stringify(r.anchor_details) : null,
    r.is_new ?? false,
    r.is_lost ?? false,
    r.is_broken ?? false,
    r.is_prospect ?? false,
    r.first_seen ?? null,
    r.last_seen ?? null,
    r.spam_score ?? null,
  ]);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO backlinks
      (id, site_id, owner_type, url_from, url_to, domain_from, domain_from_rank,
       anchor_details, is_new, is_lost, is_broken, is_prospect, first_seen, last_seen, spam_score)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       owner_type        = COALESCE(VALUES(owner_type), owner_type ),
       domain_from       = COALESCE(VALUES(domain_from), domain_from),
       domain_from_rank  = COALESCE(VALUES(domain_from_rank), domain_from_rank),
       anchor_details    = COALESCE(VALUES(anchor_details), anchor_details),
       is_new            = COALESCE(VALUES(is_new), is_new),
       is_lost           = COALESCE(VALUES(is_lost), is_lost),
       is_broken         = COALESCE(VALUES(is_broken), is_broken),
       is_prospect       = COALESCE(VALUES(is_prospect), is_prospect),
       first_seen        = COALESCE(VALUES(first_seen), first_seen),
       last_seen         = COALESCE(VALUES(last_seen), last_seen),
       spam_score        = COALESCE(VALUES(spam_score), spam_score)`,
    params,
  );

  return result.affectedRows;
}

// ── STATUS ACTIONS ────────────────────────────────────────────────────
// status 1 = added, 5 = ignored, 6 = removed

export async function updateBacklinkStatus(
  id: string,
  status: 1 | 5 | 6,
  actionedBy: number,
): Promise<BacklinkJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE backlinks SET status = ?, actioned_by = ?, actioned_at = NOW(3) WHERE id = ?`,
    [status, actionedBy, id],
  );
  if (result.affectedRows === 0) return null;
  return getBacklinkById(id);
}

// ── CONTROLLERS FOR ORCHESTRATORS ────────────────────────────────────────────────────
export async function getAllBacklinks(filter?: {
  limit?: number;
  offset?: number;
}) {
  const limit = filter?.limit || 100;
  const offset = filter?.offset || 0;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, domain_from, url_from, url_to
    from backlinks
    WHERE is_prospect = false
    ORDER BY updated_at ASC
    LIMIT ? OFFSET ?
    `,
    [limit, offset],
  );

  return rows;
}
