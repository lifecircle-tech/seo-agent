import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
export interface CompetitorConfig extends RowDataPacket {
  id: string; // VARCHAR(36) UUID
  site_id: number; // INT
  domain: string; // VARCHAR(255)
  competitor_domain: string[]; // JSON (list of URLs)
  site_name: string | null; // joined from sites_config
  created_at: Date; // DATETIME(3)
}

export interface CompetitorConfigJSON {
  id: string;
  site_id: number;
  domain: string;
  competitor_domain: string[];
  site_name: string | null;
  created_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createCompetitorConfigTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_config (
      id                VARCHAR(36)   NOT NULL PRIMARY KEY,
      site_id           INT           NOT NULL,
      domain            VARCHAR(255)  NOT NULL,
      competitor_domain JSON          NOT NULL,
      created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_competitor_config_site_id (site_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[competitor_config_table] Error creating competitor_config table:", err);
    throw err;
  }
}