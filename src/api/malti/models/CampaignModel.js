import { pulsePool } from "./db.js";
import { randomUUID } from "node:crypto";

export async function ensureCampaignTables() {
  const conn = await pulsePool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS campaigns (
      id              VARCHAR(36)   NOT NULL PRIMARY KEY,
      name            VARCHAR(255)  NOT NULL,
      status          VARCHAR(20)   NOT NULL DEFAULT 'draft',
      goal            TEXT          NOT NULL,
      briefing        TEXT          NULL,
      outcome_definitions JSON      NULL,
      rules           JSON          NULL,
      audience_source VARCHAR(100)  NULL,
      created_by      VARCHAR(100)  NULL,
      created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      started_at      DATETIME(3)   NULL,
      completed_at    DATETIME(3)   NULL,
      metrics         JSON          NULL,
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await conn.query(`CREATE TABLE IF NOT EXISTS campaign_stages (
      id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
      campaign_id     VARCHAR(36)   NOT NULL,
      stage_num       INT           NOT NULL DEFAULT 1,
      agent_key       VARCHAR(50)   NOT NULL,
      channel         VARCHAR(30)   NOT NULL DEFAULT 'whatsapp',
      goal            TEXT          NULL,
      rate_limit      INT           NOT NULL DEFAULT 50,
      follow_up_hours INT           NOT NULL DEFAULT 48,
      max_follow_ups  INT           NOT NULL DEFAULT 3,
      INDEX idx_campaign (campaign_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await conn.query(`CREATE TABLE IF NOT EXISTS campaign_tasks (
      id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
      campaign_id     VARCHAR(36)   NOT NULL,
      stage_id        INT UNSIGNED  NOT NULL,
      agent_key       VARCHAR(50)   NOT NULL,
      contact_name    VARCHAR(255)  NULL,
      contact_phone   VARCHAR(30)   NULL,
      contact_email   VARCHAR(255)  NULL,
      contact_meta    JSON          NULL,
      status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
      outcome         VARCHAR(100)  NULL,
      messages        JSON          NULL,
      follow_up_at    DATETIME(3)   NULL,
      created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_campaign (campaign_id),
      INDEX idx_status (status),
      INDEX idx_phone (contact_phone),
      INDEX idx_email (contact_email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await conn.query(`CREATE TABLE IF NOT EXISTS campaign_metrics_daily (
      id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
      campaign_id     VARCHAR(36)   NOT NULL,
      metric_date     DATE          NOT NULL,
      sent            INT           NOT NULL DEFAULT 0,
      delivered       INT           NOT NULL DEFAULT 0,
      replied         INT           NOT NULL DEFAULT 0,
      outcomes        JSON          NULL,
      INDEX idx_campaign_date (campaign_id, metric_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } finally {
    conn.release();
  }
}

export async function createCampaign(data) {
  const id = randomUUID();
  await pulsePool.query(
    `INSERT INTO campaigns (id, name, status, goal, briefing, outcome_definitions, rules, audience_source, created_by)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.goal, data.briefing ?? null,
     JSON.stringify(data.outcome_definitions ?? {}),
     JSON.stringify(data.rules ?? {}),
     data.audience_source ?? null, data.created_by ?? null]
  );
  return getCampaign(id);
}

export async function getCampaign(id) {
  const [rows] = await pulsePool.query("SELECT * FROM campaigns WHERE id = ?", [id]);
  if (!rows.length) return null;
  const campaign = rows[0];
  const [stages] = await pulsePool.query("SELECT * FROM campaign_stages WHERE campaign_id = ? ORDER BY stage_num", [id]);
  return { ...campaign, stages };
}

export async function listCampaigns(status = null, limit = 50) {
  if (status) {
    const [rows] = await pulsePool.query("SELECT * FROM campaigns WHERE status = ? ORDER BY created_at DESC LIMIT ?", [status, limit]);
    return rows;
  }
  const [rows] = await pulsePool.query("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows;
}

export async function updateCampaignStatus(id, status) {
  const extra = status === "active" ? ", started_at = NOW()" : status === "completed" ? ", completed_at = NOW()" : "";
  await pulsePool.query(`UPDATE campaigns SET status = ?${extra} WHERE id = ?`, [status, id]);
}

export async function addCampaignStage(campaignId, stageNum, stage) {
  const [result] = await pulsePool.query(
    `INSERT INTO campaign_stages (campaign_id, stage_num, agent_key, channel, goal, rate_limit, follow_up_hours, max_follow_ups)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [campaignId, stageNum, stage.agent_key, stage.channel ?? "whatsapp",
     stage.goal ?? null, stage.rate_limit ?? 50, stage.follow_up_hours ?? 48, stage.max_follow_ups ?? 3]
  );
  return result.insertId;
}

export async function addCampaignTasks(campaignId, contacts) {
  if (!contacts.length) return 0;
  const [stages] = await pulsePool.query("SELECT * FROM campaign_stages WHERE campaign_id = ? ORDER BY stage_num LIMIT 1", [campaignId]);
  if (!stages.length) throw new Error("No stages found for campaign");
  const stage = stages[0];

  const values = contacts.map(c => [
    campaignId, stage.id, stage.agent_key,
    c.name ?? null, c.phone ?? null, c.email ?? null,
    c.meta ? JSON.stringify(c.meta) : null
  ]);
  const placeholders = values.map(() => "(?,?,?,?,?,?,?)").join(",");
  const flat = values.flat();
  const [result] = await pulsePool.query(
    `INSERT INTO campaign_tasks (campaign_id, stage_id, agent_key, contact_name, contact_phone, contact_email, contact_meta) VALUES ${placeholders}`,
    flat
  );
  return result.affectedRows;
}

export async function getTask(id) {
  const [rows] = await pulsePool.query("SELECT * FROM campaign_tasks WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export async function getTasksForCampaign(campaignId, status = null, limit = 100, offset = 0) {
  if (status) {
    const [rows] = await pulsePool.query(
      "SELECT * FROM campaign_tasks WHERE campaign_id = ? AND status = ? ORDER BY created_at LIMIT ? OFFSET ?",
      [campaignId, status, limit, offset]
    );
    return rows;
  }
  const [rows] = await pulsePool.query(
    "SELECT * FROM campaign_tasks WHERE campaign_id = ? ORDER BY created_at LIMIT ? OFFSET ?",
    [campaignId, limit, offset]
  );
  return rows;
}

export async function updateTask(id, updates) {
  const cols = Object.keys(updates).map(k => `\`${k}\` = ?`).join(", ");
  const vals = Object.values(updates);
  await pulsePool.query(`UPDATE campaign_tasks SET ${cols} WHERE id = ?`, [...vals, id]);
}

export async function appendTaskMessage(taskId, direction, text, channel = "whatsapp") {
  const [rows] = await pulsePool.query("SELECT messages FROM campaign_tasks WHERE id = ?", [taskId]);
  if (!rows.length) return;
  const existing = rows[0].messages ? (typeof rows[0].messages === "string" ? JSON.parse(rows[0].messages) : rows[0].messages) : [];
  existing.push({ direction, text, channel, ts: new Date().toISOString() });
  await pulsePool.query("UPDATE campaign_tasks SET messages = ? WHERE id = ?", [JSON.stringify(existing), taskId]);
}

export async function findTaskByContact(phone = null, email = null) {
  if (phone) {
    const [rows] = await pulsePool.query(
      "SELECT * FROM campaign_tasks WHERE contact_phone = ? AND status IN ('pending','sent') ORDER BY updated_at DESC LIMIT 1",
      [phone]
    );
    if (rows.length) return rows[0];
  }
  if (email) {
    const [rows] = await pulsePool.query(
      "SELECT * FROM campaign_tasks WHERE contact_email = ? AND status IN ('pending','sent') ORDER BY updated_at DESC LIMIT 1",
      [email]
    );
    if (rows.length) return rows[0];
  }
  return null;
}

export async function getCampaignMetrics(campaignId) {
  const [rows] = await pulsePool.query(
    "SELECT * FROM campaign_metrics_daily WHERE campaign_id = ? ORDER BY metric_date DESC LIMIT 30",
    [campaignId]
  );
  return rows;
}
