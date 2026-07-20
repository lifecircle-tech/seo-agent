import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Opportunity, OpportunityJSON } from "../models/opportunities.model.js";
import { lc_pool, pool } from "../../db.js";

// ── Row serialiser ────────────────────────────────────────────────────
function toJSON(row: Opportunity): OpportunityJSON {
  return {
    ...row,
    opportunity_details:
      typeof row.opportunity_details === "string"
        ? JSON.parse(row.opportunity_details)
        : row.opportunity_details,
    actioned_at: row.actioned_at
      ? row.actioned_at instanceof Date
        ? row.actioned_at.toISOString()
        : String(row.actioned_at)
      : null,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

// ── CREATE ────────────────────────────────────────────────────────────
export async function createOpportunity(
  data: Pick<
    Opportunity,
    | "id"
    | "site_id"
    | "opportunity_type"
    | "priority"
    | "reasoning"
    | "opportunity_details"
  >,
): Promise<OpportunityJSON> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO opportunities
      (id, site_id, opportunity_type, priority, reasoning, opportunity_details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.site_id,
      data.opportunity_type,
      data.priority ?? null,
      data.reasoning ?? null,
      data.opportunity_details != null
        ? JSON.stringify(data.opportunity_details)
        : null,
    ],
  );
  return (await getOpportunityById(data.id))!;
}

// ── LIST ──────────────────────────────────────────────────────────────
export async function listOpportunities(filters: {
  site_id?: number;
  status?: string;
  opportunity_type?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  opportunities: OpportunityJSON[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filters.site_id !== undefined) {
    conditions.push("site_id = ?");
    params.push(filters.site_id);
  }
  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.opportunity_type) {
    conditions.push("opportunity_type = ?");
    params.push(filters.opportunity_type);
  }
  if (filters.priority) {
    conditions.push("priority = ?");
    params.push(filters.priority);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const [[countRow], [rows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM opportunities ${where}`,
      params,
    ),
    pool.query<Opportunity[]>(
      `SELECT * FROM opportunities ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
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
  const opportunities = (rows as Opportunity[]).map(toJSON).map((approval) => {
    return {
      ...approval,
      actioned_user_name: approval.actioned_by
        ? userMap[approval.actioned_by]
        : null,
    };
  });

  return { opportunities, total, limit, offset };
}

// ── GET BY ID ─────────────────────────────────────────────────────────
export async function getOpportunityById(
  id: string,
): Promise<OpportunityJSON | null> {
  const [rows] = await pool.query<Opportunity[]>(
    "SELECT * FROM opportunities WHERE id = ?",
    [id],
  );
  return rows.length ? toJSON(rows[0]) : null;
}

// ── UPDATE ────────────────────────────────────────────────────────────
export async function updateOpportunity(
  id: string,
  data: Partial<
    Pick<
      Opportunity,
      "opportunity_type" | "priority" | "reasoning" | "opportunity_details"
    >
  >,
): Promise<OpportunityJSON | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.opportunity_type !== undefined) {
    fields.push("opportunity_type = ?");
    params.push(data.opportunity_type);
  }
  if (data.priority !== undefined) {
    fields.push("priority = ?");
    params.push(data.priority);
  }
  if (data.reasoning !== undefined) {
    fields.push("reasoning = ?");
    params.push(data.reasoning);
  }
  if (data.opportunity_details !== undefined) {
    fields.push("opportunity_details = ?");
    params.push(
      data.opportunity_details != null
        ? JSON.stringify(data.opportunity_details)
        : null,
    );
  }

  if (fields.length === 0) return getOpportunityById(id);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE opportunities SET ${fields.join(", ")} WHERE id = ?`,
    [...params, id],
  );

  if (result.affectedRows === 0) return null;
  return getOpportunityById(id);
}

// ── MARK COMPLETED ────────────────────────────────────────────────────
export async function completeOpportunity(
  id: string,
  actionedBy?: string,
): Promise<OpportunityJSON | null> {
  const opportunity = await getOpportunityById(id);
  if (!opportunity) return null;

  if (opportunity.actioned_by) return opportunity;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE opportunities SET status = 'completed', actioned_by = ?, actioned_at = NOW(3) WHERE id = ?`,
    [actionedBy ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getOpportunityById(id);
}

// ── MARK IGNORED ──────────────────────────────────────────────────────
export async function ignoreOpportunity(
  id: string,
  actionedBy?: string,
): Promise<OpportunityJSON | null> {
  const opportunity = await getOpportunityById(id);
  if (!opportunity) return null;

  if (opportunity.actioned_by) return opportunity;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE opportunities SET status = 'ignore', actioned_by = ?, actioned_at = NOW(3) WHERE id = ?`,
    [actionedBy ?? null, id],
  );
  if (result.affectedRows === 0) return null;
  return getOpportunityById(id);
}

// ── DELETE ────────────────────────────────────────────────────────────
export async function deleteOpportunity(id: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM opportunities WHERE id = ?",
    [id],
  );
  return result.affectedRows > 0;
}
