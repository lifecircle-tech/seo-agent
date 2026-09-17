import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const TENANT_AGENT_TOOL_ACCESS_SELECT = `
  SELECT tato.access_id, t.tenant_id, a.agent_id,
         m.tool_id, m.name, tato.status, tato.granted_at
  FROM tenant_agent_tool_access tato
  JOIN tenant t ON t.tenant_id = tato.tenant_id
  JOIN agent a ON a.agent_id = tato.agent_id
  JOIN mcp_tools m ON m.tool_id = tato.tool_id
`;

interface TenantAgentToolAccessInput {
  tenant_id: string;
  agent_id: string;
  tool_id: string;
  status?: string | null;
}

interface TenantAgentToolAccessUpdateInput {
  status?: string | null;
}

interface TenantAgentToolAccessFilter extends PaginationInput {
  tenant_id?: string | number;
  agent_id?: string;
  tool_id?: string;
  slug?: string;
  status?: string;
}

async function insertTenantAgentToolAccess(data: TenantAgentToolAccessInput) {
  if (!data.tenant_id) {
    throw new Error(`Tenant not found: ${data.tenant_id}`);
  }
  if (!data.agent_id) {
    throw new Error(`Agent not found: ${data.agent_id}`);
  }
  if (!data.tool_id) {
    throw new Error(`MCP tool not found: ${data.tool_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO tenant_agent_tool_access (tenant_id, agent_id, tool_id, status)
     VALUES (?, ?, ?, COALESCE(?, 'active'))`,
    [data.tenant_id, data.agent_id, data.tool_id, data.status ?? null],
  );

  return result.insertId;
}

async function findTenantAgentToolAccesses(
  filter: TenantAgentToolAccessFilter = {},
) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.tenant_id) {
    conditions.push("tato.tenant_id = ?");
    params.push(filter.tenant_id ?? -1);
  }
  if (filter.agent_id) {
    conditions.push("tato.agent_id = ?");
    params.push(filter.agent_id ?? -1);
  }
  if (filter.tool_id) {
    conditions.push("tato.tool_id = ?");
    params.push(filter.tool_id ?? -1);
  }
  if(filter.slug) {
    conditions.push("t.slug = ?");
    params.push(filter.slug ?? "");
  }
  if (filter.status) {
    conditions.push("tato.status = ?");
    params.push(filter.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${TENANT_AGENT_TOOL_ACCESS_SELECT} ${where} ORDER BY tato.granted_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findTenantAgentToolAccessById(access_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${TENANT_AGENT_TOOL_ACCESS_SELECT} WHERE tato.access_id = ?`,
    [access_id],
  );

  return rows[0] ?? null;
}

async function updateTenantAgentToolAccessById(
  access_id: string,
  data: TenantAgentToolAccessUpdateInput,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE tenant_agent_tool_access
     SET status = COALESCE(?, status)
     WHERE access_id = ?`,
    [data.status ?? null, access_id],
  );

  return result.affectedRows > 0;
}

async function deleteTenantAgentToolAccessById(access_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM tenant_agent_tool_access WHERE access_id = ?`,
    [access_id],
  );

  return result.affectedRows > 0;
}

export {
  insertTenantAgentToolAccess,
  findTenantAgentToolAccesses,
  findTenantAgentToolAccessById,
  updateTenantAgentToolAccessById,
  deleteTenantAgentToolAccessById,
};
