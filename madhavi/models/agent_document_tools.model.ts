import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

interface AgentDocumentToolInput {
  doc_name: string;
  description?: string | null;
  content?: string | null;
  active?: boolean | null;
}

interface AgentDocumentToolFilter extends PaginationInput {
  doc_name?: string;
  active?: boolean;
}

interface AgentDocumentToolUpdateInput {
  doc_name?: string | null;
  description?: string | null;
  content?: string | null;
}

async function insertAgentDocumentTool(data: AgentDocumentToolInput) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO agent_document_tools (doc_name, description, content, active)
     VALUES (?, ?, ?, COALESCE(?, FALSE))`,
    [data.doc_name, data.description ?? null, data.content ?? null, data.active ?? null],
  );

  return result.insertId;
}

async function findAgentDocumentTools(filter: AgentDocumentToolFilter = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.doc_name) {
    conditions.push("doc_name LIKE ?");
    params.push(`%${filter.doc_name}%`);
  }
  if (filter.active !== undefined) {
    conditions.push("active = ?");
    params.push(filter.active);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM agent_document_tools ${where} ORDER BY doc_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findAgentDocumentToolById(doc_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT * FROM agent_document_tools WHERE doc_id = ?`,
    [doc_id],
  );

  return rows[0] ?? null;
}

async function updateAgentDocumentToolById(
  doc_id: string,
  data: AgentDocumentToolUpdateInput,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE agent_document_tools
     SET doc_name = COALESCE(?, doc_name),
         description = COALESCE(?, description),
         content = COALESCE(?, content)
     WHERE doc_id = ?`,
    [data.doc_name ?? null, data.description ?? null, data.content ?? null, doc_id],
  );

  return result.affectedRows > 0;
}

async function updateAgentDocumentToolActiveById(
  doc_id: string,
  active: boolean,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `UPDATE agent_document_tools SET active = ? WHERE doc_id = ?`,
    [active, doc_id],
  );

  return result.affectedRows > 0;
}

async function deleteAgentDocumentToolById(doc_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM agent_document_tools WHERE doc_id = ?`,
    [doc_id],
  );

  return result.affectedRows > 0;
}

export {
  insertAgentDocumentTool,
  findAgentDocumentTools,
  findAgentDocumentToolById,
  updateAgentDocumentToolById,
  updateAgentDocumentToolActiveById,
  deleteAgentDocumentToolById,
};
