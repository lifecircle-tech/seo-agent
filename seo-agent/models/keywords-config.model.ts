import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
export interface KeywordConfig extends RowDataPacket {
  id: string; // VARCHAR(36) UUID
  site_id: number; // INT
  domain: string; // VARCHAR(255)
  target_keywords: string[]; // JSON (list of strings)
  site_name: string | null; // joined from sites_config
  created_at: Date; // DATETIME(3)
}

export interface KeywordConfigJSON {
  id: string;
  site_id: number;
  domain: string;
  target_keywords: string[];
  site_name: string | null;
  created_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createKeywordsConfigTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS keywords_config (
      id              VARCHAR(36)   NOT NULL PRIMARY KEY,
      site_id         INT           NOT NULL,
      domain          VARCHAR(255)  NOT NULL,
      target_keywords JSON          NOT NULL,
      created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_keywords_config_site_id (site_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[keywords_config_table] Error creating keywords_config table:", err);
    throw err;
  }
}