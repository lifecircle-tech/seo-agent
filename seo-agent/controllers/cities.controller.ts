import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";
import { CityConfig, CityConfigJSON } from "../models/cities-config.model.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: CityConfig): CityConfigJSON {
  return {
    ...row,
    target_keywords:
      typeof row.target_keywords === "string"
        ? JSON.parse(row.target_keywords)
        : row.target_keywords,
    services:
      row.services === null || row.services === undefined
        ? null
        : typeof row.services === "string"
          ? JSON.parse(row.services)
          : row.services,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createCityConfig(
  data: Pick<
    CityConfig,
    | "id"
    | "site_id"
    | "city"
    | "state"
    | "country"
    | "target_keywords"
    | "services"
  >,
): Promise<CityConfigJSON> {
  const [existing] = await pool.query<CityConfig[]>(
    "SELECT id FROM cities_config WHERE site_id = ? AND city = ? LIMIT 1",
    [data.site_id, data.city],
  );
  if ((existing as CityConfig[]).length > 0) {
    throw new Error(`City for Site ID=${data.site_id} and city="${data.city}" already exists`);
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO cities_config (id, site_id, city, state, country, target_keywords, services, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      data.id,
      data.site_id,
      data.city,
      data.state,
      data.country,
      JSON.stringify(data.target_keywords),
      data.services != null ? JSON.stringify(data.services) : null,
    ],
  );
  const config = await getCityConfigById(data.id);
  return config!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listCitiesConfigs(filters: {
  limit?: number;
  offset?: number;
}): Promise<{
  cities: CityConfigJSON[];
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
  const limit = Math.min(filters.limit ?? 100, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM cities_config c ${where}`,
      params,
    ),
    pool.query<CityConfig[]>(
      `SELECT c.*, s.brand_name as site_name, s.domain
       FROM cities_config c
       LEFT JOIN sites_config s ON c.site_id = s.site_id
       ${where} ORDER BY c.site_id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = Number((countRow as RowDataPacket[])[0].count);
  const cities = (rows as CityConfig[]).map(toJSON);
  return { cities, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getCityConfigById(
  id: string,
): Promise<CityConfigJSON | null> {
  const [rows] = await pool.query<CityConfig[]>(
    "SELECT * FROM cities_config WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── UPDATE ────────────────────────────────────────────────────────────
export async function updateCityConfig(
  id: string,
  data: Partial<
    Pick<
      CityConfig,
      "city" | "state" | "country" | "target_keywords" | "services"
    >
  >,
): Promise<CityConfigJSON | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.city !== undefined) {
    fields.push("city = ?");
    params.push(data.city);
  }
  if (data.state !== undefined) {
    fields.push("state = ?");
    params.push(data.state);
  }
  if (data.country !== undefined) {
    fields.push("country = ?");
    params.push(data.country);
  }
  if (data.target_keywords !== undefined) {
    fields.push("target_keywords = ?");
    params.push(JSON.stringify(data.target_keywords));
  }
  if ("services" in data) {
    fields.push("services = ?");
    params.push(data.services != null ? JSON.stringify(data.services) : null);
  }

  if (fields.length === 0) return getCityConfigById(id);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE cities_config SET ${fields.join(", ")} WHERE id = ?`,
    [...params, id],
  );

  if (result.affectedRows === 0) return null;
  return getCityConfigById(id);
}

// ── DELETE ────────────────────────────────────────────────────────────
export async function deleteCityConfig(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM cities_config WHERE id = ?",
    [id],
  );
  return result.affectedRows > 0;
}
