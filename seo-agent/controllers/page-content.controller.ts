import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { PageContent, PageContentJSON } from "../models/page-content.model.js";
import { lc_pool, pool } from "../../db.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: PageContent): PageContentJSON {
  return {
    ...row,
    page_meta_details:
      typeof row.page_meta_details === "string"
        ? JSON.parse(row.page_meta_details)
        : row.page_meta_details,
    acknowledged_at: row.acknowledged_at
      ? row.acknowledged_at instanceof Date
        ? row.acknowledged_at.toISOString()
        : String(row.acknowledged_at)
      : null,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createPageContent(
  data: Pick<
    PageContent,
    | "id"
    | "site_id"
    | "page_meta_details"
    | "url"
  >,
): Promise<PageContentJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO page_content 
      (id, site_id, page_meta_details, url, status) 
    VALUES (?, ?, ?, ?, 'pending')`,
    [
      data.id,
      data.site_id,
      JSON.stringify(data.page_meta_details),
      data.url,
    ],
  );
  const record = await getPageContentById(data.id);
  return record!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listPageContents(filters: {
  site_id?: number;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  pages: PageContentJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  if (filters.site_id) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 10, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM page_content ${where}`,
      params,
    ),
    pool.query<PageContent[]>(
      `SELECT * FROM page_content ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const userIds = new Set();
  rows.forEach((row) => {
    if (row.acknowledged_by) userIds.add(row.acknowledged_by);
  });

  const userMap: Record<string, string> = {};
  if (userIds.size > 0) {
    const [users] = await lc_pool.query<any[]>(
      `SELECT emp_name, det_id FROM life_emp_details WHERE det_id IN (?)`,
      [[...userIds]],
    );
    users.forEach((u) => (userMap[u.det_id] = u.emp_name));
  }

  const total = Number((countRow as RowDataPacket[])[0].count);
  const pages = rows.map(toJSON).map((rec) => ({
    ...rec,
    acknowledged_user_name: rec.acknowledged_by
      ? userMap[rec.acknowledged_by]
      : null,
  }));

  return { pages, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getPageContentById(
  id: string,
): Promise<PageContentJSON | null> {
  const [rows] = await pool.query<PageContent[]>(
    "SELECT * FROM page_content WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── UPDATE CONTENT ────────────────────────────────────────────────────
export async function updatePageContentBody(
  id: string,
  content: string,
  reasoning?: string,
): Promise<PageContentJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE page_content SET status = ?, content = ?, reasoning = COALESCE(?, reasoning) WHERE id = ?",
    ['created', content, reasoning ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

// ── UPDATE ACKNOWLEDGED BY ───────────────────────────────────────────
export async function acknowledgePageContent(
  id: string,
  userId: string,
  remark?: string,
): Promise<PageContentJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content 
     SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = NOW(3), remark = COALESCE(?, remark)
     WHERE id = ?`,
    [userId, remark ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

export async function updatePageContentError(
  id: string,
): Promise<PageContentJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content SET status = 'error' WHERE id = ?`,
    [id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

export async function updateRemark(
  id: string,
  remark: string,
): Promise<PageContentJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content SET remark = ? WHERE id = ?`,
    [remark, id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}
