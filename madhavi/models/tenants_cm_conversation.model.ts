import { RowDataPacket, ResultSetHeader } from "mysql2";
import { madhavi_pool } from "../../db";
import { normalizePagination, type PaginationInput } from "../utils/common.js";

interface TenantsCmConversation extends RowDataPacket {
  id: number;
  caregiver_id: number;
  chat_id: string | null;
  last_message_timestamp: Date;
  started_at_timestamp: Date;
}

interface TenantsCmConversationFilter extends PaginationInput {
  caregiver_id?: string;
}

async function upsertTenantsCmConversation({
  caregiver_id,
  chat_id,
}: {
  caregiver_id: number;
  chat_id: string;
}) {
  await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT INTO tenants_cm_conversation (caregiver_id, chat_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        chat_id = VALUES(chat_id),
        last_message_timestamp = CURRENT_TIMESTAMP;
    `,
    [caregiver_id, chat_id],
  );

  return findTenantsCmConversationByCaregiverId(caregiver_id);
}

async function findTenantsCmConversations(
  filter: TenantsCmConversationFilter = {},
) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.caregiver_id) {
    conditions.push("caregiver_id = ?");
    params.push(filter.caregiver_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { limit, offset } = normalizePagination(filter);

  const [rows] = await madhavi_pool.query<TenantsCmConversation[]>(
    `
      SELECT id, caregiver_id, chat_id, last_message_timestamp, started_at_timestamp
      FROM tenants_cm_conversation
      ${where}
      ORDER BY last_message_timestamp DESC
      LIMIT ? OFFSET ?;
    `,
    [...params, limit, offset],
  );

  return rows;
}

async function findTenantsCmConversationByCaregiverId(caregiver_id: number) {
  const [rows] = await madhavi_pool.query<TenantsCmConversation[]>(
    `
      SELECT caregiver_id, chat_id, last_message_timestamp
      FROM tenants_cm_conversation
      WHERE caregiver_id = ?;
    `,
    [caregiver_id],
  );

  return rows[0] ?? null;
}

async function findTenantsCmConversationByChatId(chat_id: string) {
  const [rows] = await madhavi_pool.query<TenantsCmConversation[]>(
    `
      SELECT id, caregiver_id, chat_id, last_message_timestamp, started_at_timestamp
      FROM tenants_cm_conversation
      WHERE chat_id = ?;
    `,
    [chat_id],
  );

  return rows[0] ?? null;
}

async function deleteTenantsCmConversationByCaregiverId(
  caregiver_id: number,
) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM tenants_cm_conversation WHERE caregiver_id = ?`,
    [caregiver_id],
  );

  return result.affectedRows > 0;
}

export {
  upsertTenantsCmConversation,
  findTenantsCmConversations,
  findTenantsCmConversationByCaregiverId,
  findTenantsCmConversationByChatId,
  deleteTenantsCmConversationByCaregiverId,
};
