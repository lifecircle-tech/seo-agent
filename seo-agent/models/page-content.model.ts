import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
export interface PageContent extends RowDataPacket {
  id: string;
  site_id: number;
  page_meta_details: Record<string, unknown>;
  content: string; // LONGTEXT in MySQL
  status: "pending" | "acknowledged" | "created" | "error" | "rejected";
  url: string;
  acknowledged_by: number | null;
  acknowledged_at: Date | null;
  reasoning: string;
  remark: string;
  page_updated: boolean;
  update_details: Record<string, unknown> | null;
  keywords_analytics: Array<any> | null;
  created_at: Date; // DATETIME(3)
}

export interface PageContentJSON {
  id: string;
  site_id: number;
  page_meta_details: Record<string, unknown>;
  content: string;
  status: "pending" | "acknowledged" | "created" | "error" | "rejected";
  url: string;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  reasoning: string;
  remark: string;
  page_updated: boolean;
  update_details: Record<string, unknown> | null;
  keywords_analytics: Array<any> | null;
  created_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createPageContentTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS page_content (
      id                VARCHAR(36)   NOT NULL PRIMARY KEY,
      site_id           INT           NOT NULL,
      page_meta_details JSON          NOT NULL,
      content           LONGTEXT      NOT NULL,
      status            VARCHAR(16)   NOT NULL DEFAULT 'pending',
      url               VARCHAR(512)  NOT NULL,
      acknowledged_by   INT           NULL,
      acknowledged_at   DATETIME(3)   NULL,
      reasoning         TEXT          NULL,
      remark            TEXT          NULL,
      page_updated      BOOLEAN       NULL DEFAULT false,
      update_details    JSON          NULL,
      keywords_analytics    JSON      NULL,
      created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_page_content_status (status),
      INDEX idx_page_content_site_id (site_id),
      INDEX idx_page_acknowledged_by (acknowledged_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[page_content_table] Error creating table:", err);
    throw err;
  }
}
