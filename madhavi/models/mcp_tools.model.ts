import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

interface McpToolInput {
  name: string;
  title?: string | null;
  description?: string | null;
  endpoint_url?: string | null;
  is_active?: boolean | null;
}

interface McpToolUpdateInput {
  name?: string | null;
  title?: string | null;
  description?: string | null;
  endpoint_url?: string | null;
  is_active?: boolean | null;
}

async function insertMcpTool(data: McpToolInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO mcp_tools (name, title, description, endpoint_url, is_active)
     VALUES (?, ?, ?, ?, COALESCE(?, TRUE))`,
    [
      data.name,
      data.title ?? null,
      data.description ?? null,
      data.endpoint_url ?? null,
      data.is_active ?? null,
    ],
  );

  return result.insertId;
}

interface McpToolFilter extends PaginationInput {
  name?: string;
  is_active?: boolean;
}

async function findMcpTools(filter: McpToolFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.name) {
    conditions.push("name LIKE ?");
    params.push(`%${filter.name}%`);
  }
  if (filter.is_active !== undefined) {
    conditions.push("is_active = ?");
    params.push(filter.is_active);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM mcp_tools ${where} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findMcpToolById(tool_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM mcp_tools WHERE tool_id = ?`,
    [tool_id],
  );

  return rows[0] ?? null;
}

async function updateMcpToolById(tool_id: string, data: McpToolUpdateInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE mcp_tools
     SET name = COALESCE(?, name),
         title = COALESCE(?, title),
         description = COALESCE(?, description),
         endpoint_url = COALESCE(?, endpoint_url),
         is_active = COALESCE(?, is_active)
     WHERE tool_id = ?`,
    [
      data.name ?? null,
      data.title ?? null,
      data.description ?? null,
      data.endpoint_url ?? null,
      data.is_active ?? null,
      tool_id,
    ],
  );

  return result.affectedRows > 0;
}

async function deleteMcpToolById(tool_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM mcp_tools WHERE tool_id = ?`,
    [tool_id],
  );

  return result.affectedRows > 0;
}

export {
  insertMcpTool,
  findMcpTools,
  findMcpToolById,
  updateMcpToolById,
  deleteMcpToolById,
};
