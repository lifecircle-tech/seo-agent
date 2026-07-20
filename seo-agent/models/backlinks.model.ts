import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
export interface Backlink extends RowDataPacket {
  id: string;                                    // VARCHAR(36) UUID
  site_id: number;                               // INT
  owner_type: string | null;                     // VARCHAR(64)
  url_from: string;                              // VARCHAR(2048)
  url_to: string;                                // VARCHAR(2048)
  domain_from_rank: number | null;               // INT
  anchor_details: Record<string, unknown> | null; // JSON
  is_new: boolean;                               // BOOLEAN
  is_lost: boolean;                              // BOOLEAN
  is_broken: boolean;                            // BOOLEAN
  first_seen: string | null;                     // DATE
  last_seen: string | null;                      // DATE
  spam_score: number | null;                     // DOUBLE
  created_at: Date;                              // DATETIME(3)
  updated_at: Date;                              // DATETIME(3)
}

export interface BacklinkJSON {
  id: string;
  site_id: number;
  owner_type: string | null;
  url_from: string;
  url_to: string;
  domain_from_rank: number | null;
  anchor_details: Record<string, unknown> | null;
  is_new: boolean;
  is_lost: boolean;
  is_broken: boolean;
  first_seen: string | null;
  last_seen: string | null;
  spam_score: number | null;
  created_at: string;
  updated_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createBacklinksTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS backlinks (
      id                VARCHAR(36)    NOT NULL PRIMARY KEY,
      site_id           INT            NOT NULL,
      owner_type        VARCHAR(64)    NULL,
      url_from          VARCHAR(2048)  NOT NULL,
      url_to            VARCHAR(2048)  NOT NULL,
      domain_from_rank  INT            NULL,
      anchor_details    JSON           NULL,
      is_new            BOOLEAN        NOT NULL DEFAULT false,
      is_lost           BOOLEAN        NOT NULL DEFAULT false,
      is_broken         BOOLEAN        NOT NULL DEFAULT false,
      first_seen        DATETIME       NULL,
      last_seen         DATETIME       NULL,
      spam_score        DOUBLE         NULL,
      created_at        DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at        DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_backlinks_site_url (site_id, url_from(191), url_to(191)),
      INDEX idx_backlinks_site_id (site_id),
      INDEX idx_backlinks_is_new (is_new),
      INDEX idx_backlinks_is_lost (is_lost),
      INDEX idx_backlinks_is_broken (is_broken)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[backlinks_table] Error creating backlinks table:", err);
    throw err;
  }
}
