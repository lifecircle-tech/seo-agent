import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
enum STATUS {
    'planned',
    'pending',
    'completed',
    'ignore'
}

export interface Opportunity extends RowDataPacket {
  id: string;                                // VARCHAR(36) UUID
  site_id: number;                           // INT
  opportunity_type: string;                  // VARCHAR(64)
  priority: string | null;                   // VARCHAR(16)
  reasoning: string | null;                  // TEXT
  opportunity_details: Record<string, any> | null; // JSON
  status: STATUS;                            // VARCHAR(16)
  actioned_by: string | null;                // VARCHAR(36)
  actioned_at: Date | null;                  // DATETIME(3)
  created_at: Date;                          // DATETIME(3)
  updated_at: Date;                          // DATETIME(3)
}

export interface OpportunityJSON {
  id: string;
  site_id: number;
  opportunity_type: string;
  priority: string | null;
  reasoning: string | null;
  opportunity_details: Record<string, any> | null;
  status: STATUS;
  actioned_by: string | null;
  actioned_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createOpportunitiesTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id                  VARCHAR(36)   NOT NULL PRIMARY KEY,
      site_id             INT           NOT NULL,
      opportunity_type    VARCHAR(64)   NOT NULL,
      priority            VARCHAR(16)   NULL,
      reasoning           TEXT          NULL,
      opportunity_details JSON          NULL,
      status              VARCHAR(16)   NOT NULL DEFAULT 'planned',
      actioned_by         VARCHAR(36)   NULL,
      actioned_at         DATETIME(3)   NULL,
      created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_opportunities_site_id (site_id),
      INDEX idx_opportunities_status (status),
      INDEX idx_opportunities_type (opportunity_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[opportunities_table] Error creating opportunities table:", err);
    throw err;
  }
}
