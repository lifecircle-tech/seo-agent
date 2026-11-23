import { RowDataPacket } from "mysql2";
import { wa_pool } from "../db.js";

export interface WaChat extends RowDataPacket {
  chat_id: string;
  phone: string;
  profile_name: string | null;
  phone_number_id: string;
  last_inbound_at: Date | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Webhooks can arrive out of order: keep the later of the stored and the
// new time. A NULL new time leaves the stored one.
function laterOf(column: string) {
  return `${column} = CASE
    WHEN VALUES(${column}) IS NULL THEN ${column}
    WHEN ${column} IS NULL THEN VALUES(${column})
    ELSE GREATEST(${column}, VALUES(${column}))
  END`;
}

async function upsertChat({
  chat_id,
  phone_number_id,
  profile_name = null,
  last_inbound_at = null,
  last_message_at,
}: {
  chat_id: string;
  phone_number_id: string;
  profile_name?: string | null;
  last_inbound_at?: Date | null;
  last_message_at: Date;
}) {
  await wa_pool.query(
    `
      INSERT INTO wa_chats
        (chat_id, phone, profile_name, phone_number_id, last_inbound_at, last_message_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        profile_name = COALESCE(VALUES(profile_name), profile_name),
        ${laterOf("last_inbound_at")},
        ${laterOf("last_message_at")};
    `,
    [
      chat_id,
      `+${chat_id}`,
      profile_name,
      phone_number_id,
      last_inbound_at,
      last_message_at,
    ],
  );
}

async function getChat(chat_id: string) {
  const [rows] = await wa_pool.query<WaChat[]>(
    `SELECT * FROM wa_chats WHERE chat_id = ?;`,
    [chat_id],
  );

  return rows[0];
}

// Most recently active first
async function listChats(limit: number, offset: number) {
  const [rows] = await wa_pool.query<WaChat[]>(
    `
      SELECT * FROM wa_chats
      ORDER BY last_message_at DESC
      LIMIT ? OFFSET ?;
    `,
    [limit, offset],
  );

  return rows;
}

export { upsertChat, getChat, listChats };
