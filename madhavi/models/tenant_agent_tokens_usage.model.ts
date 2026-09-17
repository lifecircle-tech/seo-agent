import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const TENANT_AGENT_TOKENS_USAGE_SELECT = `
  SELECT u.usage_id, t.tenant_id, a.agent_id,
         u.input_tokens, u.output_tokens, u.total_tokens,
         u.request_started_at, u.request_completed_at, u.created_at
  FROM tenant_agent_tokens_usage u
  JOIN tenant t ON t.tenant_id = u.tenant_id
  JOIN agent a ON a.agent_id = u.agent_id
`;

interface TenantAgentTokensUsageInput {
  tenant_id: string;
  agent_id: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  request_started_at: string;
  request_completed_at?: string | null;
}

interface TenantAgentTokensUsageUpdateInput {
  input_tokens?: number | null;
  output_tokens?: number | null;
  request_completed_at?: string | null;
}

interface TenantAgentTokensUsageFilter extends PaginationInput {
  tenant_id?: string;
  agent_id?: string;
}

async function insertTenantAgentTokensUsage(data: TenantAgentTokensUsageInput) {
  if (!data.tenant_id) {
    throw new Error(`Tenant not found: ${data.tenant_id}`);
  }
  if (!data.agent_id) {
    throw new Error(`Agent not found: ${data.agent_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO tenant_agent_tokens_usage
       (tenant_id, agent_id, input_tokens, output_tokens, request_started_at, request_completed_at)
     VALUES (?, ?, COALESCE(?, 0), COALESCE(?, 0), ?, ?)`,
    [
      data.tenant_id,
      data.agent_id,
      data.input_tokens ?? null,
      data.output_tokens ?? null,
      data.request_started_at,
      data.request_completed_at ?? null,
    ],
  );

  return result.insertId;
}

async function findTenantAgentTokensUsages(
  filter: TenantAgentTokensUsageFilter = {},
) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.tenant_id) {
    conditions.push("u.tenant_id = ?");
    params.push(filter.tenant_id ?? -1);
  }
  if (filter.agent_id) {
    conditions.push("u.agent_id = ?");
    params.push(filter.agent_id ?? -1);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${TENANT_AGENT_TOKENS_USAGE_SELECT} ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findTenantAgentTokensUsageById(usage_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${TENANT_AGENT_TOKENS_USAGE_SELECT} WHERE u.usage_id = ?`,
    [usage_id],
  );

  return rows[0] ?? null;
}

async function updateTenantAgentTokensUsageById(
  usage_id: string,
  data: TenantAgentTokensUsageUpdateInput,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE tenant_agent_tokens_usage
     SET input_tokens = COALESCE(?, input_tokens),
         output_tokens = COALESCE(?, output_tokens),
         request_completed_at = COALESCE(?, request_completed_at)
     WHERE usage_id = ?`,
    [
      data.input_tokens ?? null,
      data.output_tokens ?? null,
      data.request_completed_at ?? null,
      usage_id,
    ],
  );

  return result.affectedRows > 0;
}

async function deleteTenantAgentTokensUsageById(usage_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM tenant_agent_tokens_usage WHERE usage_id = ?`,
    [usage_id],
  );

  return result.affectedRows > 0;
}

interface TenantTokenUsageAggregateRow extends RowDataPacket {
  period: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  request_count: number;
}

async function getTenantTokenUsageSummary(slug: string) {
  const [rows] = await madhavi_pool.query<TenantTokenUsageAggregateRow[]>(
    `SELECT DATE_FORMAT(tat.created_at, '%Y-%m') AS period,
            CAST(SUM(tat.input_tokens) AS UNSIGNED) AS input_tokens,
            CAST(SUM(tat.output_tokens) AS UNSIGNED) AS output_tokens,
            CAST(SUM(tat.total_tokens) AS UNSIGNED) AS total_tokens,
            COUNT(*) AS request_count
     FROM tenant_agent_tokens_usage tat
     RIGHT JOIN tenant t on t.tenant_id = tat.tenant_id
     WHERE t.slug = ?
       AND tat.created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
     GROUP BY period`,
    [slug],
  );

  return rows;
}

async function getTenantTokenUsageDailyAnalytics(slug: string) {
  const [rows] = await madhavi_pool.query<TenantTokenUsageAggregateRow[]>(
    `SELECT DATE_FORMAT(tat.created_at, '%Y-%m-%d') AS period,
            CAST(SUM(tat.input_tokens) AS UNSIGNED) AS input_tokens,
            CAST(SUM(tat.output_tokens) AS UNSIGNED) AS output_tokens,
            CAST(SUM(tat.total_tokens) AS UNSIGNED) AS total_tokens,
            COUNT(*) AS request_count
     FROM tenant_agent_tokens_usage tat
     RIGHT JOIN tenant t on t.tenant_id = tat.tenant_id
     WHERE t.slug = ?
       AND tat.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
     GROUP BY period`,
    [slug],
  );

  return rows;
}

async function getTenantTokenUsageMonthlyAnalytics(slug: string) {
  const [rows] = await madhavi_pool.query<TenantTokenUsageAggregateRow[]>(
    `SELECT DATE_FORMAT(tat.created_at, '%Y-%m') AS period,
            CAST(SUM(tat.input_tokens) AS UNSIGNED) AS input_tokens,
            CAST(SUM(tat.output_tokens) AS UNSIGNED) AS output_tokens,
            CAST(SUM(tat.total_tokens) AS UNSIGNED) AS total_tokens,
            COUNT(*) AS request_count
     FROM tenant_agent_tokens_usage tat
     RIGHT JOIN tenant t on t.tenant_id = tat.tenant_id
     WHERE t.slug = ?
       AND tat.created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
     GROUP BY period`,
    [slug],
  );

  return rows;
}

export {
  insertTenantAgentTokensUsage,
  findTenantAgentTokensUsages,
  findTenantAgentTokensUsageById,
  updateTenantAgentTokensUsageById,
  deleteTenantAgentTokensUsageById,
  getTenantTokenUsageSummary,
  getTenantTokenUsageDailyAnalytics,
  getTenantTokenUsageMonthlyAnalytics,
};
