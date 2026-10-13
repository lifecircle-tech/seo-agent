import { ResultSetHeader, RowDataPacket } from "mysql2";
import { madhavi_pool } from "../../db";

export interface SlackConversation extends RowDataPacket {
  id: number;
  hp_unique_id: number;
  chat_id: string | null;
  agent_key: string | null;
  purpose: string;
  channel_id: string;
  thread_ts: string;
  message: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface SlackReply extends RowDataPacket {
  id: number;
  slack_conversation_id: number;
  slack_user_id: string | null;
  slack_user_name: string | null;
  message: string;
  message_ts: string;
  relay_status: "pending" | "relayed" | "internal";
  relayed_at: Date | null;
  created_at: Date;
}

async function insertSlackConversation({
  hp_unique_id,
  chat_id,
  agent_key,
  purpose,
  channel_id,
  thread_ts,
  message,
}: {
  hp_unique_id: number;
  chat_id: string | null;
  agent_key: string | null;
  purpose: string;
  channel_id: string;
  thread_ts: string;
  message: string;
}) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_slack_conversation
        (hp_unique_id, chat_id, agent_key, purpose, channel_id, thread_ts, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        chat_id = COALESCE(VALUES(chat_id), chat_id),
        message = VALUES(message),
        status = 'open';
    `,
    [hp_unique_id, chat_id, agent_key, purpose, channel_id, thread_ts, message],
  );

  return result.insertId;
}

// Threads in report/suggestion channels are about one user. Agent-channel
// threads can be about several, and are handled by the channel's agent.
async function getSlackConversationByThread(
  channel_id: string,
  thread_ts: string,
) {
  const [rows] = await madhavi_pool.query<SlackConversation[]>(
    `
      SELECT * FROM life_digital_slack_conversation
      WHERE channel_id = ? AND thread_ts = ?;
    `,
    [channel_id, thread_ts],
  );

  return rows[0];
}

async function getSlackConversationById(id: number) {
  const [rows] = await madhavi_pool.query<SlackConversation[]>(
    `SELECT * FROM life_digital_slack_conversation WHERE id = ?;`,
    [id],
  );

  return rows[0];
}

async function getSlackConversationsByHpUniqueId(
  hp_unique_id: number,
  limit: number,
) {
  const [rows] = await madhavi_pool.query<SlackConversation[]>(
    `
      SELECT * FROM life_digital_slack_conversation
      WHERE hp_unique_id = ?
      ORDER BY created_at DESC
      LIMIT ?;
    `,
    [hp_unique_id, limit],
  );

  return rows;
}

// Returns true only when the reply is new, so redelivered Slack events
// do not trigger a second agent run.
async function insertSlackReply({
  slack_conversation_id,
  slack_user_id,
  slack_user_name,
  message,
  message_ts,
  relay_status,
}: {
  slack_conversation_id: number;
  slack_user_id: string | null;
  slack_user_name: string | null;
  message: string;
  message_ts: string;
  relay_status: SlackReply["relay_status"];
}) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT IGNORE INTO life_digital_slack_reply
        (slack_conversation_id, slack_user_id, slack_user_name, message, message_ts, relay_status)
      VALUES (?, ?, ?, ?, ?, ?);
    `,
    [
      slack_conversation_id,
      slack_user_id,
      slack_user_name,
      message,
      message_ts,
      relay_status,
    ],
  );

  return result.affectedRows > 0;
}

async function getSlackRepliesByConversationIds(ids: number[]) {
  if (ids.length === 0) return [];

  const [rows] = await madhavi_pool.query<SlackReply[]>(
    `
      SELECT * FROM life_digital_slack_reply
      WHERE slack_conversation_id IN (?)
      ORDER BY created_at ASC;
    `,
    [ids],
  );

  return rows;
}

async function updateSlackRepliesRelayed(ids: number[]) {
  if (ids.length === 0) return;

  await madhavi_pool.query<ResultSetHeader>(
    `
      UPDATE life_digital_slack_reply
      SET relay_status = 'relayed', relayed_at = CURRENT_TIMESTAMP
      WHERE id IN (?) AND relay_status = 'pending';
    `,
    [ids],
  );
}

export {
  insertSlackConversation,
  getSlackConversationByThread,
  getSlackConversationById,
  getSlackConversationsByHpUniqueId,
  insertSlackReply,
  getSlackRepliesByConversationIds,
  updateSlackRepliesRelayed,
};
