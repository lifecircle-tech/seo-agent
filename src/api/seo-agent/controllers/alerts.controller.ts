/**
 * Alerts controller — all MySQL query operations for the alerts table.
 * Routes in alerts.routes.ts call these functions; no HTTP objects here.
 */

import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Alert, AlertJSON } from "../models/alert.model.js";
import pool from "../../db.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: Alert): AlertJSON {
  return {
    ...row,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    resolved_at: row.resolved_at
      ? row.resolved_at instanceof Date
        ? row.resolved_at.toISOString()
        : String(row.resolved_at)
      : null,
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createAlert(
  data: Pick<
    Alert,
    "id" | "site_id" | "module" | "severity" | "title" | "detail"
  >,
): Promise<AlertJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO alerts
       (id, site_id, module, severity, title, detail, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', NOW(3))`,
    [
      data.id,
      data.site_id,
      data.module,
      data.severity,
      data.title,
      data.detail,
    ],
  );
  const alert = await getAlertById(data.id);
  return alert!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listAlerts(filters: {
  status?: string;
  severity?: string;
  site_id?: number;
}): Promise<{ alerts: AlertJSON[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.severity) {
    conditions.push("severity = ?");
    params.push(filters.severity);
  }
  if (filters.site_id) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.query<Alert[]>(
    `SELECT * FROM alerts ${where} ORDER BY created_at DESC`,
    params,
  );
  const alerts = (rows as Alert[]).map(toJSON);
  return { alerts, total: alerts.length };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getAlertById(id: string): Promise<AlertJSON | null> {
  const [rows] = await pool.query<Alert[]>(
    "SELECT * FROM alerts WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── ACKNOWLEDGE ───────────────────────────────────────────────────────
export async function acknowledgeAlert(id: string): Promise<AlertJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE alerts SET status = 'acknowledged' WHERE id = ?",
    [id],
  );
  if (result.affectedRows === 0) return null;
  return getAlertById(id);
}

// ── RESOLVE ───────────────────────────────────────────────────────────
export async function resolveAlert(id: string): Promise<AlertJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE alerts SET status = 'resolved', resolved_at = NOW(3) WHERE id = ?",
    [id],
  );
  if (result.affectedRows === 0) return null;
  return getAlertById(id);
}
