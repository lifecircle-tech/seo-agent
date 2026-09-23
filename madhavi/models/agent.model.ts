import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

interface Agents extends RowDataPacket {
  agent_id: number;
  name: string;
  key: string;
  description: string;
  is_active: boolean;
  created_at: Date | string;
}

interface AgentInput {
  name: string;
  key: string;
  description?: string;
  is_active?: boolean | null;
}

interface AgentUpdateInput {
  name?: string | null;
  description?: string | null;
  is_active?: boolean | null;
}

interface AgentPrompt {
  prompt?: string;
}

async function insertAgent(data: AgentInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO agent (name, \`key\`, description, is_active)
     VALUES (?, ?, ?, COALESCE(?, TRUE))`,
    [data.name, data.key, data.description, data.is_active ?? null],
  );

  return result.insertId;
}

interface AgentFilter extends PaginationInput {
  name?: string;
  is_active?: boolean;
}

async function findAgents(filter: AgentFilter = {}) {
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

  const [rows] = await madhavi_pool.query<Agents[]>(
    `SELECT * FROM agent ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findAgentById(agent_id: string | number) {
  const [rows] = await madhavi_pool.query<(Agents & AgentPrompt)[]>(
    `SELECT a.*, p.content as prompt
    FROM agent a
    LEFT JOIN agent_prompt p on p.agent_id = a.agent_id
    WHERE a.agent_id = ?`,
    [agent_id],
  );

  return rows[0] ?? null;
}

async function findAgentByKey(key: string) {
  const [rows] = await madhavi_pool.query<(Agents & AgentPrompt)[]>(
    `SELECT a.*, p.content as prompt
    FROM agent a
    LEFT JOIN agent_prompt p on p.agent_id = a.agent_id
    WHERE a.key = ?`,
    [key],
  );

  return rows[0] ?? null;
}

async function updateAgentById(agent_id: string, data: AgentUpdateInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE agent
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         is_active = COALESCE(?, is_active)
     WHERE agent_id = ?`,
    [data.name ?? null, data.description, data.is_active ?? null, agent_id],
  );

  return result.affectedRows > 0;
}

async function deleteAgentById(agent_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM agent WHERE agent_id = ?`,
    [agent_id],
  );

  return result.affectedRows > 0;
}

async function getMadhaviAndPrompts() {}

export {
  insertAgent,
  findAgents,
  findAgentById,
  findAgentByKey,
  updateAgentById,
  deleteAgentById,
};
