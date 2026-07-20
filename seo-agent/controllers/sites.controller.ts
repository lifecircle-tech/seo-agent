import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";
import { SiteConfig, SiteConfigJSON } from "../models/sites-config.model.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: SiteConfig): SiteConfigJSON {
  return {
    ...row,
    cities: typeof row.cities === "string" ? JSON.parse(row.cities) : row.cities,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createSiteConfig(
  data: Pick<SiteConfig, "id" | "site_id" | "domain" | "brand_name" | "industry" | "cities">
): Promise<SiteConfigJSON> {
  const [existing] = await pool.query<SiteConfig[]>(
    "SELECT id FROM sites_config WHERE site_id = ? LIMIT 1",
    [data.site_id]
  );
  if ((existing as SiteConfig[]).length > 0) {
    throw new Error(`Site for Site ID=${data.site_id} already exists`);
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO sites_config (id, site_id, domain, brand_name, industry, cities, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
    [data.id, data.site_id, data.domain, data.brand_name, data.industry, JSON.stringify(data.cities)]
  );
  const config = await getSiteConfigById(data.id);
  return config!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listSitesConfigs(filters: {
  limit?: number;
  offset?: number;
}): Promise<{
  sites: SiteConfigJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
  const conditions: string[] = [];
  const params: unknown[] = [];

//   if (filters.site_id) {
//     conditions.push("site_id = ?");
//     params.push(filters.site_id);
//   }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 10, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM sites_config ${where}`, params),
    pool.query<SiteConfig[]>(
      `SELECT * FROM sites_config ${where} ORDER BY site_id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  const sites = (rows as SiteConfig[]).map(toJSON);
  return { sites, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getSiteConfigById(id: string): Promise<SiteConfigJSON | null> {
  const [rows] = await pool.query<SiteConfig[]>("SELECT * FROM sites_config WHERE id = ?", [id]);
  return rows.length ? toJSON(rows[0]) : null;
}

// ── UPDATE ────────────────────────────────────────────────────────────
export async function updateSiteConfig(
  id: string,
  data: Partial<Pick<SiteConfig, "domain" | "brand_name" | "industry" | "cities">>
): Promise<SiteConfigJSON | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.domain !== undefined) {
    fields.push("domain = ?");
    params.push(data.domain);
  }
  if (data.brand_name !== undefined) {
    fields.push("brand_name = ?");
    params.push(data.brand_name);
  }
  if (data.industry !== undefined) {
    fields.push("industry = ?");
    params.push(data.industry);
  }
  if (data.cities !== undefined) {
    fields.push("cities = ?");
    params.push(JSON.stringify(data.cities));
  }

  if (fields.length === 0) return getSiteConfigById(id);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE sites_config SET ${fields.join(", ")} WHERE id = ?`,
    [...params, id]
  );

  if (result.affectedRows === 0) return null;
  return getSiteConfigById(id);
}

// ── DELETE ────────────────────────────────────────────────────────────
export async function deleteSiteConfig(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM sites_config WHERE id = ?",
    [id]
  );
  return result.affectedRows > 0;
}