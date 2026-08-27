import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { PageContent, PageContentJSON } from "../models/page-content.model.js";
import { lc_pool, pool } from "../../db.js";

const STATUS: Record<number, string> = {
  1: "Pending",
  11: "Generated",
  21: "Created",
  22: "Updated",
  31: "Rejected",
  41: "Error",
};

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: PageContent): PageContentJSON {
  return {
    ...row,
    status: STATUS[row.status],
    images:
      typeof row.images === "string" ? JSON.parse(row.images) : row.images,
    links: typeof row.links === "string" ? JSON.parse(row.links) : row.links,
    page_meta_details:
      typeof row.page_meta_details === "string"
        ? JSON.parse(row.page_meta_details)
        : row.page_meta_details,
    acknowledged_at: row.acknowledged_at
      ? row.acknowledged_at instanceof Date
        ? row.acknowledged_at.toISOString()
        : String(row.acknowledged_at)
      : null,
    keywords_analytics:
      typeof row.keywords_analytics === "string"
        ? JSON.parse(row.keywords_analytics)
        : row.keywords_analytics,
    update_details:
      typeof row.update_details === "string"
        ? JSON.parse(row.update_details)
        : row.update_details,
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
    | "keywords_analytics"
    | "update_details"
  >,
): Promise<PageContentJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO page_content 
      (id, site_id, page_meta_details, url, status, keywords_analytics, update_details) 
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON DUPLICATE KEY UPDATE
      page_meta_details   = COALESCE(VALUES(page_meta_details), page_meta_details),
      keywords_analytics  = COALESCE(VALUES(keywords_analytics), keywords_analytics),
      update_details      = COALESCE(VALUES(update_details), update_details),
      created_at          = NOW(3)
    `,
    [
      data.id,
      data.site_id,
      JSON.stringify(data.page_meta_details),
      data.url,
      JSON.stringify(data.keywords_analytics),
      JSON.stringify(data.update_details),
    ],
  );
  const record = await getPageContentById(data.id);
  return record!;
}

// ── LIST ──────────────────────────────────────────────────────────────
const SORTABLE_COLUMNS = new Set([
  "created_at",
  "acknowledged_at",
  "status",
  "site_id",
  "url",
]);

export async function listPageContents(filters: {
  site_id?: number;
  status?: string | number;
  is_new?: boolean;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}): Promise<{
  pages: PageContentJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filters.status) {
    if (filters.status == 21 || filters.status == 22) {
      conditions.push("status in ('21','22')");
    } else {
      conditions.push("status = ?");
      params.push(filters.status);
    }
  }

  if (filters.is_new !== undefined) {
    conditions.push("is_new = ?");
    params.push(filters.is_new);
  }

  if (filters.site_id) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 10, 100);
  const offset = filters.offset ?? 0;

  const sortCol =
    filters.sort_by && SORTABLE_COLUMNS.has(filters.sort_by)
      ? filters.sort_by
      : null;
  const sortDir = filters.sort_dir === "asc" ? "ASC" : "DESC";
  const orderBy = sortCol
    ? `${sortCol} ${sortDir}, created_at DESC`
    : `created_at DESC`;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM page_content ${where}`,
      params,
    ),
    pool.query<PageContent[]>(
      `SELECT * FROM page_content ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
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
    [11, content, reasoning ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

// ── UPDATE ACKNOWLEDGED BY ───────────────────────────────────────────
/**
 * @deprecated
 */
export async function acknowledgePageContent(
  id: string,
  userId: string,
  remark?: string,
): Promise<PageContentJSON | null> {
  const pageContent = await getPageContentById(id);
  if (!pageContent) return null;

  if (pageContent.acknowledged_by) return pageContent;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content 
     SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = NOW(3), remark = COALESCE(?, remark)
     WHERE id = ?`,
    [userId, remark ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

// Mark the page content as created (21)
export async function createdPageContent(
  id: string,
  userId: string,
  remark?: string,
): Promise<PageContentJSON | null> {
  const pageContent = await getPageContentById(id);
  if (!pageContent) return null;

  if (pageContent.acknowledged_by) return pageContent;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content 
     SET status = 21, acknowledged_by = ?, acknowledged_at = NOW(3), remark = COALESCE(?, remark)
     WHERE id = ?`,
    [userId, remark ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

// Mark the page content as updated (22)
export async function updatedPageContent(
  id: string,
  userId: string,
  remark?: string,
): Promise<PageContentJSON | null> {
  const pageContent = await getPageContentById(id);
  if (!pageContent) return null;

  if (pageContent.acknowledged_by) return pageContent;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content 
     SET status = 22, acknowledged_by = ?, acknowledged_at = NOW(3), remark = COALESCE(?, remark)
     WHERE id = ?`,
    [userId, remark ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

// Mark the page content as rejected (31)
export async function rejectPageContent(
  id: string,
  userId: string,
  remark?: string,
): Promise<PageContentJSON | null> {
  const pageContent = await getPageContentById(id);
  if (!pageContent) return null;

  if (pageContent.acknowledged_by) return pageContent;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content 
     SET status = 31, acknowledged_by = ?, acknowledged_at = NOW(3), remark = COALESCE(?, remark)
     WHERE id = ?`,
    [userId, remark ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

// Mark the page content as error (41)
export async function updatePageContentError(
  id: string,
): Promise<PageContentJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content SET status = 41 WHERE id = ?`,
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

export async function updateUpdatedPageDetails(
  id: string,
  update_details: Record<string, any>,
): Promise<PageContentJSON | null> {
  const page = await getPageContentById(id);

  let temp_update_details = page?.update_details;
  temp_update_details = {
    ...temp_update_details,
    ...update_details,
  };

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE page_content SET update_details = ? WHERE id = ?`,
    [JSON.stringify(temp_update_details), id],
  );
  if (result.affectedRows === 0) return null;
  return getPageContentById(id);
}

// ── GET BY URL ────────────────────────────────────────────────────────
export async function getAcknowledgedPageByUrl(
  url: string,
): Promise<PageContentJSON | null> {
  const [rows] = await pool.query<PageContent[]>(
    `SELECT * FROM page_content
     WHERE url = ? AND status = 21 OR status = 22
     ORDER BY acknowledged_at DESC
     LIMIT 1`,
    [url],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── CONTROLLERS FOR ORCHESTRATORS ─────────────────────────────────────

export async function createNewPageContent(
  data: Pick<
    PageContent,
    | "id"
    | "site_id"
    | "page_meta_details"
    | "content"
    | "reasoning"
    | "url"
    | "images"
    | "links"
    | "keywords_analytics"
  >,
) {
  await pool.query<ResultSetHeader>(
    `INSERT INTO page_content 
      (id, site_id, page_meta_details, content, reasoning, images, links, url, status, keywords_analytics, is_new) 
    VALUES (?, ?, ?, ?, ?, ?, ?, 11, ?, true)
    ON DUPLICATE KEY UPDATE
      page_meta_details   = COALESCE(VALUES(page_meta_details), page_meta_details),
      content             = COALESCE(VALUES(content), content),
      reasoning           = COALESCE(VALUES(reasoning), reasoning),
      images              = COALESCE(VALUES(images), images),
      links               = COALESCE(VALUES(links), links),
      keywords_analytics  = COALESCE(VALUES(keywords_analytics), keywords_analytics),
      created_at          = NOW(3)
    `,
    [
      data.id,
      data.site_id,
      JSON.stringify(data.page_meta_details),
      data.content,
      data.reasoning,
      JSON.stringify(data.images),
      JSON.stringify(data.links),
      data.url,
      JSON.stringify(data.keywords_analytics),
    ],
  );
  const record = await getPageContentById(data.id);
  return record!;
}
