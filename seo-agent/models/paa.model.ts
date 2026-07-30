import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface PaaQuestion extends RowDataPacket {
  id: string;              // VARCHAR(36) UUID
  site_id: number;         // INT
  keyword_id: string;      // VARCHAR(36) FK → keywords.id
  question: string;        // TEXT — the PAA question from Google
  answer: string | null;   // TEXT — scraped snippet answer (optional)
  source_url: string | null; // TEXT — page where answer was found
  category: string | null; // VARCHAR(32) — 'faq'|'how-to'|'comparison'|'definition'|'local'
  used_in_content: boolean; // BOOLEAN — true once consumed by content generation
  created_at: Date;
  updated_at: Date;
}

export interface PaaQuestionJSON {
  id: string;
  site_id: number;
  keyword_id: string;
  question: string;
  answer: string | null;
  source_url: string | null;
  category: string | null;
  used_in_content: boolean;
  created_at: string;
  updated_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────

export async function createPaaQuestionsTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS paa_questions (
        id               VARCHAR(36)   NOT NULL PRIMARY KEY,
        site_id          INT           NOT NULL,
        keyword_id       VARCHAR(36)   NOT NULL,
        question         TEXT          NOT NULL,
        answer           TEXT          NULL,
        source_url       TEXT          NULL,
        category         VARCHAR(32)   NULL,
        used_in_content  BOOLEAN       NOT NULL DEFAULT false,
        created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_paa_keyword_question (keyword_id, question(500)),
        INDEX idx_paa_site_id        (site_id),
        INDEX idx_paa_keyword_id     (keyword_id),
        INDEX idx_paa_used_in_content (used_in_content)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error("[paa_questions] Error creating table:", err);
    throw err;
  }
}
