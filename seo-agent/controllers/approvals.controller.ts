/**
 * Approvals controller — all MySQL query operations for the approvals table.
 * Routes in approvals.routes.ts call these functions; no HTTP objects here.
 */

import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Approval, ApprovalJSON } from "../models/approval.model.js";
import { lc_pool, pool } from "../../db.js";
import {
  bulkUpdateCanonicalURL,
  updatePageMeta,
} from "../services/wordpress.service.js";

import { runPageContentAgent } from "../services/page-content.service.js";
import { logger } from "../utils/logger.js";
import { isUrlRedirected } from "../../libs/functions.js";
import { getPage } from "../mcp-servers/cms-connector/server.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: Approval): ApprovalJSON {
  return {
    ...row,
    original_content:
      typeof row.original_content === "string"
        ? (JSON.parse(row.original_content) as Record<string, unknown>)
        : row.original_content,
    updated_content:
      row.updated_content === null || typeof row.updated_content === "object"
        ? row.updated_content
        : (JSON.parse(row.updated_content) as Record<string, unknown>),
    reason: row.reason ?? null,
    update_page: Boolean(row.update_page),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    actioned_at: row.actioned_at
      ? row.actioned_at instanceof Date
        ? row.actioned_at.toISOString()
        : String(row.actioned_at)
      : null,
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createApproval(
  data: Pick<
    Approval,
    | "id"
    | "site_id"
    | "module"
    | "type"
    | "priority"
    | "title"
    | "original_content"
    | "updated_content"
    | "reason"
    | "update_page"
    | "preview_url"
  >,
): Promise<ApprovalJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO approvals
      (id, site_id, module, type, priority, title, original_content, updated_content, reason, update_page, preview_url, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(3))`,
    [
      data.id,
      data.site_id,
      data.module,
      data.type,
      data.priority,
      data.title,
      JSON.stringify(data.original_content),
      JSON.stringify(data.updated_content),
      data.reason ?? null,
      data.update_page ? 1 : 0,
      data.preview_url ?? null,
    ],
  );
  const approval = await getApprovalById(data.id);
  return approval!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listApprovals(filters: {
  status?: string;
  site_id?: number;
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  approvals: ApprovalJSON[];
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
  if (filters.site_id) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order =
    filters.sort === "priority"
      ? "ORDER BY priority ASC"
      : "ORDER BY created_at DESC";

  const limit = Math.min(filters.limit ?? 10, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM approvals ${where}`,
      params,
    ),
    pool.query<Approval[]>(
      `SELECT * FROM approvals ${where} ${order} LIMIT ? OFFSET ?`,
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
  const approvals = (rows as Approval[]).map(toJSON).map((approval) => {
    return {
      ...approval,
      actioned_user_name: approval.actioned_by
        ? userMap[approval.actioned_by]
        : null,
    };
  });
  return { approvals, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getApprovalById(
  id: string,
): Promise<ApprovalJSON | null> {
  const [rows] = await pool.query<Approval[]>(
    "SELECT * FROM approvals WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── APPROVE ───────────────────────────────────────────────────────────
export async function approveApproval(
  id: string,
  actionedBy: string,
  editedContent?: Record<string, unknown>,
): Promise<ApprovalJSON | null> {
  const approval = await getApprovalById(id);
  if (!approval) return null;

  if (approval.actioned_by) return approval;

  // Use editedContent if provided, otherwise use the suggested AI-generated content
  const contentToStore = editedContent ?? approval.updated_content;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE approvals
     SET status = 'approved', actioned_at = NOW(3), actioned_by = ?, updated_content = ?
     WHERE id = ?`,
    [actionedBy, JSON.stringify(contentToStore), id],
  );

  if (result.affectedRows === 0) return null;

  // If the approved item is a meta_rewrite, push the change to WordPress.
  if (approval.type === "meta_rewrite") {
    const c = (approval.updated_content ?? approval.original_content) as {
      // Use updated_content if present, else original
      url?: string;
      suggested_title?: string;
      suggested_description?: string;
    };

    if (approval.original_content.url) {
      const isRedirected = await isUrlRedirected(approval.original_content.url);
      if (!isRedirected) {
        runPageContentAgent(id);
      }
    }

    logger.debug("Updating WordPress Meta...", c); // url could be missing, checking...
    if (c.url && c.suggested_title && c.suggested_description) {
      logger.debug("Check condition Passed");
      const wpResult = await updatePageMeta(
        approval.site_id,
        c.url,
        c.suggested_title,
        c.suggested_description,
      );

      if (!wpResult.ok) {
        logger.error(
          `[approveApproval] WordPress update failed for approval ${id}:`,
          wpResult.error,
        );
      } else {
        logger.info(
          `[approveApproval] WordPress meta updated for ${c.url} (approval ${id})`,
        );
      }
    } else {
      logger.debug("Check condition failed", c);
    }
  } else if (approval.type === "canonical") {
    type CanonicalUpdate = { id: number; canonical_url: string };
    let items = [] as CanonicalUpdate[];
    let canonical_url = approval.updated_content?.recommended_primary_url;

    for (let url of approval.updated_content?.competing_urls) {
      const page = await getPage(approval.site_id, url);
      items.push({ id: page?.id, canonical_url } as CanonicalUpdate);
    }

    await bulkUpdateCanonicalURL(approval.site_id, items);
  }

  return approval;
}

// ── REJECT ────────────────────────────────────────────────────────────
export async function rejectApproval(
  id: string,
  actionedBy: string,
  reason: string,
  remark?: string,
): Promise<ApprovalJSON | null> {
  const approval = await getApprovalById(id);
  if (!approval) return null;

  if (approval.actioned_by) return approval;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE approvals
     SET status = 'rejected', actioned_at = NOW(3), actioned_by = ?, reject_reason = ?, remark = ?
     WHERE id = ?`,
    [actionedBy, reason, remark, id],
  );
  if (result.affectedRows === 0) return null;
  return getApprovalById(id);
}

// ── GET BY URL ────────────────────────────────────────────────────────
export async function getMetaRewriteApprovedApprovalByUrl(
  url: string,
): Promise<ApprovalJSON | null> {
  const [rows] = await pool.query<Approval[]>(
    `SELECT * FROM approvals
     WHERE JSON_UNQUOTE(JSON_EXTRACT(original_content, '$.url')) = ?
       AND status = 'approved' AND type = 'meta_rewrite'
     ORDER BY actioned_at DESC
     LIMIT 1`,
    [url],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── DEFER ─────────────────────────────────────────────────────────────
export async function deferApproval(
  id: string,
  actionedBy: string,
): Promise<ApprovalJSON | null> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE approvals SET status = 'deferred', actioned_at = NOW(3), actioned_by = ? WHERE id = ?",
    [actionedBy, id],
  );
  if (result.affectedRows === 0) return null;
  return getApprovalById(id);
}
