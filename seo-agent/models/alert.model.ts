import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── Types ─────────────────────────────────────────────────────────────
export interface Alert extends RowDataPacket {
  id: string; // VARCHAR(36) UUID
  site_id: number; // INT
  module: string; // VARCHAR(64)
  severity: "critical" | "warning" | "info"; // VARCHAR(16)
  title: string; // VARCHAR(255)
  details:  Record<string, any>; // TEXT
  status: "open" | "acknowledged" | "resolved"; // VARCHAR(16)
  created_at: Date; // DATETIME(3)
  actioned_by: string | null;
  resolved_at: Date | null; // DATETIME(3) | NULL
}

export interface AlertJSON {
  id: string;
  site_id: number;
  module: string;
  severity: "critical" | "warning" | "info";
  title: string;
  details: Record<string, any>;
  status: "open" | "acknowledged" | "resolved";
  created_at: string;
  actioned_by: string | null;
  resolved_at: string | null;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createAlertsTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id          VARCHAR(36)  NOT NULL PRIMARY KEY,
      site_id     INT          NOT NULL,
      module      VARCHAR(64)  NOT NULL,
      severity    VARCHAR(16)  NOT NULL,
      title       VARCHAR(255) NOT NULL,
      details     JSON         NOT NULL,
      status      VARCHAR(16)  NOT NULL DEFAULT 'open',
      created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      actioned_by VARCHAR(64)  NULL,
      resolved_at DATETIME(3)  NULL,
      INDEX idx_alerts_status_severity (status, severity),
      INDEX idx_alerts_module (module),
      INDEX idx_alerts_site_id (site_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[alert_table] Error creating alerts table:", err);
    throw err;
  }
}
