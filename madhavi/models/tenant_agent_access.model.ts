import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";

interface TenantAgentAccessInput {
  tenant_id: string;
  agent_id: string;
  status?: string | null;
}

async function insertTenantAgentAccess(data: TenantAgentAccessInput) {
  if (!data.tenant_id) {
    throw new Error(`Tenant not found: ${data.tenant_id}`);
  }
  if (!data.agent_id) {
    throw new Error(`Agent not found: ${data.agent_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO tenant_agent_access (tenant_id, agent_id, status)
     VALUES (?, ?, COALESCE(?, 'active'))`,
    [data.tenant_id, data.agent_id, data.status ?? null],
  );

  return result.insertId;
}

async function findTenantAgentAccessById(access_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM tenant_agent_access WHERE access_id = ?`,
    [access_id],
  );

  return rows[0] ?? null;
}

async function findTenantAgentAccessByTenantAndAgent(
  tenant_id: string | number,
  agent_id: string | number,
) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM tenant_agent_access WHERE tenant_id = ? AND agent_id = ?`,
    [tenant_id, agent_id],
  );

  return rows[0] ?? null;
}

async function findTenantAgentAccessByAgentKey(
  tenant_id: string | number,
  key: string,
) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT a.agent_id, a.name, a.key, a.description, a.is_active,
            ta.access_id, ta.status AS access_status, ta.granted_at,
            tap.tenant_prompt_id, tap.section, tap.content,
            tap.updated_at AS prompt_updated_at
     FROM agent a
     JOIN tenant_agent_access ta
       ON ta.agent_id = a.agent_id AND ta.tenant_id = ?
     LEFT JOIN tenant_agent_prompt tap
       ON tap.access_id = ta.access_id
     WHERE a.key = ?`,
    [tenant_id, key],
  );

  if (!rows.length) {
    return null;
  }

  const {
    agent_id,
    name,
    description,
    is_active,
    access_id,
    access_status,
    granted_at,
    tenant_prompt_id,
    section,
    content,
    prompt_updated_at,
  } = rows[0];

  return {
    agent_id,
    name,
    key,
    description,
    is_active,
    access: {
      access_id,
      status: access_status,
      granted_at,
    },
    prompts: content
      ? {
          tenant_prompt_id,
          section,
          content,
          updated_at: prompt_updated_at,
        }
      : null,
  };
}

async function deleteTenantAgentAccessById(access_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM tenant_agent_access WHERE access_id = ?`,
    [access_id],
  );

  return result.affectedRows > 0;
}

export {
  insertTenantAgentAccess,
  findTenantAgentAccessById,
  findTenantAgentAccessByTenantAndAgent,
  findTenantAgentAccessByAgentKey,
  deleteTenantAgentAccessById,
};
