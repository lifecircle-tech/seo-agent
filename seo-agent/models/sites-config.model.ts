import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
export interface SiteConfig extends RowDataPacket {
  id: string; // VARCHAR(36) UUID
  site_id: number; // INT
  domain: string; // VARCHAR(255)
  brand_name: string; // VARCHAR(255)
  industry: string; // VARCHAR(64)
  cities: string[]; // JSON (list of strings)
  created_at: Date; // DATETIME(3)
}

export interface SiteConfigJSON {
  id: string;
  site_id: number;
  domain: string;
  brand_name: string;
  industry: string;
  cities: string[];
  created_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createSitesConfigTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS sites_config (
      id            VARCHAR(36)   NOT NULL PRIMARY KEY,
      site_id       INT           NOT NULL,
      domain        VARCHAR(255)  NOT NULL,
      brand_name    VARCHAR(255)  NOT NULL,
      industry      VARCHAR(64)   NOT NULL,
      cities        JSON          NOT NULL,
      created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_sites_config_site_id (site_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[sites_config_table] Error creating sites_config table:", err);
    throw err;
  }
}