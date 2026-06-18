import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

interface DashboardStats {
  pending_approvals: number;
  created_page_contents: number;
  open_alerts: number;
}

export async function getDashboardStats(site_id?: number): Promise<DashboardStats> {
  const siteFilter = site_id ? "AND site_id = ?" : "";
  const params = site_id ? [site_id] : [];

  const [[approvalsRow], [pageContentsRow], [alertsRow]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending' ${siteFilter}`,
      params
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM page_content WHERE status = 'created' ${siteFilter}`,
      params
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM alerts WHERE status = 'open' ${siteFilter}`,
      params
    ),
  ]);

  return {
    pending_approvals: approvalsRow[0].count,
    created_page_contents: pageContentsRow[0].count,
    open_alerts: alertsRow[0].count,
  };
}
