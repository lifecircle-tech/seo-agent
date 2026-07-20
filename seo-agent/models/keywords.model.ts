import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
export interface Keyword extends RowDataPacket {
  id: string;                            // VARCHAR(36) UUID
  site_id: number;                       // INT
  is_new: boolean;                       // BOOLEAN
  keyword: string;                       // VARCHAR(512)
  clicks: number | null;                 // BIGINT
  impressions: number | null;            // BIGINT
  search_volume: number | null;          // BIGINT
  difficulty: number | null;             // DOUBLE
  position: number | null;              // BIGINT
  cpc: number | null;                    // DOUBLE
  ctr: number | null;                    // DOUBLE
  competition: number | null;            // DOUBLE
  competition_level: string | null;      // VARCHAR(32)
  monthly_searches: Array<Record<string, unknown>> | null; // JSON
  pages_used: Array<Record<string, any>> | null;          // INT
  created_at: Date;                      // DATETIME(3)
  updated_at: Date;                      // DATETIME(3)
}

export interface KeywordJSON {
  id: string;
  site_id: number;
  is_new: boolean;
  keyword: string;
  clicks: number | null;
  impressions: number | null;
  search_volume: number | null;
  difficulty: number | null;
  position: number | null;
  cpc: number | null;
  ctr: number | null;
  competition: number | null;
  competition_level: string | null;
  monthly_searches: Array<Record<string, any>> | null;
  pages_used: Array<Record<string, any>> | null;
  created_at: string;
  updated_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createKeywordsTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS keywords (
      id                VARCHAR(36)   NOT NULL PRIMARY KEY,
      site_id           INT           NOT NULL,
      is_new            BOOLEAN       NOT NULL DEFAULT false,
      keyword           VARCHAR(512)  NOT NULL,
      clicks            BIGINT        NULL,
      impressions       BIGINT        NULL,
      search_volume     BIGINT        NULL,
      difficulty        DOUBLE        NULL,
      position          BIGINT        NULL,
      cpc               DOUBLE        NULL,
      ctr               DOUBLE        NULL,
      competition       DOUBLE        NULL,
      competition_level VARCHAR(32)   NULL,
      monthly_searches  JSON          NULL,
      pages_used        JSON          NULL,
      created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_keywords_site_keyword (site_id, keyword(255)),
      INDEX idx_keywords_site_id (site_id),
      INDEX idx_keywords_is_new (is_new)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[keywords_table] Error creating keywords table:", err);
    throw err;
  }
}
