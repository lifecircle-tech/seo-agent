import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
export interface CityConfig extends RowDataPacket {
  id: string; // VARCHAR(36) UUID
  site_id: number; // INT
  city: string; // VARCHAR(255)
  state: string; // VARCHAR(255)
  country: string; // VARCHAR(255)
  target_keywords: string[]; // JSON (list of strings)
  services: string[] | null; // JSON (list of service names), nullable
  created_at: Date; // DATETIME(3)
}

export interface CityConfigJSON {
  id: string;
  site_id: number;
  city: string;
  state: string;
  country: string;
  target_keywords: string[];
  services: string[] | null;
  created_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createCitiesConfigTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS cities_config (
      id              VARCHAR(36)   NOT NULL PRIMARY KEY,
      site_id         INT           NOT NULL,
      city            VARCHAR(255)  NOT NULL,
      state           VARCHAR(255)  NOT NULL,
      country         VARCHAR(255)  NOT NULL,
      target_keywords JSON          NOT NULL,
      services        JSON          NULL,
      created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_cities_config_site_id (site_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[cities_config_table] Error creating cities_config table:", err);
    throw err;
  }
}