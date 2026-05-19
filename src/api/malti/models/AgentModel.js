import { pool } from "./db.js";
import { randomUUID } from "node:crypto";

function parseJSON(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function ensureAgentTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS malti_db_write_requests (
    id              VARCHAR(50)  NOT NULL PRIMARY KEY,
    agent_key       VARCHAR(50)  NOT NULL,
    operation       VARCHAR(10)  NOT NULL,
    target_table    VARCHAR(100) NOT NULL,
    data_json       JSON         NOT NULL,
    where_clause    VARCHAR(500) NULL,
    sql_preview     TEXT         NOT NULL,
    reason          TEXT         NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    proposed_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    actioned_at     DATETIME(3)  NULL,
    actioned_by     VARCHAR(100) NULL,
    result_json     JSON         NULL,
    INDEX idx_status (status),
    INDEX idx_agent (agent_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_agent_run_history (
    id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
    agent_key       VARCHAR(50)   NOT NULL,
    status          VARCHAR(20)   NOT NULL,
    duration_s      FLOAT         NOT NULL DEFAULT 0,
    msg_count       INT           NOT NULL DEFAULT 0,
    channel         VARCHAR(50)   NULL,
    error           TEXT          NULL,
    created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_agent_key (agent_key),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_agent_training (
    agent_key       VARCHAR(50)   NOT NULL PRIMARY KEY,
    training_json   LONGTEXT      NOT NULL,
    updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_agent_schedules (
    agent_key       VARCHAR(50)  NOT NULL PRIMARY KEY,
    enabled         TINYINT(1)   NOT NULL DEFAULT 0,
    times           JSON         NOT NULL,
    days            JSON         NOT NULL,
    target_channel  VARCHAR(100) NOT NULL DEFAULT 'tech_testing',
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_custom_agents (
    agent_key       VARCHAR(50)  NOT NULL PRIMARY KEY,
    config_json     LONGTEXT     NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_agent_personalities (
    agent_key        VARCHAR(50)  NOT NULL PRIMARY KEY,
    personality_json LONGTEXT     NOT NULL,
    updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_cron_locks (
    agent_key       VARCHAR(50)  NOT NULL PRIMARY KEY,
    lock_window     VARCHAR(30)  NOT NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_channel_overrides (
    agent_key       VARCHAR(50)  NOT NULL PRIMARY KEY,
    channel_key     VARCHAR(100) NOT NULL,
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_agent_cursors (
    cursor_key      VARCHAR(100) NOT NULL PRIMARY KEY,
    cursor_data     JSON         NOT NULL,
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS malti_slack_channels (
    channel_id   VARCHAR(30)  NOT NULL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    is_private   TINYINT(1)   NOT NULL DEFAULT 0,
    updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) AS cnt FROM malti_slack_channels");
  if (Number(cnt) === 0) {
    const SEED = [
      ["C025MS8E2",   "general",                                  0],
      ["C025MS8E6",   "random",                                   0],
      ["C08B80RRSNR", "tech-testing",                             0],
      ["C0AST76N6AX", "seo-agent",                                1],
      ["C0ARE3RNAQ1", "tech-tasks",                               1],
      ["C06SXSXCSPL", "tech-team",                                1],
      ["CELR4HEAW",   "tech-support",                             1],
      ["C091EJNDUHL", "tech-support-carevidya-academy",           1],
      ["C080NQYQWF5", "firebase_alerts",                          1],
      ["C0AEY6F0SBH", "care-tube-alerts",                         1],
      ["C0AEFJ0VDRN", "cva-alerts",                               1],
      ["C0ADK5W8RV4", "audit-alerts",                             1],
      ["C0A3S9AJ8GL", "leads-alerts",                             1],
      ["C0A0V9K4361", "care-jobs-web-alerts",                     1],
      ["C08BBCKCYGZ", "crisp-chats",                              1],
      ["C09V94LD43Y", "care-bridge",                              1],
      ["C0A1CJ01J8L", "caretube-core-team",                       1],
      ["C07CJ0DQE0L", "care-tube-academy",                        1],
      ["C0AFSH4S7TK", "care-tube-course",                         1],
      ["C07PQHMQ4JH", "caretube-contact-us-details",              1],
      ["C025AM4JPPT", "care-mgrs-team",                           1],
      ["C0ALDSELQHW", "care_mgr_karthik_hyd",                     1],
      ["C0AM5S171GB", "care_mgr_blossom-vijayawada",              1],
      ["C08TMJVCE8G", "care_mgr_tanmayee-mumbai",                 1],
      ["C0AENP90BGR", "care_mgr_jagadeesha_mysore",               1],
      ["C06158DTABF", "care_mgr_anand-pune",                      1],
      ["GELN2CPS8",   "care_mgr_jitendra_ncr",                    1],
      ["C076GHSDR5F", "care_mgr_shankar-hyd",                     1],
      ["C087T2FK48H", "care-mgr-bharathi-blore",                  1],
      ["C08024GE5HP", "care-mgr-raviteja-hyd",                    1],
      ["C02QFEY6JV6", "care-mgr-salome-chennai",                  1],
      ["C0AG1J910GM", "care-mgr-santhoshi-vizag",                 1],
      ["CEMSMMJCF",   "care-mgr-vijay-hyd",                       1],
      ["C071280KT5L", "orientation-schedule",                     1],
      ["C0A4FJMQDQT", "hyd-office-team",                          1],
      ["C0A3S3JRGUE", "office-lunch-cpr",                         1],
      ["GGUD5G2GL",   "office_team-south-west",                   1],
      ["C0A6Q9F8D1A", "gift-collection",                          1],
      ["C09SMPNDBNJ", "admin-help-info",                          1],
      ["C01TN41B69F", "process-support",                          1],
      ["C092BEQ9T7C", "90-days-project",                          1],
      ["C08SWAUP3BL", "pvlf",                                     1],
      ["C0950FB18BW", "cm-whatsapp",                              1],
      ["C08AP9BJJCV", "welcome-exit-calls",                       1],
      ["C09Q5FFS3EK", "pcp-review-feedback",                      1],
      ["C07FCMT7H3L", "provisional-receipts",                     1],
      ["C07JUM900JV", "account-deletion-request",                 1],
      ["C07HTV4RWRM", "referral-cg-and-client",                   1],
      ["C07J0AU7LNL", "aditional-services-lead",                  1],
      ["C07KRECA2VA", "unrecorded-attendance-details",            1],
      ["C0899015V0T", "hostel-occupancy",                         1],
      ["C06BYRGS99S", "leads-others",                             1],
      ["C04JM4UQAQJ", "leads_secunderabad",                       1],
      ["GF0UMPNBD",   "leads_hyderabad-target-75-placements",     1],
      ["GHM8BTVJL",   "leads-bangalore-target-15-placements-pm",  1],
      ["C077UQ4T3KR", "leads-chennai-target-10-placements",       1],
      ["C08TR2PQS1F", "leads-mumbai-15-placements",               1],
      ["C0AGFQ223LG", "leads-mysuru-target-10-placements",        1],
      ["C0AFV8YCY7L", "leads-vijaywada-target-10-placements",     1],
      ["C0AG0DXSL9X", "leads-vizag-taregt-10-placements",         1],
      ["C06BPNS5L4E", "job_applications-web",                     1],
      ["G01366Q38AH", "hp_new_placement-ncr",                     1],
      ["G01CNDLESM6", "hp_new-placement-south",                   1],
      ["C04SX05F4P2", "hp_replacement-south",                     1],
      ["GNLAXPM4N",   "hp_search-registration-south",             1],
      ["G01JTJ2QD9R", "hp_search_registration-ncr",               1],
      ["C05FQE0V7T7", "service_cancellations-ncr",                1],
      ["C04SKV0BH7B", "service_cancellations-south",              1],
      ["C08E42C745B", "cg-registration-status-india",             1],
      ["C08E6NVTWFM", "cg-registration-leave-retention-southwest",1],
      ["G01KN40916V", "care_quality-alerts",                      1],
      ["G018X56DB9U", "cash_flow_south",                          1],
      ["G016G1A0BMK", "cash_flow-ncr",                            1],
      ["C083Z30H63U", "hyd-secbad-benchlist",                     1],
      ["C084N5WP8KA", "bangalore-bench-list",                     1],
      ["C09F4BCR89F", "delhi-ncr-bench-list",                     1],
      ["C09H94XT142", "mumbai-bench-list",                        1],
      ["C09H4EDJVEF", "chennai-bench-llist",                      1],
      ["C09H4EH8MU3", "pune-bench-list",                          1],
      ["C09EANQ3X55", "planned-leave-ncr",                        1],
      ["C08EK5T41TK", "planned-leaves-south-west",                1],
    ];
    await pool.query(
      "INSERT IGNORE INTO malti_slack_channels (channel_id, name, is_private) VALUES ?",
      [SEED]
    );
  }
}

// ── DB Write Requests ──────────────────────────────────────────────────────
const BLOCKED_OPS = ["DELETE", "DROP", "ALTER", "TRUNCATE"];
const BLOCKED_TABLES = ["n_users", "auth_tokens", "payments", "billing", "admin_settings"];

export function validateDBWrite(operation, table) {
  if (BLOCKED_OPS.includes(operation.toUpperCase())) return { ok: false, reason: `Operation ${operation} is blocked` };
  if (BLOCKED_TABLES.some(t => table.toLowerCase().includes(t))) return { ok: false, reason: `Table ${table} is protected` };
  return { ok: true };
}

export function buildSQLPreview(operation, table, data, whereClause = null) {
  const op = operation.toUpperCase();
  if (op === "INSERT") {
    const cols = Object.keys(data).join(", ");
    const vals = Object.values(data).map(v => `'${String(v).replace(/'/g, "\\'")}'`).join(", ");
    return `INSERT INTO \`${table}\` (${cols}) VALUES (${vals})`;
  }
  if (op === "UPDATE") {
    const sets = Object.entries(data).map(([k, v]) => `\`${k}\` = '${String(v).replace(/'/g, "\\'")}'`).join(", ");
    return `UPDATE \`${table}\` SET ${sets}${whereClause ? ` WHERE ${whereClause}` : ""}`;
  }
  return `-- Unknown operation: ${op}`;
}

export async function proposeDBWrite({ agentKey, operation, targetTable, data, whereClause = null, reason = null }) {
  const validation = validateDBWrite(operation, targetTable);
  if (!validation.ok) throw new Error(validation.reason);

  const id = `dbw_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const sqlPreview = buildSQLPreview(operation, targetTable, data, whereClause);

  await pool.query(
    `INSERT INTO malti_db_write_requests (id, agent_key, operation, target_table, data_json, where_clause, sql_preview, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, agentKey, operation.toUpperCase(), targetTable, JSON.stringify(data), whereClause, sqlPreview, reason]
  );
  return { id, sql_preview: sqlPreview };
}

export async function getDBWriteRequest(id) {
  const [rows] = await pool.query("SELECT * FROM malti_db_write_requests WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export async function listDBWriteRequests(status = null, agentKey = null, limit = 50) {
  let q = "SELECT * FROM malti_db_write_requests WHERE 1=1";
  const params = [];
  if (status) { q += " AND status = ?"; params.push(status); }
  if (agentKey) { q += " AND agent_key = ?"; params.push(agentKey); }
  q += " ORDER BY proposed_at DESC LIMIT ?";
  params.push(limit);
  const [rows] = await pool.query(q, params);
  return rows;
}

export async function actionDBWriteRequest(id, action, actionedBy, reason = null) {
  const request = await getDBWriteRequest(id);
  if (!request) throw new Error("Request not found");
  if (request.status !== "pending") throw new Error(`Request already ${request.status}`);

  await pool.query(
    "UPDATE malti_db_write_requests SET status = ?, actioned_at = NOW(), actioned_by = ? WHERE id = ?",
    [action === "approve" ? "approved" : "rejected", actionedBy, id]
  );

  if (action === "approve") {
    try {
      const data = typeof request.data_json === "string" ? JSON.parse(request.data_json) : request.data_json;
      const sql = buildSQLPreview(request.operation, request.target_table, data, request.where_clause);
      const [result] = await pool.query(sql);
      await pool.query("UPDATE malti_db_write_requests SET status = 'executed', result_json = ? WHERE id = ?",
        [JSON.stringify({ affectedRows: result.affectedRows }), id]);
      return { executed: true, affectedRows: result.affectedRows };
    } catch (err) {
      await pool.query("UPDATE malti_db_write_requests SET status = 'error', result_json = ? WHERE id = ?",
        [JSON.stringify({ error: String(err) }), id]);
      throw err;
    }
  }
  return { executed: false };
}

// ── Agent Run History ──────────────────────────────────────────────────────
export async function logRun(agentKey, status, details = {}) {
  await pool.query(
    "INSERT INTO malti_agent_run_history (agent_key, status, duration_s, msg_count, channel, error) VALUES (?, ?, ?, ?, ?, ?)",
    [agentKey, status, details.duration_s ?? 0, details.msg_count ?? 0, details.channel ?? null, details.error ?? null]
  );
}

export async function getRunHistory(agentKey = null, limit = 50) {
  if (agentKey) {
    const [rows] = await pool.query(
      "SELECT * FROM malti_agent_run_history WHERE agent_key = ? ORDER BY created_at DESC LIMIT ?",
      [agentKey, limit]
    );
    return rows;
  }
  const [rows] = await pool.query("SELECT * FROM malti_agent_run_history ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows;
}

export async function getAgentStats() {
  const [rows] = await pool.query(`
    SELECT agent_key,
           COUNT(*) AS total_runs,
           SUM(status = 'success') AS successful,
           SUM(status = 'error') AS failed,
           AVG(duration_s) AS avg_duration_s,
           MAX(created_at) AS last_run_at
    FROM malti_agent_run_history
    GROUP BY agent_key
    ORDER BY total_runs DESC
  `);
  return rows;
}

// ── Training Data ──────────────────────────────────────────────────────────
export async function loadTrainingData(agentKey) {
  const [rows] = await pool.query("SELECT training_json FROM malti_agent_training WHERE agent_key = ?", [agentKey]);
  if (!rows.length) return { documents: [], policies: [], faqs: [], company_values: "", company_context: "" };
  return typeof rows[0].training_json === "string" ? JSON.parse(rows[0].training_json) : rows[0].training_json;
}

export async function saveTrainingData(agentKey, data) {
  await pool.query(
    "INSERT INTO malti_agent_training (agent_key, training_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE training_json = VALUES(training_json)",
    [agentKey, JSON.stringify(data)]
  );
}

// ── Schedules ──────────────────────────────────────────────────────────────
export async function getAllSchedules() {
  const [rows] = await pool.query("SELECT * FROM malti_agent_schedules");
  const out = {};
  for (const r of rows) out[r.agent_key] = { enabled: !!r.enabled, times: parseJSON(r.times, []), days: parseJSON(r.days, [1,2,3,4,5]), target_channel: r.target_channel };
  return out;
}

export async function getAgentSchedule(agentKey) {
  const [rows] = await pool.query("SELECT * FROM malti_agent_schedules WHERE agent_key = ?", [agentKey]);
  if (!rows.length) return { enabled: false, times: [], days: [1,2,3,4,5], target_channel: "tech_testing" };
  const r = rows[0];
  return { enabled: !!r.enabled, times: parseJSON(r.times, []), days: parseJSON(r.days, [1,2,3,4,5]), target_channel: r.target_channel };
}

export async function saveAgentSchedule(agentKey, { enabled, times, days, target_channel }) {
  await pool.query(
    `INSERT INTO malti_agent_schedules (agent_key, enabled, times, days, target_channel) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), times=VALUES(times), days=VALUES(days), target_channel=VALUES(target_channel)`,
    [agentKey, enabled ? 1 : 0, JSON.stringify(times ?? []), JSON.stringify(days ?? [1,2,3,4,5]), target_channel ?? "tech_testing"]
  );
}

// ── Custom Agents ──────────────────────────────────────────────────────────
export async function getCustomAgents() {
  const [rows] = await pool.query("SELECT agent_key, config_json FROM malti_custom_agents");
  const out = {};
  for (const r of rows) out[r.agent_key] = parseJSON(r.config_json, {});
  return out;
}

export async function saveCustomAgent(agentKey, config) {
  await pool.query(
    `INSERT INTO malti_custom_agents (agent_key, config_json) VALUES (?,?)
     ON DUPLICATE KEY UPDATE config_json=VALUES(config_json)`,
    [agentKey, JSON.stringify(config)]
  );
}

export async function deleteCustomAgent(agentKey) {
  await pool.query("DELETE FROM malti_custom_agents WHERE agent_key = ?", [agentKey]);
}

// ── Personality Overrides ──────────────────────────────────────────────────
export async function getPersonalityOverrides() {
  const [rows] = await pool.query("SELECT agent_key, personality_json FROM malti_agent_personalities");
  const out = {};
  for (const r of rows) out[r.agent_key] = parseJSON(r.personality_json, {});
  return out;
}

export async function saveAgentPersonality(agentKey, personality) {
  await pool.query(
    `INSERT INTO malti_agent_personalities (agent_key, personality_json) VALUES (?,?)
     ON DUPLICATE KEY UPDATE personality_json=VALUES(personality_json)`,
    [agentKey, JSON.stringify(personality)]
  );
}

// ── Cron Locks ─────────────────────────────────────────────────────────────
export async function checkCronLock(agentKey, lockWindow) {
  const [rows] = await pool.query("SELECT lock_window FROM malti_cron_locks WHERE agent_key = ?", [agentKey]);
  return rows.length > 0 && rows[0].lock_window === lockWindow;
}

export async function setCronLock(agentKey, lockWindow) {
  await pool.query(
    `INSERT INTO malti_cron_locks (agent_key, lock_window) VALUES (?,?)
     ON DUPLICATE KEY UPDATE lock_window=VALUES(lock_window), created_at=NOW(3)`,
    [agentKey, lockWindow]
  );
}

export async function purgeStaleCronLocks() {
  await pool.query("DELETE FROM malti_cron_locks WHERE created_at < DATE_SUB(NOW(), INTERVAL 25 HOUR)");
}

// ── Channel Overrides ──────────────────────────────────────────────────────
export async function getChannelOverrides() {
  const [rows] = await pool.query("SELECT agent_key, channel_key FROM malti_channel_overrides");
  const out = {};
  for (const r of rows) out[r.agent_key] = r.channel_key;
  return out;
}

export async function saveChannelOverride(agentKey, channelKey) {
  await pool.query(
    `INSERT INTO malti_channel_overrides (agent_key, channel_key) VALUES (?,?)
     ON DUPLICATE KEY UPDATE channel_key=VALUES(channel_key)`,
    [agentKey, channelKey]
  );
}

// ── Agent Cursors (replaces JSON cursor files) ─────────────────────────────
export async function getCursor(cursorKey) {
  const [rows] = await pool.query("SELECT cursor_data FROM malti_agent_cursors WHERE cursor_key = ?", [cursorKey]);
  if (!rows.length) return {};
  return parseJSON(rows[0].cursor_data, {});
}

export async function setCursor(cursorKey, data) {
  await pool.query(
    `INSERT INTO malti_agent_cursors (cursor_key, cursor_data) VALUES (?,?)
     ON DUPLICATE KEY UPDATE cursor_data=VALUES(cursor_data)`,
    [cursorKey, JSON.stringify(data)]
  );
}

// ── Slack Channels ─────────────────────────────────────────────────────────
export async function getAllSlackChannels() {
  const [rows] = await pool.query("SELECT channel_id, name, is_private FROM malti_slack_channels ORDER BY name ASC");
  return rows;
}

export async function upsertSlackChannels(channels) {
  if (!channels.length) return;
  const values = channels.map(c => [c.channel_id, c.name, c.is_private ? 1 : 0]);
  await pool.query(
    `INSERT INTO malti_slack_channels (channel_id, name, is_private) VALUES ?
     ON DUPLICATE KEY UPDATE name=VALUES(name), is_private=VALUES(is_private)`,
    [values]
  );
}

export function buildTrainingContext(training) {
  const parts = [];
  if (training.company_context) parts.push(`## Company Context\n${training.company_context}`);
  if (training.company_values) parts.push(`## Company Values\n${training.company_values}`);
  if (training.policies?.length) {
    parts.push("## Policies\n" + training.policies.map(p => `### ${p.title}\n${p.content}`).join("\n\n"));
  }
  if (training.documents?.length) {
    parts.push("## Knowledge Documents\n" + training.documents.map(d => `### ${d.title}\n${d.content}`).join("\n\n"));
  }
  if (training.faqs?.length) {
    parts.push("## FAQs\n" + training.faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n"));
  }
  return parts.join("\n\n---\n\n");
}
