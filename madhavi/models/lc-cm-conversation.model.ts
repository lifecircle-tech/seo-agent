import { ResultSetHeader, RowDataPacket } from "mysql2";
import { madhavi_pool } from "../../db";

interface CmConversation extends RowDataPacket {
  id: number;
  hp_unique_id: number;
  chat_id: string | null;
  last_message_timestamp: Date;
  started_at_timestamp: Date;
}

async function insertDigitalCMChat({
  cg_id,
  chat_id,
}: {
  cg_id: number;
  chat_id: string;
}) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_cm_conversation (hp_unique_id, chat_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        chat_id = VALUES(chat_id),
        last_message_timestamp = CURRENT_TIMESTAMP;
    `,
    [cg_id, chat_id],
  );

  const cm_chat = result;
  return cm_chat.insertId;
}

async function getDigitalCMChatByHpUniqueId(cg_id: number) {
  const [rows] = await madhavi_pool.query<CmConversation[]>(
    `
      SELECT hp_unique_id, chat_id, last_message_timestamp
      FROM life_digital_cm_conversation
      WHERE hp_unique_id = ?;
    `,
    [cg_id],
  );

  const cm_chat = rows[0];

  return cm_chat;
}

async function getDigitalCMChatByChatId(chat_id: string) {
  const [rows] = await madhavi_pool.query<CmConversation[]>(
    `
    SELECT hp_unique_id, chat_id, last_message_timestamp
    FROM life_digital_cm_conversation
    WHERE chat_id = ?;
    `,
    [chat_id],
  );

  const cm_chat = rows[0];

  return cm_chat;
}

export {
  insertDigitalCMChat,
  getDigitalCMChatByHpUniqueId,
  getDigitalCMChatByChatId,
};
