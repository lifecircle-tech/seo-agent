import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

interface TenantInput {
  company_name: string;
  slug: string;
  industry?: string | null;
  address?: string | null;
  contact_email?: string | null;
}

interface TenantUpdateInput {
  company_name?: string | null;
  industry?: string | null;
  address?: string | null;
  contact_email?: string | null;
}

async function insertTenant(data: TenantInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO tenant (slug, company_name, industry, address, contact_email)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.slug,
      data.company_name,
      data.industry ?? null,
      data.address ?? null,
      data.contact_email ?? null,
    ],
  );

  return result.insertId;
}

async function findTenantBySlug(slug: string) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM tenant WHERE slug = ?`,
    [slug],
  );

  return rows[0] ?? null;
}

interface TenantFilter extends PaginationInput {
  company_name?: string;
  industry?: string;
  contact_email?: string;
}

async function findTenants(filter: TenantFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.company_name) {
    conditions.push("company_name LIKE ?");
    params.push(`%${filter.company_name}%`);
  }
  // if (filter.industry) {
  //   conditions.push("industry = ?");
  //   params.push(filter.industry);
  // }
  if (filter.contact_email) {
    conditions.push("contact_email LIKE ?");
    params.push(`%${filter.contact_email}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" OR ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM tenant ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findTenantById(tenant_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM tenant WHERE tenant_id = ?`,
    [tenant_id],
  );

  return rows[0] ?? null;
}

async function findTenantsAgents(tenant_id: string) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT a.*, ta.prompt_count, tat.tool_count from agent a
     LEFT JOIN (
        SELECT COUNT(*) as prompt_count, tap.agent_id, tap.tenant_id FROM tenant_agent_prompt tap
        WHERE tap.tenant_id = ? GROUP BY (tap.agent_id)
     ) as ta on ta.agent_id = a.agent_id
     LEFT JOIN (
        SELECT COUNT(*) as tool_count, tata.agent_id from tenant_agent_tool_access tata
        WHERE tata.tenant_id = ? AND status = 'active' GROUP BY (tata.agent_id)
     ) as tat on tat.agent_id = a.agent_id;
    `,
    [tenant_id, tenant_id],
  );

  return rows ?? null;
}

async function updateTenantById(slug: string, data: TenantUpdateInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE tenant
     SET company_name = COALESCE(?, company_name),
         industry = COALESCE(?, industry),
         address = COALESCE(?, address),
         contact_email = COALESCE(?, contact_email)
     WHERE slug = ?`,
    [
      data.company_name ?? null,
      data.industry ?? null,
      data.address ?? null,
      data.contact_email ?? null,
      slug,
    ],
  );

  console.log("UPDATED TENANT ", result);

  return result.affectedRows > 0;
}

async function deleteTenantById(tenant_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM tenant WHERE tenant_id = ?`,
    [tenant_id],
  );

  return result.affectedRows > 0;
}

export {
  insertTenant,
  findTenants,
  findTenantById,
  findTenantsAgents,
  findTenantBySlug,
  updateTenantById,
  deleteTenantById,
};
