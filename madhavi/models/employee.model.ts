import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const EMPLOYEE_SELECT = `
  SELECT e.employee_id, t.tenant_id AS tenant_id, e.name, e.email, e.phone
  FROM employee e
  JOIN tenant t ON t.tenant_id = e.tenant_id
`;

interface EmployeeInput {
  tenant_id: string;
  name: string;
  email: string;
  phone: string;
}

interface EmployeeUpdateInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

async function insertEmployee(data: EmployeeInput) {
  if (!data.tenant_id) {
    throw new Error(`Tenant not found: ${data.tenant_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO employee (tenant_id, name, email, phone)
     VALUES (?, ?, ?, ?)`,
    [data.tenant_id, data.name, data.email, data.phone],
  );

  return result.insertId;
}

interface EmployeeFilter extends PaginationInput {
  tenant_id?: string;
  name?: string;
  email?: string;
}

async function findEmployees(filter: EmployeeFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.tenant_id) {
    conditions.push("e.tenant_id = ?");
    params.push(filter.tenant_id ?? -1);
  }
  if (filter.name) {
    conditions.push("e.name LIKE ?");
    params.push(`%${filter.name}%`);
  }
  if (filter.email) {
    conditions.push("e.email = ?");
    params.push(filter.email);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${EMPLOYEE_SELECT} ${where} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findEmployeeById(employee_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${EMPLOYEE_SELECT} WHERE e.employee_id = ?`,
    [employee_id],
  );

  return rows[0] ?? null;
}

async function updateEmployeeById(
  employee_id: string,
  data: EmployeeUpdateInput,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE employee
     SET name = COALESCE(?, name),
         email = COALESCE(?, email),
         phone = COALESCE(?, phone)
     WHERE employee_id = ?`,
    [data.name ?? null, data.email ?? null, data.phone ?? null, employee_id],
  );

  return result.affectedRows > 0;
}

async function deleteEmployeeById(employee_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM employee WHERE employee_id = ?`,
    [employee_id],
  );

  return result.affectedRows > 0;
}

export {
  insertEmployee,
  findEmployees,
  findEmployeeById,
  updateEmployeeById,
  deleteEmployeeById,
};
