import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const AGENT_SKILLS_ACCESS_SELECT = `
  SELECT asa.access_id, a.agent_id, s.skill_id, s.skill_name, asa.granted_at
  FROM agent_skills_access asa
  JOIN agent a ON a.agent_id = asa.agent_id
  JOIN agent_skill_tools s ON s.skill_id = asa.skill_id
`;

interface AgentSkillsAccessInput {
  agent_id: string;
  skill_id: string;
}

interface AgentSkillsAccessFilter extends PaginationInput {
  agent_id?: string;
  skill_id?: string;
}

async function insertAgentSkillsAccess(data: AgentSkillsAccessInput) {
  if (!data.agent_id) {
    throw new Error(`Agent not found: ${data.agent_id}`);
  }
  if (!data.skill_id) {
    throw new Error(`Skill not found: ${data.skill_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO agent_skills_access (agent_id, skill_id)
     VALUES (?, ?)`,
    [data.agent_id, data.skill_id],
  );

  return result.insertId;
}

async function findAgentSkillsAccesses(filter: AgentSkillsAccessFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.agent_id) {
    conditions.push("asa.agent_id = ?");
    params.push(filter.agent_id ?? -1);
  }
  if (filter.skill_id) {
    conditions.push("asa.skill_id = ?");
    params.push(filter.skill_id ?? -1);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${AGENT_SKILLS_ACCESS_SELECT} ${where} ORDER BY asa.granted_at ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findAgentSkillsAccessById(access_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${AGENT_SKILLS_ACCESS_SELECT} WHERE asa.access_id = ?`,
    [access_id],
  );

  return rows[0] ?? null;
}

async function findAgentSkillsAccessesWithContent(agent_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT asa.access_id, s.skill_id, s.skill_name, s.description, s.content, s.active
     FROM agent_skills_access asa
     JOIN agent_skill_tools s ON s.skill_id = asa.skill_id
     WHERE asa.agent_id = ?`,
    [agent_id],
  );

  return rows;
}

async function deleteAgentSkillsAccessById(access_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM agent_skills_access WHERE access_id = ?`,
    [access_id],
  );

  return result.affectedRows > 0;
}

export {
  insertAgentSkillsAccess,
  findAgentSkillsAccesses,
  findAgentSkillsAccessById,
  findAgentSkillsAccessesWithContent,
  deleteAgentSkillsAccessById,
};
