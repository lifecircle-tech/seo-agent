import { ResultSetHeader, RowDataPacket } from "mysql2";
import { madhavi_pool } from "../../db";

export interface MessagingOptOut extends RowDataPacket {
  id: number;
  phone_key: string;
  phone: string;
  hp_unique_id: number | null;
  chat_id: string | null;
  status: "opted_out" | "opted_in";
  source: string;
  user_message: string | null;
  reason: string | null;
  opted_out_at: Date;
  opted_in_at: Date | null;
}

// Phones arrive as "+91XXXXXXXXXX", "91XXXXXXXXXX" or "XXXXXXXXXX"
// depending on the source; the last 10 digits identify the number, as in
// isCaregiverPhoneNumber.
function getPhoneKey(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

async function getOptOutByPhoneKey(phone_key: string) {
  const [rows] = await madhavi_pool.query<MessagingOptOut[]>(
    `SELECT * FROM life_digital_messaging_opt_out WHERE phone_key = ?;`,
    [phone_key],
  );

  return rows[0];
}

// Throws on a database error, so callers fail closed (no message sent).
async function isPhoneOptedOut(phone: string) {
  const opt_out = await getOptOutByPhoneKey(getPhoneKey(phone));

  return opt_out?.status === "opted_out";
}

// Opting out again after an opt-in reopens the same row.
async function upsertOptOut({
  phone_key,
  phone,
  hp_unique_id,
  chat_id,
  source,
  user_message,
  reason,
}: {
  phone_key: string;
  phone: string;
  hp_unique_id: number | null;
  chat_id: string | null;
  source: string;
  user_message: string | null;
  reason: string | null;
}) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_messaging_opt_out
        (phone_key, phone, hp_unique_id, chat_id, source, user_message, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        phone = VALUES(phone),
        hp_unique_id = COALESCE(VALUES(hp_unique_id), hp_unique_id),
        chat_id = COALESCE(VALUES(chat_id), chat_id),
        status = 'opted_out',
        source = VALUES(source),
        user_message = VALUES(user_message),
        reason = VALUES(reason),
        opted_out_at = CURRENT_TIMESTAMP,
        opted_in_at = NULL;
    `,
    [phone_key, phone, hp_unique_id, chat_id, source, user_message, reason],
  );

  return result.affectedRows > 0;
}

async function updateOptIn(phone_key: string) {
  await madhavi_pool.query<ResultSetHeader>(
    `
      UPDATE life_digital_messaging_opt_out
      SET status = 'opted_in', opted_in_at = CURRENT_TIMESTAMP
      WHERE phone_key = ? AND status = 'opted_out';
    `,
    [phone_key],
  );
}

export {
  getPhoneKey,
  getOptOutByPhoneKey,
  isPhoneOptedOut,
  upsertOptOut,
  updateOptIn,
};
