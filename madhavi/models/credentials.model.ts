import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const CREDENTIALS_SELECT = `
  SELECT c.credential_id, e.employee_id AS employee_id, c.username, c.last_login, c.created_at
  FROM credentials c
  JOIN employee e ON e.employee_id = c.employee_id
`;

interface CredentialsInput {
  employee_id: string;
  username: string;
  password_hash: string;
}

interface CredentialsUpdateInput {
  username?: string | null;
  password_hash?: string | null;
  last_login?: string | null;
}

async function insertCredentials(data: CredentialsInput) {
  if (!data.employee_id) {
    throw new Error(`Employee not found: ${data.employee_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO credentials (employee_id, username, password_hash)
     VALUES (?, ?, ?)`,
    [data.employee_id, data.username, data.password_hash],
  );

  return result.insertId;
}

interface CredentialsFilter extends PaginationInput {
  employee_id?: string;
  username?: string;
}

async function findCredentials(filter: CredentialsFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.employee_id) {
    conditions.push("c.employee_id = ?");
    params.push(filter.employee_id ?? -1);
  }
  if (filter.username) {
    conditions.push("c.username = ?");
    params.push(filter.username);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${CREDENTIALS_SELECT} ${where} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findCredentialById(credential_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${CREDENTIALS_SELECT} WHERE c.credential_id = ?`,
    [credential_id],
  );

  return rows[0] ?? null;
}

async function updateCredentialsById(
  credential_id: string,
  data: CredentialsUpdateInput,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE credentials
     SET username = COALESCE(?, username),
         password_hash = COALESCE(?, password_hash),
         last_login = COALESCE(?, last_login)
     WHERE credential_id = ?`,
    [
      data.username ?? null,
      data.password_hash ?? null,
      data.last_login ?? null,
      credential_id,
    ],
  );

  return result.affectedRows > 0;
}

async function deleteCredentialsById(credential_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM credentials WHERE credential_id = ?`,
    [credential_id],
  );

  return result.affectedRows > 0;
}

export {
  insertCredentials,
  findCredentials,
  findCredentialById,
  updateCredentialsById,
  deleteCredentialsById,
};
