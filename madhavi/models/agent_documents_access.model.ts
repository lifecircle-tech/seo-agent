import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

const AGENT_DOCUMENTS_ACCESS_SELECT = `
  SELECT ada.access_id, a.agent_id, d.doc_id, d.doc_name, ada.granted_at
  FROM agent_documents_access ada
  JOIN agent a ON a.agent_id = ada.agent_id
  JOIN agent_document_tools d ON d.doc_id = ada.doc_id
`;

interface AgentDocumentsAccessInput {
  agent_id: string;
  doc_id: string;
}

interface AgentDocumentsAccessFilter extends PaginationInput {
  agent_id?: string;
  doc_id?: string;
}

async function insertAgentDocumentsAccess(data: AgentDocumentsAccessInput) {
  if (!data.agent_id) {
    throw new Error(`Agent not found: ${data.agent_id}`);
  }
  if (!data.doc_id) {
    throw new Error(`Document not found: ${data.doc_id}`);
  }

  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `INSERT INTO agent_documents_access (agent_id, doc_id)
     VALUES (?, ?)`,
    [data.agent_id, data.doc_id],
  );

  return result.insertId;
}

async function findAgentDocumentsAccesses(
  filter: AgentDocumentsAccessFilter = {},
) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.agent_id) {
    conditions.push("ada.agent_id = ?");
    params.push(filter.agent_id ?? -1);
  }
  if (filter.doc_id) {
    conditions.push("ada.doc_id = ?");
    params.push(filter.doc_id ?? -1);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${AGENT_DOCUMENTS_ACCESS_SELECT} ${where} ORDER BY ada.granted_at ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows;
}

async function findAgentDocumentsAccessById(access_id: string | number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `${AGENT_DOCUMENTS_ACCESS_SELECT} WHERE ada.access_id = ?`,
    [access_id],
  );

  return rows[0] ?? null;
}

async function findAgentDocumentsAccessesWithContent(
  agent_id: string | number,
) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT ada.access_id, d.doc_id, d.doc_name, d.description, d.content, d.active
     FROM agent_documents_access ada
     JOIN agent_document_tools d ON d.doc_id = ada.doc_id
     WHERE ada.agent_id = ?`,
    [agent_id],
  );

  return rows;
}

async function deleteAgentDocumentsAccessById(access_id: string) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM agent_documents_access WHERE access_id = ?`,
    [access_id],
  );

  return result.affectedRows > 0;
}

export {
  insertAgentDocumentsAccess,
  findAgentDocumentsAccesses,
  findAgentDocumentsAccessById,
  findAgentDocumentsAccessesWithContent,
  deleteAgentDocumentsAccessById,
};
