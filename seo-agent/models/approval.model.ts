import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── TYPES ─────────────────────────────────────────────────────────────
export interface Approval extends RowDataPacket {
  id: string; // VARCHAR(36) UUID
  site_id: number; // INT
  module: string; // VARCHAR(64)
  type: string; // VARCHAR(64)
  priority: number; // TINYINT — 1=critical, 2=high, 3=medium
  title: string; // VARCHAR(255)
  original_content: Record<string, any>; // JSON (parsed by mysql2)
  updated_content: Record<string, any> | null; // JSON (parsed by mysql2) | NULL
  preview_url: string | null; // VARCHAR(512) | NULL
  status: "pending" | "approved" | "rejected" | "deferred"; // VARCHAR(16)
  created_at: Date; // DATETIME(3)
  actioned_at: Date | null; // DATETIME(3) | NULL
  actioned_by: string | null; // VARCHAR(64) | NULL
  reject_reason: string | null; // VARCHAR(255) | NULL
  remark: string;
}

export interface ApprovalJSON {
  id: string;
  site_id: number;
  module: string;
  type: string;
  priority: number;
  title: string;
  original_content: Record<string, any>;
  updated_content: Record<string, any> | null;
  preview_url: string | null;
  status: "pending" | "approved" | "rejected" | "deferred";
  created_at: string;
  actioned_at: string | null;
  actioned_by: string | null;
  reject_reason: string | null;
  remark: string;
}

// ── SCHEMA BOOTSTRAP ──────────────────────────────────────────────────
export async function createApprovalsTable(): Promise<void> {
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS approvals (
      id            VARCHAR(36)   NOT NULL PRIMARY KEY,
      site_id       INT           NOT NULL,
      module        VARCHAR(64)   NOT NULL,
      type          VARCHAR(64)   NOT NULL,
      priority      TINYINT       NOT NULL DEFAULT 3,
      title         VARCHAR(255)  NOT NULL,
      original_content JSON         NOT NULL,
      updated_content JSON          NULL,
      preview_url   VARCHAR(512)  NULL,
      status        VARCHAR(16)   NOT NULL DEFAULT 'pending',
      created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      actioned_at   DATETIME(3)   NULL,
      actioned_by   VARCHAR(64)   NULL,
      reject_reason VARCHAR(255)  NULL,
      remark        TEXT          NULL,
      INDEX idx_approvals_status_priority (status, priority),
      INDEX idx_approvals_site_id (site_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  } catch (err) {
    console.error("[approvals_table] Error creating approvals table:", err);
    throw err;
  }
}
