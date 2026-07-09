/**
 * Alerts controller — all MySQL query operations for the alerts table.
 * Routes in alerts.routes.ts call these functions; no HTTP objects here.
 */

import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Alert, AlertJSON } from "../models/alert.model.js";
import { lc_pool, pool } from "../../db.js";
import { logger } from "../utils/logger.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: Alert): AlertJSON {
  return {
    ...row,
    details:
      typeof row.details === "string" ? JSON.parse(row.details) : row.details,
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

// ── BULK CREATE ───────────────────────────────────────────────────────
export async function bulkCreateAlerts(
  items: Pick<
    Alert,
    "id" | "site_id" | "module" | "severity" | "title" | "details"
  >[],
): Promise<{ inserted: number; ids: string[] }> {
  if (items.length === 0) return { inserted: 0, ids: [] };

  const placeholders = items
    .map(() => "(?, ?, ?, ?, ?, ?, 'open', NOW(3))")
    .join(", ");
  const params: unknown[] = [];

  for (const item of items) {
    params.push(
      item.id,
      item.site_id,
      item.module,
      item.severity,
      item.title,
      JSON.stringify(item.details),
    );
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO alerts (id, site_id, module, severity, title, details, status, created_at)
      VALUES ${placeholders}`,
      params,
    );
    return { inserted: result.affectedRows, ids: items.map((i) => i.id) };
  } catch (err: any) {
    logger.error("[bulk create alert] Error ", err);

    return { inserted: 0, ids: [] };
  }
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listAlerts(filters: {
  status?: string;
  severity?: string;
  module?: string;
  site_id?: number;
  limit?: number;
  offset?: number;
}): Promise<{
  alerts: AlertJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
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
  if (filters.module) {
    conditions.push("module = ?");
    params.push(filters.module);
  }
  if (filters.site_id) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 10, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM alerts ${where}`,
      params,
    ),
    pool.query<Alert[]>(
      `SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const userIds = new Set();
  rows.forEach((row) => {
    if (row.actioned_by) {
      userIds.add(row.actioned_by);
    }
  });

  const userMap = {} as Record<string, string>;
  if (userIds.size > 0) {
    const [users] = await lc_pool.query<any[]>(
      `SELECT emp_name, det_id from life_emp_details WHERE det_id IN (?)`,
      [[...userIds]],
    );

    users.forEach((user) => {
      userMap[user.det_id] = user.emp_name;
    });
  }

  const total = Number((countRow as RowDataPacket[])[0].count);
  const alerts = (rows as Alert[]).map(toJSON).map((approval) => {
    return {
      ...approval,
      actioned_user_name: approval.actioned_by
        ? userMap[approval.actioned_by]
        : null,
    };
  });
  return { alerts, total, limit, offset };
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
export async function acknowledgeAlert(
  id: string,
  actionedBy: string,
): Promise<AlertJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE alerts SET status = 'acknowledged', actioned_by = ? WHERE id = ?",
    [actionedBy, id],
  );
  if (result.affectedRows === 0) return null;
  return getAlertById(id);
}

// ── RESOLVE ───────────────────────────────────────────────────────────
export async function resolveAlert(id: string,
  actionedBy: string,
): Promise<AlertJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE alerts SET status = 'resolved', resolved_at = NOW(3), actioned_by = ? WHERE id = ?",
    [actionedBy, id],
  );
  if (result.affectedRows === 0) return null;
  return getAlertById(id);
}
