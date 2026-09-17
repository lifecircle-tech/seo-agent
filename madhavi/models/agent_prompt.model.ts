import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const AGENT_PROMPT_SELECT = `
  SELECT ap.prompt_id, a.agent_id, ap.section, ap.content, ap.version, ap.updated_at
  FROM agent_prompt ap
  JOIN agent a ON a.agent_id = ap.agent_id
`;

interface AgentPromptInput {
  agent_id: string;
  section: string;
  content: string;
  version?: number | null;
}

interface AgentPromptUpdateInput {
  section?: string | null;
  content?: string | null;
  version?: number | null;
}

async function insertAgentPrompt(data: AgentPromptInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO agent_prompt (agent_id, section, content, version)
     VALUES (?, ?, ?, COALESCE(?, 1))`,
    [data.agent_id, data.section, data.content, data.version ?? null],
  );

  return result.insertId;
}

interface AgentPromptFilter extends PaginationInput {
  agent_id?: number;
  section?: string;
}

async function findAgentPrompts(filter: AgentPromptFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.agent_id) {
    conditions.push("ap.agent_id = ?");
    params.push(filter.agent_id ?? -1);
  }
  if (filter.section) {
    conditions.push("ap.section = ?");
    params.push(filter.section);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${AGENT_PROMPT_SELECT} ${where} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findAgentPromptById(prompt_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${AGENT_PROMPT_SELECT} WHERE ap.prompt_id = ?`,
    [prompt_id],
  );

  return rows[0] ?? null;
}

async function updateAgentPromptById(
  prompt_id: string,
  data: AgentPromptUpdateInput,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE agent_prompt
     SET section = COALESCE(?, section),
         content = COALESCE(?, content),
         version = COALESCE(?, version)
     WHERE prompt_id = ?`,
    [data.section ?? null, data.content ?? null, data.version ?? null, prompt_id],
  );

  return result.affectedRows > 0;
}

async function deleteAgentPromptById(prompt_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM agent_prompt WHERE prompt_id = ?`,
    [prompt_id],
  );

  return result.affectedRows > 0;
}

export {
  insertAgentPrompt,
  findAgentPrompts,
  findAgentPromptById,
  updateAgentPromptById,
  deleteAgentPromptById,
};
