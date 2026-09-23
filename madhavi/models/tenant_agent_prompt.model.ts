import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const TENANT_AGENT_PROMPT_SELECT = `
  SELECT tap.tenant_prompt_id, t.tenant_id AS tenant_id, a.agent_id AS agent_id,
         tap.access_id, tap.section, tap.content, tap.updated_at
  FROM tenant_agent_prompt tap
  JOIN tenant t ON t.tenant_id = tap.tenant_id
  JOIN agent a ON a.agent_id = tap.agent_id
`;

interface TenantAgentPromptInput {
  tenant_id: string;
  agent_id: string;
  access_id: string | number;
  section: string;
  content: string;
}

interface TenantAgentPromptUpdateInput {
  section?: string | null;
  content?: string | null;
}

interface TenantAgentPromptFilter extends PaginationInput {
  tenant_id?: string | number;
  agent_id?: string | number;
  section?: string;
}

async function insertTenantAgentPrompt(data: TenantAgentPromptInput) {
  if (!data.tenant_id) {
    throw new Error(`Tenant not found: ${data.tenant_id}`);
  }
  if (!data.agent_id) {
    throw new Error(`Agent not found: ${data.agent_id}`);
  }
  if (!data.access_id) {
    throw new Error(`Tenant agent access not found: ${data.access_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO tenant_agent_prompt (tenant_id, agent_id, access_id, section, content)
     VALUES (?, ?, ?, ?, ?)`,
    [data.tenant_id, data.agent_id, data.access_id, data.section, data.content],
  );

  return result.insertId;
}

async function findTenantAgentPrompts(filter: TenantAgentPromptFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.tenant_id) {
    conditions.push("tap.tenant_id = ?");
    params.push(filter.tenant_id ?? -1);
  }
  if (filter.agent_id) {
    conditions.push("tap.agent_id = ?");
    params.push(filter.agent_id ?? -1);
  }
  if (filter.section) {
    conditions.push("tap.section = ?");
    params.push(filter.section);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${TENANT_AGENT_PROMPT_SELECT} ${where} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findTenantAgentPromptById(tenant_prompt_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${TENANT_AGENT_PROMPT_SELECT} WHERE tap.tenant_prompt_id = ?`,
    [tenant_prompt_id],
  );

  return rows[0] ?? null;
}

async function updateTenantAgentPromptById(
  tenant_prompt_id: string,
  data: TenantAgentPromptUpdateInput,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE tenant_agent_prompt
     SET section = COALESCE(?, section),
         content = COALESCE(?, content)
     WHERE tenant_prompt_id = ?`,
    [data.section ?? null, data.content ?? null, tenant_prompt_id],
  );

  return result.affectedRows > 0;
}

async function deleteTenantAgentPromptById(tenant_prompt_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM tenant_agent_prompt WHERE tenant_prompt_id = ?`,
    [tenant_prompt_id],
  );

  return result.affectedRows > 0;
}

async function updateTenantAgentPromptAccessId(
  tenant_id: string | number,
  agent_id: string | number,
  access_id: string | number | null,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE tenant_agent_prompt
     SET access_id = ?
     WHERE tenant_id = ? AND agent_id = ?`,
    [access_id, tenant_id, agent_id],
  );

  return result.affectedRows > 0;
}

async function findAllTenantsAgentPrompt(tenant_id: string) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT tap.*, a.name, a.agent_id, a.is_active FROM tenant_agent_prompt tap
      LEFT JOIN agent a ON a.agent_id = tap.agent_id
      WHERE tap.tenant_id = ?
    `,
    [tenant_id],
  );

  const prompts = rows;

  return prompts;
}

export {
  insertTenantAgentPrompt,
  findTenantAgentPrompts,
  findTenantAgentPromptById,
  updateTenantAgentPromptById,
  updateTenantAgentPromptAccessId,
  deleteTenantAgentPromptById,
  findAllTenantsAgentPrompt,
};
