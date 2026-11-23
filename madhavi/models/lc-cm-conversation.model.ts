import { ResultSetHeader, RowDataPacket } from "mysql2";
import { madhavi_pool } from "../../db";

interface CmConversation extends RowDataPacket {
  id: number;
  hp_unique_id: number;
  // Timelines chat id, kept from before the move to WhatsApp; not used
  chat_id: string | null;
  // WhatsApp chat id: the caregiver's WhatsApp number (e.g. 919876543210)
  wa_chat_id: string | null;
  last_message_timestamp: Date;
  started_at_timestamp: Date;
}

const CM_CHAT_COLUMNS = `
  hp_unique_id, chat_id, wa_chat_id, last_message_timestamp, started_at_timestamp
`;

// After the agent messages the caregiver: records the chat and bumps
// last_message_timestamp.
async function insertDigitalCMChat({
  cg_id,
  wa_chat_id,
}: {
  cg_id: number;
  wa_chat_id: string;
}) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_cm_conversation (hp_unique_id, wa_chat_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        wa_chat_id = VALUES(wa_chat_id),
        last_message_timestamp = CURRENT_TIMESTAMP;
    `,
    [cg_id, wa_chat_id],
  );

  const cm_chat = result;
  return cm_chat.insertId;
}

// Sets the WhatsApp chat id of an existing conversation, leaving
// last_message_timestamp as it is.
async function setDigitalCMWaChatId({
  cg_id,
  wa_chat_id,
}: {
  cg_id: number;
  wa_chat_id: string;
}) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `
      UPDATE life_digital_cm_conversation
      SET wa_chat_id = ?
      WHERE hp_unique_id = ?;
    `,
    [wa_chat_id, cg_id],
  );

  return result.affectedRows > 0;
}

async function getDigitalCMChatByHpUniqueId(cg_id: number) {
  const [rows] = await madhavi_pool.query<CmConversation[]>(
    `
      SELECT ${CM_CHAT_COLUMNS}
      FROM life_digital_cm_conversation
      WHERE hp_unique_id = ?;
    `,
    [cg_id],
  );

  const cm_chat = rows[0];

  return cm_chat;
}

// Two caregiver profiles can share a phone: the most recent conversation
// wins.
async function getDigitalCMChatByWaChatId(wa_chat_id: string) {
  const [rows] = await madhavi_pool.query<CmConversation[]>(
    `
      SELECT ${CM_CHAT_COLUMNS}
      FROM life_digital_cm_conversation
      WHERE wa_chat_id = ?
      ORDER BY last_message_timestamp DESC
      LIMIT 1;
    `,
    [wa_chat_id],
  );

  const cm_chat = rows[0];

  return cm_chat;
}

// Conversations that have no WhatsApp chat id yet
async function getDigitalCMChatsWithoutWaChatId() {
  const [rows] = await madhavi_pool.query<CmConversation[]>(
    `
      SELECT ${CM_CHAT_COLUMNS}
      FROM life_digital_cm_conversation
      WHERE wa_chat_id IS NULL;
    `,
  );

  return rows;
}

// Chats with no message sent by the agent in the last `hours`. Every agent
// reply bumps last_message_timestamp, so this is the last conversation.
async function getDigitalCMChatsInactiveFor(hours: number) {
  const [rows] = await madhavi_pool.query<CmConversation[]>(
    `
      SELECT ${CM_CHAT_COLUMNS}
      FROM life_digital_cm_conversation
      WHERE wa_chat_id IS NOT NULL
        AND last_message_timestamp < NOW() - INTERVAL ? HOUR
      ORDER BY last_message_timestamp DESC;
    `,
    [hours],
  );

  return rows;
}

export {
  insertDigitalCMChat,
  setDigitalCMWaChatId,
  getDigitalCMChatByHpUniqueId,
  getDigitalCMChatByWaChatId,
  getDigitalCMChatsWithoutWaChatId,
  getDigitalCMChatsInactiveFor,
};
