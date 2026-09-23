import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const AGENT_TOOL_ACCESS_SELECT = `
  SELECT ata.access_id, a.agent_id, m.tool_id, m.name, ata.status, ata.granted_at
  FROM agent_tool_access ata
  JOIN agent a ON a.agent_id = ata.agent_id
  JOIN mcp_tools m ON m.tool_id = ata.tool_id
`;

interface AgentToolAccessInput {
  agent_id: string | number;
  tool_id: string;
  status?: string | null;
}

interface AgentToolAccessFilter extends PaginationInput {
  agent_id?: string | number;
  tool_id?: string;
  status?: string;
}

async function insertAgentToolAccess(data: AgentToolAccessInput) {
  if (!data.agent_id) {
    throw new Error(`Agent not found: ${data.agent_id}`);
  }
  if (!data.tool_id) {
    throw new Error(`MCP tool not found: ${data.tool_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO agent_tool_access (agent_id, tool_id, status)
     VALUES (?, ?, COALESCE(?, 'active'))`,
    [data.agent_id, data.tool_id, data.status ?? null],
  );

  return result.insertId;
}

async function findAgentToolAccesses(filter: AgentToolAccessFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.agent_id) {
    conditions.push("ata.agent_id = ?");
    params.push(filter.agent_id ?? -1);
  }
  if (filter.tool_id) {
    conditions.push("ata.tool_id = ?");
    params.push(filter.tool_id ?? -1);
  }
  if (filter.status) {
    conditions.push("ata.status = ?");
    params.push(filter.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${AGENT_TOOL_ACCESS_SELECT} ${where} ORDER BY ata.granted_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findAgentToolAccessById(access_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${AGENT_TOOL_ACCESS_SELECT} WHERE ata.access_id = ?`,
    [access_id],
  );

  return rows[0] ?? null;
}

async function deleteAgentToolAccessById(access_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM agent_tool_access WHERE access_id = ?`,
    [access_id],
  );

  return result.affectedRows > 0;
}

export {
  insertAgentToolAccess,
  findAgentToolAccesses,
  findAgentToolAccessById,
  deleteAgentToolAccessById,
};
