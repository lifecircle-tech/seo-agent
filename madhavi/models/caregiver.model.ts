import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const CAREGIVER_SELECT = `
  SELECT c.caregiver_id, t.tenant_id, e.employee_id AS supervisor_id,
         c.name, c.email, c.phone, c.dob, c.gender, c.languages,
         c.start_date, c.end_date, c.status, c.created_at
  FROM caregiver c
  JOIN tenant t ON t.tenant_id = c.tenant_id
  JOIN employee e ON e.employee_id = c.supervisor_id
`;

interface CaregiverInput {
  tenant_id: string;
  supervisor_id: string;
  name: string;
  email: string;
  phone: string;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
}

interface CaregiverUpdateInput {
  supervisor_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
}

interface CaregiverFilter extends PaginationInput {
  tenant_id?: string | number;
  supervisor_id?: string;
  status?: string;
}

async function insertCaregiver(data: CaregiverInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO caregiver
       (tenant_id, supervisor_id, name, email, phone, start_date, end_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'active'))`,
    [
      data.tenant_id,
      data.supervisor_id,
      data.name,
      data.email,
      data.phone,
      data.start_date ?? null,
      data.end_date ?? null,
      data.status ?? null,
    ],
  );

  return result.insertId;
}

async function findCaregivers(filter: CaregiverFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.tenant_id) {
    conditions.push("c.tenant_id = ?");
    params.push(filter.tenant_id ?? -1);
  }
  if (filter.supervisor_id) {
    conditions.push("c.supervisor_id = ?");
    params.push(filter.supervisor_id ?? -1);
  }
  if (filter.status) {
    conditions.push("c.status = ?");
    params.push(filter.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${CAREGIVER_SELECT} ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findCaregiverById(caregiver_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${CAREGIVER_SELECT} WHERE c.caregiver_id = ?`,
    [caregiver_id],
  );

  return rows[0] ?? null;
}

async function findCaregiversTenant(caregiver_id: number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    ` SELECT t.* FROM caregiver c LEFT JOIN tenant t on t.tenant_id = c.tenant_id
      WHERE c.caregiver_id = ?
    `,
    [caregiver_id],
  );

  return rows[0] ?? null;
}

async function updateCaregiverById(
  caregiver_id: string,
  data: CaregiverUpdateInput,
) {
  if (data.supervisor_id) {
    throw new Error(`Supervisor (employee) not found: ${data.supervisor_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE caregiver
     SET supervisor_id = COALESCE(?, supervisor_id),
         name = COALESCE(?, name),
         email = COALESCE(?, email),
         phone = COALESCE(?, phone),
         start_date = COALESCE(?, start_date),
         end_date = COALESCE(?, end_date),
         status = COALESCE(?, status)
     WHERE caregiver_id = ?`,
    [
      data.supervisor_id,
      data.name ?? null,
      data.email ?? null,
      data.phone ?? null,
      data.start_date ?? null,
      data.end_date ?? null,
      data.status ?? null,
      caregiver_id,
    ],
  );

  return result.affectedRows > 0;
}

async function deleteCaregiverById(caregiver_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM caregiver WHERE caregiver_id = ?`,
    [caregiver_id],
  );

  return result.affectedRows > 0;
}

export {
  insertCaregiver,
  findCaregivers,
  findCaregiverById,
  findCaregiversTenant,
  updateCaregiverById,
  deleteCaregiverById,
};
