import { ResultSetHeader, RowDataPacket } from "mysql2";
import { wa_pool } from "../db.js";
import type { MessageDirection, MessageStatus } from "../types.js";

// A message joined with its media, if any
export interface WaMessage extends RowDataPacket {
  id: number;
  wamid: string | null;
  chat_id: string;
  direction: MessageDirection;
  type: string;
  text: string | null;
  media_id: string | null;
  context_wamid: string | null;
  status: MessageStatus;
  error_code: number | null;
  error_message: string | null;
  payload: unknown;
  message_at: Date;
  status_at: Date | null;
  created_at: Date;
  media_mime_type: string | null;
  media_filename: string | null;
  media_file_size: number | null;
  media_status: "pending" | "stored" | "failed" | null;
}

const SELECT_MESSAGE = `
  SELECT m.*,
    md.mime_type AS media_mime_type,
    md.filename  AS media_filename,
    md.file_size AS media_file_size,
    md.status    AS media_status
  FROM wa_messages m
  LEFT JOIN wa_media md ON md.media_id = m.media_id
`;

// Returns the new row id, or null when a message with this wamid is
// already stored (WhatsApp retries webhooks until it gets a 200).
async function insertMessage(data: {
  wamid: string | null;
  chat_id: string;
  direction: MessageDirection;
  type: string;
  text: string | null;
  media_id: string | null;
  context_wamid: string | null;
  status: MessageStatus;
  error_code?: number | null;
  error_message?: string | null;
  payload: unknown;
  message_at: Date;
}) {
  try {
    const [result] = await wa_pool.query<ResultSetHeader>(
      `
        INSERT INTO wa_messages
          (wamid, chat_id, direction, type, text, media_id, context_wamid,
           status, error_code, error_message, payload, message_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      [
        data.wamid,
        data.chat_id,
        data.direction,
        data.type,
        data.text,
        data.media_id,
        data.context_wamid,
        data.status,
        data.error_code ?? null,
        data.error_message?.slice(0, 512) ?? null,
        JSON.stringify(data.payload ?? null),
        data.message_at,
      ],
    );

    return result.insertId;
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") return null;
    throw err;
  }
}

// Statuses only move forward (accepted → sent → delivered → read), since
// WhatsApp may report them out of order. 'failed' is final.
async function updateMessageStatus({
  wamid,
  status,
  status_at,
  error_code,
  error_message,
}: {
  wamid: string;
  status: string;
  status_at: Date;
  error_code: number | null;
  error_message: string | null;
}) {
  const [result] = await wa_pool.query<ResultSetHeader>(
    `
      UPDATE wa_messages
      SET status = ?,
          status_at = ?,
          error_code = COALESCE(?, error_code),
          error_message = COALESCE(?, error_message)
      WHERE wamid = ?
        AND direction = 'outbound'
        AND status <> 'failed'
        AND (? = 'failed'
          OR FIELD(status, 'accepted', 'sent', 'delivered', 'read')
           < FIELD(?, 'accepted', 'sent', 'delivered', 'read'));
    `,
    [
      status,
      status_at,
      error_code,
      error_message?.slice(0, 512) ?? null,
      wamid,
      status,
      status,
    ],
  );

  return result.affectedRows > 0;
}

async function getMessageById(id: number) {
  const [rows] = await wa_pool.query<WaMessage[]>(
    `${SELECT_MESSAGE} WHERE m.id = ?;`,
    [id],
  );

  return rows[0];
}

// Newest first. `before` is the (message_at, id) of the last message of
// the previous page.
async function getChatMessages(
  chat_id: string,
  limit: number,
  before?: { message_at: Date; id: number },
) {
  const [rows] = await wa_pool.query<WaMessage[]>(
    `
      ${SELECT_MESSAGE}
      WHERE m.chat_id = ?
        ${before ? "AND (m.message_at < ? OR (m.message_at = ? AND m.id < ?))" : ""}
      ORDER BY m.message_at DESC, m.id DESC
      LIMIT ?;
    `,
    before
      ? [chat_id, before.message_at, before.message_at, before.id, limit]
      : [chat_id, limit],
  );

  return rows;
}

export { insertMessage, updateMessageStatus, getMessageById, getChatMessages };
