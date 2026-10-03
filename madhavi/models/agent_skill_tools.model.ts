import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

interface AgentSkillToolInput {
  skill_name: string;
  description?: string | null;
  content?: string | null;
  active?: boolean | null;
}

interface AgentSkillToolFilter extends PaginationInput {
  skill_name?: string;
  active?: boolean;
}

interface AgentSkillToolUpdateInput {
  skill_name?: string | null;
  description?: string | null;
  content?: string | null;
}

async function insertAgentSkillTool(data: AgentSkillToolInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO agent_skill_tools (skill_name, description, content, active)
     VALUES (?, ?, ?, COALESCE(?, FALSE))`,
    [data.skill_name, data.description ?? null, data.content ?? null, data.active ?? null],
  );

  return result.insertId;
}

async function findAgentSkillTools(filter: AgentSkillToolFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.skill_name) {
    conditions.push("skill_name LIKE ?");
    params.push(`%${filter.skill_name}%`);
  }
  if (filter.active !== undefined) {
    conditions.push("active = ?");
    params.push(filter.active);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM agent_skill_tools ${where} ORDER BY skill_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findAgentSkillToolById(skill_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM agent_skill_tools WHERE skill_id = ?`,
    [skill_id],
  );

  return rows[0] ?? null;
}

async function updateAgentSkillToolById(
  skill_id: string,
  data: AgentSkillToolUpdateInput,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE agent_skill_tools
     SET skill_name = COALESCE(?, skill_name),
         description = COALESCE(?, description),
         content = COALESCE(?, content)
     WHERE skill_id = ?`,
    [data.skill_name ?? null, data.description ?? null, data.content ?? null, skill_id],
  );

  return result.affectedRows > 0;
}

async function updateAgentSkillToolActiveById(skill_id: string, active: boolean) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE agent_skill_tools SET active = ? WHERE skill_id = ?`,
    [active, skill_id],
  );

  return result.affectedRows > 0;
}

async function deleteAgentSkillToolById(skill_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM agent_skill_tools WHERE skill_id = ?`,
    [skill_id],
  );

  return result.affectedRows > 0;
}

export {
  insertAgentSkillTool,
  findAgentSkillTools,
  findAgentSkillToolById,
  updateAgentSkillToolById,
  updateAgentSkillToolActiveById,
  deleteAgentSkillToolById,
};
