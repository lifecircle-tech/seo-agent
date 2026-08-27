import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Page, PageJSON, PageKeyword, PageKeywordJSON } from "../models/page.model.js";
import { Keyword, KeywordJSON } from "../models/keywords.model.js";
import { pool } from "../../db.js";

// ── Row serialisers ───────────────────────────────────────────────────

function pageToJSON(row: Page): PageJSON {
  return {
    ...row,
    last_modified:
      row.last_modified instanceof Date
        ? row.last_modified.toISOString()
        : row.last_modified ?? null,
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

function keywordToJSON(row: Keyword): KeywordJSON {
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

function junctionToJSON(row: PageKeyword): PageKeywordJSON {
  return {
    ...row,
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

// ── UPSERT ────────────────────────────────────────────────────────────
// Insert or update by URL (unique key). Returns the persisted row.

// Upserts URL-level metadata only. Per-keyword metrics go via linkKeywordToPage.
export async function upsertPage(data: {
  id: string;
  site_id: number;
  url: string;
  wp_id?: number | null;
  title?: string | null;
  meta_description?: string | null;
  type?: string | null;
  last_modified?: string | null;
}): Promise<PageJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO pages
       (id, site_id, url, wp_id, title, meta_description, type, last_modified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       wp_id            = COALESCE(VALUES(wp_id), wp_id),
       title            = COALESCE(VALUES(title), title),
       meta_description = COALESCE(VALUES(meta_description), meta_description),
       type             = COALESCE(VALUES(type), type),
       last_modified    = COALESCE(VALUES(last_modified), last_modified),
       updated_at       = NOW(3)`,
    [
      data.id,
      data.site_id,
      data.url,
      data.wp_id ?? null,
      data.title ?? null,
      data.meta_description ?? null,
      data.type ?? null,
      data.last_modified ?? null,
    ],
  );
  const page = await getPageByUrl(data.url);
  return page!;
}

// ── GET IDs BY URLs ───────────────────────────────────────────────────
// Batch fetch url→id map for a list of URLs within a site.
// Used after upsertPages to resolve page_ids for junction inserts.

export async function getPageIdsByUrls(
  siteId: number,
  urls: string[],
): Promise<Map<string, string>> {
  if (urls.length === 0) return new Map();
  const [rows] = await pool.query<(Pick<Page, "id" | "url"> & RowDataPacket)[]>(
    `SELECT id, url FROM pages WHERE site_id = ? AND url IN (?)`,
    [siteId, urls],
  );
  return new Map((rows as any[]).map((r) => [r.url, r.id]));
}

// ── GET BY IDs (batch) ────────────────────────────────────────────────

export async function getPagesByIds(ids: string[]): Promise<PageJSON[]> {
  if (ids.length === 0) return [];
  const [rows] = await pool.query<Page[]>(
    `SELECT * FROM pages WHERE id IN (?)`,
    [ids],
  );
  return (rows as Page[]).map(pageToJSON);
}

// ── GET BY ID ─────────────────────────────────────────────────────────

export async function getPageById(id: string): Promise<PageJSON | null> {
  const [rows] = await pool.query<Page[]>(
    "SELECT * FROM pages WHERE id = ?",
    [id],
  );
  return rows.length ? pageToJSON(rows[0]) : null;
}

// ── GET BY URL ────────────────────────────────────────────────────────

export async function getPageByUrl(url: string): Promise<PageJSON | null> {
  const [rows] = await pool.query<Page[]>(
    "SELECT * FROM pages WHERE url = ?",
    [url],
  );
  return rows.length ? pageToJSON(rows[0]) : null;
}

// ── LIST ──────────────────────────────────────────────────────────────

const SORTABLE = new Set(["clicks", "impressions", "ctr", "position", "updated_at", "created_at"]);

export async function listPages(filters: {
  site_id?: number;
  type?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}): Promise<{ pages: PageJSON[]; total: number; limit: number; offset: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.site_id !== undefined) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }
  if (filters.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;
  const sortCol = filters.sort_by && SORTABLE.has(filters.sort_by) ? filters.sort_by : "updated_at";
  const sortDir = filters.sort_dir === "asc" ? "ASC" : "DESC";

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM pages ${where}`, params),
    pool.query<Page[]>(
      `SELECT * FROM pages ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  return { pages: (rows as Page[]).map(pageToJSON), total, limit, offset };
}

// ── GET PAGE WITH KEYWORDS (JOIN) ─────────────────────────────────────
// Returns a page merged with all its associated keywords.

export async function getPageWithKeywords(
  pageId: string,
): Promise<(PageJSON & { keywords: KeywordJSON[] }) | null> {
  const page = await getPageById(pageId);
  if (!page) return null;

  const [rows] = await pool.query<Keyword[]>(
    `SELECT k.*
     FROM keywords k
     INNER JOIN page_keywords pk ON pk.keyword_id = k.id
     WHERE pk.page_id = ?
     ORDER BY k.impressions DESC`,
    [pageId],
  );

  return { ...page, keywords: (rows as Keyword[]).map(keywordToJSON) };
}

// ── LIST PAGES WITH KEYWORDS (JOIN) ───────────────────────────────────
// Efficient: one query for pages, one for all linked keywords, merged in JS.

export async function listPagesWithKeywords(filters: {
  site_id?: number;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ pages: (PageJSON & { keywords: KeywordJSON[] })[]; total: number; limit: number; offset: number }> {
  const { pages, total, limit, offset } = await listPages(filters);
  if (pages.length === 0) return { pages: [], total, limit, offset };

  const pageIds = pages.map((p) => p.id);
  const [kwRows] = await pool.query<(Keyword & { page_id: string })[]>(
    `SELECT k.*, pk.page_id
     FROM keywords k
     INNER JOIN page_keywords pk ON pk.keyword_id = k.id
     WHERE pk.page_id IN (?)`,
    [pageIds],
  );

  const kwByPage = new Map<string, KeywordJSON[]>();
  for (const row of kwRows as (Keyword & { page_id: string })[]) {
    const list = kwByPage.get(row.page_id) ?? [];
    list.push(keywordToJSON(row));
    kwByPage.set(row.page_id, list);
  }

  const merged = pages.map((p) => ({ ...p, keywords: kwByPage.get(p.id) ?? [] }));
  return { pages: merged, total, limit, offset };
}

// ── LINK / UNLINK keyword ─────────────────────────────────────────────

// Inserts or updates the (page, keyword) link with its GSC metrics.
// Calling this twice for the same pair updates metrics in-place — no duplicate rows.
export async function linkKeywordToPage(
  pageId: string,
  keywordId: string,
  siteId: number,
  metrics: {
    position?: number | null;
    clicks?: number | null;
    impressions?: number | null;
    ctr?: number | null;
  } = {},
): Promise<PageKeywordJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO page_keywords
       (page_id, keyword_id, site_id, position, clicks, impressions, ctr, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       position    = COALESCE(VALUES(position), position),
       clicks      = COALESCE(VALUES(clicks), clicks),
       impressions = COALESCE(VALUES(impressions), impressions),
       ctr         = COALESCE(VALUES(ctr), ctr),
       updated_at  = NOW(3)`,
    [
      pageId,
      keywordId,
      siteId,
      metrics.position ?? null,
      metrics.clicks ?? null,
      metrics.impressions ?? null,
      metrics.ctr ?? null,
    ],
  );
  const [rows] = await pool.query<PageKeyword[]>(
    "SELECT * FROM page_keywords WHERE page_id = ? AND keyword_id = ?",
    [pageId, keywordId],
  );
  return junctionToJSON(rows[0]);
}

export async function unlinkKeywordFromPage(
  pageId: string,
  keywordId: string,
): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM page_keywords WHERE page_id = ? AND keyword_id = ?",
    [pageId, keywordId],
  );
  return result.affectedRows > 0;
}

// ── KEYWORDS FOR PAGE ─────────────────────────────────────────────────

export async function getKeywordsForPage(pageId: string): Promise<KeywordJSON[]> {
  const [rows] = await pool.query<Keyword[]>(
    `SELECT k.*
     FROM keywords k
     INNER JOIN page_keywords pk ON pk.keyword_id = k.id
     WHERE pk.page_id = ?
     ORDER BY k.impressions DESC`,
    [pageId],
  );
  return (rows as Keyword[]).map(keywordToJSON);
}

// ── PAGES FOR KEYWORD (JOIN) ──────────────────────────────────────────
// Fetches all pages linked to a keyword, merged with the keyword itself.

export async function getKeywordWithPages(
  keywordId: string,
): Promise<(KeywordJSON & { pages: PageJSON[] }) | null> {
  const [kwRows] = await pool.query<Keyword[]>(
    "SELECT * FROM keywords WHERE id = ?",
    [keywordId],
  );
  if (!kwRows.length) return null;
  const keyword = keywordToJSON(kwRows[0]);

  const [pageRows] = await pool.query<Page[]>(
    `SELECT p.*
     FROM pages p
     INNER JOIN page_keywords pk ON pk.page_id = p.id
     WHERE pk.keyword_id = ?
     ORDER BY p.impressions DESC`,
    [keywordId],
  );

  return { ...keyword, pages: (pageRows as Page[]).map(pageToJSON) };
}

// ── BULK UPSERT PAGES ─────────────────────────────────────────────────
// Used by the weekly orchestrator to persist all discovered pages in one shot.

export async function upsertPages(
  records: Array<{
    id: string;
    site_id: number;
    url: string;
    wp_id?: number | null;
    title?: string | null;
    meta_description?: string | null;
    type?: string | null;
    last_modified?: string | null;
  }>,
): Promise<number> {
  if (records.length === 0) return 0;

  const placeholders = records
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))")
    .join(", ");

  const params = records.flatMap((r) => [
    r.id,
    r.site_id,
    r.url,
    r.wp_id ?? null,
    r.title ?? null,
    r.meta_description ?? null,
    r.type ?? null,
    r.last_modified ?? null,
  ]);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO pages
       (id, site_id, url, wp_id, title, meta_description, type, last_modified, created_at, updated_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       wp_id            = COALESCE(VALUES(wp_id), wp_id),
       title            = COALESCE(VALUES(title), title),
       meta_description = COALESCE(VALUES(meta_description), meta_description),
       type             = COALESCE(VALUES(type), type),
       last_modified    = COALESCE(VALUES(last_modified), last_modified),
       updated_at       = NOW(3)`,
    params,
  );

  return result.affectedRows;
}

// ── BULK LINK keywords ────────────────────────────────────────────────
// Insert multiple (page_id, keyword_id) pairs, skip duplicates.

export async function bulkLinkKeywords(
  links: Array<{
    page_id: string;
    keyword_id: string;
    site_id: number;
    position?: number | null;
    clicks?: number | null;
    impressions?: number | null;
    ctr?: number | null;
  }>,
): Promise<number> {
  if (links.length === 0) return 0;
  const placeholders = links
    .map(() => "(?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))")
    .join(", ");
  const params = links.flatMap((l) => [
    l.page_id,
    l.keyword_id,
    l.site_id,
    l.position ?? null,
    l.clicks ?? null,
    l.impressions ?? null,
    l.ctr ?? null,
  ]);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO page_keywords
       (page_id, keyword_id, site_id, position, clicks, impressions, ctr, created_at, updated_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       position    = COALESCE(VALUES(position), position),
       clicks      = COALESCE(VALUES(clicks), clicks),
       impressions = COALESCE(VALUES(impressions), impressions),
       ctr         = COALESCE(VALUES(ctr), ctr),
       updated_at  = NOW(3)`,
    params,
  );

  console.log("links ", result);
  
  return result.affectedRows;
}

// ── CONTROLLERS FOR ORCHESTRATORS ─────────────────────────────────────

export async function getPagesAndKeywords(siteId: number) {
  await pool.query("SET SESSION group_concat_max_len = 10000");
  const [rows] = await pool.query<any>(`
    SELECT p.id, p.url, pk.clicks, pk.impressions, pk.position, pk.ctr,
    CONCAT(
        '[',
        GROUP_CONCAT(
          JSON_OBJECT(
              'keyword', k.keyword,
              'impressions', k.impressions,
              'clicks', k.clicks,
              'search_volume', k.search_volume,
              'difficulty', k.difficulty,
              'competition', k.competition_level,
              'position', k.position
          )
        ),
        ']'
      ) as keywords FROM pages p 
      JOIN page_keywords pk ON pk.page_id = p.id 
      JOIN keywords k ON pk.keyword_id = k.id 
      WHERE p.site_id = ? GROUP BY p.id 
      ORDER BY pk.position DESC
      LIMIT 100;
    `, [siteId]);

  return rows
}