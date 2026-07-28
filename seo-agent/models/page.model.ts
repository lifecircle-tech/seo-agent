import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── Page ──────────────────────────────────────────────────────────────

// pages stores URL-level metadata only.
// Per-keyword metrics (position, clicks, etc.) live in page_keywords.
export interface Page extends RowDataPacket {
  id: string;                      // VARCHAR(36) UUID
  site_id: number;                 // INT
  url: string;                     // TEXT — UNIQUE per site
  wp_id: number | null;            // INT — WordPress page/post ID
  title: string | null;            // VARCHAR(512)
  meta_description: string | null; // TEXT
  type: string | null;             // VARCHAR(16) — 'page' | 'post'
  last_modified: Date | null;      // DATETIME(3) — WP last modified
  created_at: Date;                // DATETIME(3)
  updated_at: Date;                // DATETIME(3)
}

export interface PageJSON {
  id: string;
  site_id: number;
  url: string;
  wp_id: number | null;
  title: string | null;
  meta_description: string | null;
  type: string | null;
  last_modified: string | null;
  created_at: string;
  updated_at: string;
}

// ── PageKeyword (junction + per-keyword metrics) ──────────────────────
// One row per (url, keyword) pair. Metrics here reflect how that specific
// keyword performs on that specific page — not URL-level aggregates.

export interface PageKeyword extends RowDataPacket {
  page_id: string;
  keyword_id: string;
  site_id: number;
  position: number | null;    // DOUBLE — GSC avg position for this keyword on this page
  clicks: number | null;      // BIGINT
  impressions: number | null; // BIGINT
  ctr: number | null;         // DOUBLE
  created_at: Date;           // DATETIME(3)
  updated_at: Date;           // DATETIME(3)
}

export interface PageKeywordJSON {
  page_id: string;
  keyword_id: string;
  site_id: number;
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  created_at: string;
  updated_at: string;
}

// ── Table Creation ────────────────────────────────────────────────────

export async function createPagesTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pages (
        id               VARCHAR(36)   NOT NULL PRIMARY KEY,
        site_id          INT           NOT NULL,
        url              TEXT          NOT NULL,
        wp_id            INT           NULL,
        title            VARCHAR(512)  NULL,
        meta_description TEXT          NULL,
        type             VARCHAR(16)   NULL,
        last_modified    DATETIME(3)   NULL,
        created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_pages_site_url (site_id, url(500)),
        INDEX idx_pages_site_id (site_id),
        INDEX idx_pages_wp_id   (wp_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error("[pages] Error creating table:", err);
    throw err;
  }
}

export async function createPageKeywordsTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS page_keywords (
        page_id     VARCHAR(36)  NOT NULL,
        keyword_id  VARCHAR(36)  NOT NULL,
        site_id     INT          NOT NULL,
        position    DOUBLE       NULL,
        clicks      BIGINT       NULL,
        impressions BIGINT       NULL,
        ctr         DOUBLE       NULL,
        created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (page_id, keyword_id),
        INDEX idx_page_keywords_keyword_id (keyword_id),
        INDEX idx_page_keywords_site_id    (site_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error("[page_keywords] Error creating table:", err);
    throw err;
  }
}
