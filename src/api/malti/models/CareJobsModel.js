import { legacyPool } from "./db.js";

export async function getPendingLeads(limit = 10) {
  const startHour = parseInt(process.env.CARE_JOBS_CALL_WINDOW_START ?? "9", 10);
  const endHour   = parseInt(process.env.CARE_JOBS_CALL_WINDOW_END ?? "21", 10);
  const now = new Date();
  const istHour = (now.getUTCHours() + 5.5) % 24 | 0;
  if (istHour < startHour || istHour >= endHour) return [];

  const [rows] = await legacyPool.query(
    `SELECT * FROM n_care_jobs_leads
     WHERE (call_status IS NULL OR call_status = 'pending' OR call_status = 'no_answer')
       AND (attempt_count IS NULL OR attempt_count < 3)
       AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
     ORDER BY created_at ASC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

export async function getLeadById(id) {
  const [rows] = await legacyPool.query("SELECT * FROM n_care_jobs_leads WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export async function updateLeadCallStatus(id, data) {
  const allowed = ["call_status", "attempt_count", "last_attempt_at", "next_attempt_at",
                   "call_duration", "recording_url", "whatsapp_sent", "app_downloaded",
                   "whatsapp_delivery_status", "notes"];
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k)) { cols.push(`\`${k}\` = ?`); vals.push(v); }
  }
  if (!cols.length) return;
  await legacyPool.query(`UPDATE n_care_jobs_leads SET ${cols.join(", ")} WHERE id = ?`, [...vals, id]);
}

export async function getLeadByPhone(phone) {
  const [rows] = await legacyPool.query(
    "SELECT * FROM n_care_jobs_leads WHERE phone = ? ORDER BY created_at DESC LIMIT 1",
    [phone]
  );
  return rows[0] ?? null;
}

export async function getLeadStats() {
  const [rows] = await legacyPool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(call_status = 'connected') AS connected,
      SUM(call_status = 'no_answer') AS no_answer,
      SUM(call_status = 'completed') AS completed,
      SUM(whatsapp_sent = 1) AS whatsapp_sent,
      SUM(app_downloaded = 1) AS app_downloaded
    FROM n_care_jobs_leads
  `);
  return rows[0] ?? {};
}

export async function logBolnaActivity(data) {
  const fields = [
    "agent_type", "agent_name", "bolna_agent_id", "trigger_source",
    "lead_id", "phone_number", "lead_name", "execution_id", "call_type",
    "attempt_number", "status", "duration_seconds", "call_summary",
    "recording_url", "has_error", "error_message", "error_code",
    "cost_cents", "lead_score", "lead_grade", "triggered_at", "completed_at"
  ];
  const cols = [];
  const vals = [];
  for (const f of fields) {
    if (f in data) { cols.push(`\`${f}\``); vals.push(data[f] ?? null); }
  }
  if (!cols.length) throw new Error("No data to log");
  const placeholders = cols.map(() => "?").join(",");
  const [result] = await legacyPool.query(
    `INSERT INTO n_bolna_activity_log (${cols.join(",")}) VALUES (${placeholders})`,
    vals
  );
  return result.insertId;
}

export async function updateBolnaActivity(executionId, data) {
  const allowed = ["status", "duration_seconds", "call_summary", "recording_url",
                   "has_error", "error_message", "cost_cents", "completed_at"];
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k)) { cols.push(`\`${k}\` = ?`); vals.push(v); }
  }
  if (!cols.length) return;
  await legacyPool.query(
    `UPDATE n_bolna_activity_log SET ${cols.join(", ")} WHERE execution_id = ?`,
    [...vals, executionId]
  );
}
