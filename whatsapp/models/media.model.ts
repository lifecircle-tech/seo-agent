import { ResultSetHeader, RowDataPacket } from "mysql2";
import { wa_pool } from "../db.js";
import type { MessageDirection } from "../types.js";

export interface WaMedia extends RowDataPacket {
  media_id: string;
  direction: MessageDirection;
  mime_type: string | null;
  filename: string | null;
  sha256: string | null;
  file_size: number | null;
  file_path: string | null;
  status: "pending" | "stored" | "failed";
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

// Keeps an existing row as it is (a webhook retry repeats the media).
async function insertMedia(data: {
  media_id: string;
  direction: MessageDirection;
  mime_type: string | null;
  filename: string | null;
  sha256: string | null;
  file_size?: number | null;
  file_path?: string | null;
  status?: WaMedia["status"];
}) {
  await wa_pool.query<ResultSetHeader>(
    `
      INSERT INTO wa_media
        (media_id, direction, mime_type, filename, sha256, file_size, file_path, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE media_id = media_id;
    `,
    [
      data.media_id,
      data.direction,
      data.mime_type,
      data.filename,
      data.sha256,
      data.file_size ?? null,
      data.file_path ?? null,
      data.status ?? "pending",
    ],
  );
}

async function getMedia(media_id: string) {
  const [rows] = await wa_pool.query<WaMedia[]>(
    `SELECT * FROM wa_media WHERE media_id = ?;`,
    [media_id],
  );

  return rows[0];
}

async function markMediaStored(data: {
  media_id: string;
  mime_type: string | null;
  file_path: string;
  file_size: number;
  sha256: string;
}) {
  await wa_pool.query(
    `
      UPDATE wa_media
      SET status = 'stored', error = NULL,
          mime_type = COALESCE(?, mime_type),
          file_path = ?, file_size = ?, sha256 = ?
      WHERE media_id = ?;
    `,
    [data.mime_type, data.file_path, data.file_size, data.sha256, data.media_id],
  );
}

async function markMediaFailed(media_id: string, error: string) {
  await wa_pool.query(
    `
      UPDATE wa_media
      SET status = 'failed', error = ?
      WHERE media_id = ? AND status <> 'stored';
    `,
    [error.slice(0, 512), media_id],
  );
}

export { insertMedia, getMedia, markMediaStored, markMediaFailed };
