import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── Types ─────────────────────────────────────────────────────────────

/**
 * One tracked change to one URL, with Search Console results for the 28 days
 * before and the 28 days after it went live. A canonical change touches several
 * URLs, so it gets one row per URL.
 */
export type ChangeSourceType = "approval" | "page_content" | "opportunity";
export type ChangeImpactStatus = "waiting" | "measured" | "failed";

export interface ChangeImpact extends RowDataPacket {
  id: string;
  site_id: number;
  source_type: ChangeSourceType;
  source_id: string;
  change_type: string; // meta_rewrite | canonical | page_created | page_updated | opportunity:<type>
  url: string;
  url_hash: string;
  changed_at: Date;
  before_start: string; // DATE, inclusive
  before_end: string;
  after_start: string;
  after_end: string;
  before_clicks: number | null;
  before_impressions: number | null;
  before_ctr: number | null;
  before_position: number | null;
  after_clicks: number | null;
  after_impressions: number | null;
  after_ctr: number | null;
  after_position: number | null;
  status: ChangeImpactStatus;
  attempts: number;
  error: string | null;
  measured_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
// Same DDL as migrations/002_change_impact.sql.

export async function createChangeImpactTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS change_impact (
        id                  VARCHAR(36)    NOT NULL PRIMARY KEY,
        site_id             INT            NOT NULL,
        source_type         VARCHAR(20)    NOT NULL,
        source_id           VARCHAR(64)    NOT NULL,
        change_type         VARCHAR(48)    NOT NULL,
        url                 VARCHAR(1000)  NOT NULL,
        url_hash            CHAR(64)       NOT NULL,
        changed_at          DATETIME(3)    NOT NULL,
        before_start        DATE           NOT NULL,
        before_end          DATE           NOT NULL,
        after_start         DATE           NOT NULL,
        after_end           DATE           NOT NULL,
        before_clicks       INT            NULL,
        before_impressions  INT            NULL,
        before_ctr          DOUBLE         NULL,
        before_position     DOUBLE         NULL,
        after_clicks        INT            NULL,
        after_impressions   INT            NULL,
        after_ctr           DOUBLE         NULL,
        after_position      DOUBLE         NULL,
        status              VARCHAR(16)    NOT NULL DEFAULT 'waiting',
        attempts            INT            NOT NULL DEFAULT 0,
        error               TEXT           NULL,
        measured_at         DATETIME(3)    NULL,
        created_at          DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at          DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_change_impact_source_url (source_type, source_id, url_hash),
        INDEX idx_change_impact_due   (status, after_end),
        INDEX idx_change_impact_site  (site_id, changed_at),
        INDEX idx_change_impact_source (source_type, source_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error("[change_impact] Error creating table:", err);
    throw err;
  }
}
