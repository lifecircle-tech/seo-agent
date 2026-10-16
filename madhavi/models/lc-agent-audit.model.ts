import { ResultSetHeader, RowDataPacket } from "mysql2";
import { madhavi_pool } from "../../db";

// Wall-clock time in IST, 'YYYY-MM-DD HH:MM:SS'. Columns default to
// CURRENT_TIMESTAMP in the DB server's time zone, so ranges are converted
// to it in SQL rather than sent as instants.
export type IstDateTime = string;
const IST = "CONVERT_TZ(?, '+05:30', @@session.time_zone)";

// MariaDB stores JSON columns as LONGTEXT, so they come back as strings.
function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export type AgentRunTrigger =
  | "caregiver_message"
  | "slack_reply"
  | "scheduled_outreach";

export interface AgentRun extends RowDataPacket {
  id: number;
  hp_unique_id: number | null;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  chat_id: string | null;
  agent_key: string;
  trigger_source: AgentRunTrigger;
  status: "running" | "completed" | "failed";
  last_caregiver_message: string | null;
  reply_message: string | null;
  topic: string | null;
  summary: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  severity_reason: string | null;
  escalated: number;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  started_at: Date;
  completed_at: Date | null;
}

export interface AgentAction extends RowDataPacket {
  id: number;
  run_id: number;
  tool_name: string;
  action_type: string;
  input: unknown;
  output: string | null;
  is_error: number;
  created_at: Date;
}

export interface DailyReport extends RowDataPacket {
  id: number;
  report_date: string;
  metrics: Record<string, unknown>;
  narrative: string | null;
  slack_channel_id: string | null;
  slack_ts: string | null;
  generated_at: Date;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function insertAgentRun(data: {
  hp_unique_id: number | null;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  chat_id: string | null;
  agent_key: string;
  trigger_source: AgentRunTrigger;
  last_caregiver_message: string | null;
}) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_agent_run
        (hp_unique_id, caregiver_name, caregiver_phone, chat_id, agent_key,
         trigger_source, last_caregiver_message)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `,
    [
      data.hp_unique_id,
      data.caregiver_name,
      data.caregiver_phone,
      data.chat_id,
      data.agent_key,
      data.trigger_source,
      data.last_caregiver_message,
    ],
  );

  return result.insertId;
}

async function updateAgentRunCompleted(
  id: number,
  data: {
    status: "completed" | "failed";
    chat_id: string | null;
    reply_message: string | null;
    topic: string | null;
    summary: string | null;
    severity: string | null;
    severity_reason: string | null;
    escalated: boolean;
    error: string | null;
    input_tokens: number;
    output_tokens: number;
  },
) {
  await madhavi_pool.query<ResultSetHeader>(
    `
      UPDATE life_digital_agent_run
      SET status = ?, chat_id = COALESCE(?, chat_id), reply_message = ?,
          topic = ?, summary = ?, severity = ?, severity_reason = ?,
          escalated = ?, error = ?, input_tokens = ?, output_tokens = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?;
    `,
    [
      data.status,
      data.chat_id,
      data.reply_message,
      data.topic,
      data.summary,
      data.severity,
      data.severity_reason,
      data.escalated,
      data.error,
      data.input_tokens,
      data.output_tokens,
      id,
    ],
  );
}

async function insertAgentAction(data: {
  run_id: number;
  tool_name: string;
  action_type: string;
  input: unknown;
  output: string | null;
  is_error: boolean;
}) {
  const [result] = await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_agent_action
        (run_id, tool_name, action_type, input, output, is_error)
      VALUES (?, ?, ?, ?, ?, ?);
    `,
    [
      data.run_id,
      data.tool_name,
      data.action_type,
      JSON.stringify(data.input ?? null),
      data.output,
      data.is_error,
    ],
  );

  return result.insertId;
}

async function upsertDailyReport(data: {
  report_date: string;
  metrics: unknown;
  narrative: string | null;
}) {
  await madhavi_pool.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_daily_report (report_date, metrics, narrative)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        metrics = VALUES(metrics),
        narrative = VALUES(narrative),
        generated_at = CURRENT_TIMESTAMP;
    `,
    [data.report_date, JSON.stringify(data.metrics), data.narrative],
  );
}

async function updateDailyReportSlack(
  report_date: string,
  slack_channel_id: string,
  slack_ts: string,
) {
  await madhavi_pool.query<ResultSetHeader>(
    `
      UPDATE life_digital_daily_report
      SET slack_channel_id = ?, slack_ts = ?
      WHERE report_date = ?;
    `,
    [slack_channel_id, slack_ts, report_date],
  );
}

// ---------------------------------------------------------------------------
// Frontend reads
// ---------------------------------------------------------------------------

export interface AgentRunFilter {
  from?: IstDateTime;
  to?: IstDateTime;
  hp_unique_id?: number;
  agent_key?: string;
  severity?: string;
  topic?: string;
  trigger_source?: string;
  escalated?: boolean;
  limit: number;
  offset: number;
}

function agentRunWhere(filter: Omit<AgentRunFilter, "limit" | "offset">) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.from) {
    conditions.push(`started_at >= ${IST}`);
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push(`started_at < ${IST}`);
    params.push(filter.to);
  }
  if (filter.hp_unique_id) {
    conditions.push("hp_unique_id = ?");
    params.push(filter.hp_unique_id);
  }
  if (filter.agent_key) {
    conditions.push("agent_key = ?");
    params.push(filter.agent_key);
  }
  if (filter.severity) {
    conditions.push("severity = ?");
    params.push(filter.severity);
  }
  if (filter.topic) {
    conditions.push("topic = ?");
    params.push(filter.topic);
  }
  if (filter.trigger_source) {
    conditions.push("trigger_source = ?");
    params.push(filter.trigger_source);
  }
  if (filter.escalated !== undefined) {
    conditions.push("escalated = ?");
    params.push(filter.escalated);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

async function findAgentRuns(filter: AgentRunFilter) {
  const { where, params } = agentRunWhere(filter);

  const [[rows], [count]] = await Promise.all([
    madhavi_pool.query<AgentRun[]>(
      `
        SELECT * FROM life_digital_agent_run ${where}
        ORDER BY started_at DESC, id DESC
        LIMIT ? OFFSET ?;
      `,
      [...params, filter.limit, filter.offset],
    ),
    madhavi_pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM life_digital_agent_run ${where};`,
      params,
    ),
  ]);

  return { rows, total: Number(count[0]?.total ?? 0) };
}

async function findAgentRunById(id: number) {
  const [rows] = await madhavi_pool.query<AgentRun[]>(
    `SELECT * FROM life_digital_agent_run WHERE id = ?;`,
    [id],
  );

  return rows[0] ?? null;
}

async function findAgentActionsByRunIds(run_ids: number[]) {
  if (run_ids.length === 0) return [];

  const [rows] = await madhavi_pool.query<AgentAction[]>(
    `
      SELECT * FROM life_digital_agent_action
      WHERE run_id IN (?)
      ORDER BY created_at ASC, id ASC;
    `,
    [run_ids],
  );

  return rows.map((row) => ({ ...row, input: parseJson(row.input) }));
}

async function getCaregiverAuditSummary(hp_unique_id: number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total_runs,
             CAST(COALESCE(SUM(severity = 'critical'), 0) AS UNSIGNED) AS critical_runs,
             CAST(COALESCE(SUM(severity = 'high'), 0) AS UNSIGNED) AS high_runs,
             CAST(COALESCE(SUM(escalated), 0) AS UNSIGNED) AS escalated_runs,
             MIN(started_at) AS first_run_at,
             MAX(started_at) AS last_run_at
      FROM life_digital_agent_run
      WHERE hp_unique_id = ?;
    `,
    [hp_unique_id],
  );

  return rows[0];
}

async function findDailyReport(report_date: string) {
  const [rows] = await madhavi_pool.query<DailyReport[]>(
    `
      SELECT id, DATE_FORMAT(report_date, '%Y-%m-%d') AS report_date, metrics,
             narrative, slack_channel_id, slack_ts, generated_at
      FROM life_digital_daily_report
      WHERE report_date = ?;
    `,
    [report_date],
  );

  return rows[0]
    ? { ...rows[0], metrics: parseJson(rows[0].metrics) as DailyReport["metrics"] }
    : null;
}

async function findDailyReports(limit: number, offset: number) {
  const [rows] = await madhavi_pool.query<DailyReport[]>(
    `
      SELECT id, DATE_FORMAT(report_date, '%Y-%m-%d') AS report_date, metrics,
             narrative, slack_channel_id, slack_ts, generated_at
      FROM life_digital_daily_report
      ORDER BY report_date DESC
      LIMIT ? OFFSET ?;
    `,
    [limit, offset],
  );

  return rows.map((row) => ({
    ...row,
    metrics: parseJson(row.metrics) as DailyReport["metrics"],
  }));
}

// ---------------------------------------------------------------------------
// Daily report aggregates. Every range is [from, to).
// ---------------------------------------------------------------------------

async function getRunTotals(from: IstDateTime, to: IstDateTime) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total_runs,
             COUNT(DISTINCT hp_unique_id) AS caregivers,
             CAST(COALESCE(SUM(status = 'failed'), 0) AS UNSIGNED) AS failed_runs,
             CAST(COALESCE(SUM(severity = 'critical'), 0) AS UNSIGNED) AS critical_runs,
             COUNT(DISTINCT CASE WHEN severity = 'critical' THEN hp_unique_id END) AS critical_caregivers,
             CAST(COALESCE(SUM(input_tokens), 0) AS UNSIGNED) AS input_tokens,
             CAST(COALESCE(SUM(output_tokens), 0) AS UNSIGNED) AS output_tokens
      FROM life_digital_agent_run
      WHERE started_at >= ${IST} AND started_at < ${IST};
    `,
    [from, to],
  );

  return rows[0];
}

// Column names are internal constants, never user input.
const RUN_GROUP_COLUMNS = [
  "trigger_source",
  "agent_key",
  "topic",
  "severity",
] as const;

async function countRunsBy(
  column: (typeof RUN_GROUP_COLUMNS)[number],
  from: IstDateTime,
  to: IstDateTime,
) {
  if (!RUN_GROUP_COLUMNS.includes(column)) {
    throw new Error(`Cannot group agent runs by ${column}`);
  }

  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT COALESCE(${column}, 'unclassified') AS \`key\`,
             COUNT(*) AS runs,
             COUNT(DISTINCT hp_unique_id) AS caregivers
      FROM life_digital_agent_run
      WHERE started_at >= ${IST} AND started_at < ${IST}
      GROUP BY \`key\`
      ORDER BY runs DESC;
    `,
    [from, to],
  );

  return rows as { key: string; runs: number; caregivers: number }[];
}

async function countActionsByType(from: IstDateTime, to: IstDateTime) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT a.action_type,
             CAST(SUM(NOT a.is_error) AS UNSIGNED) AS succeeded,
             CAST(SUM(a.is_error) AS UNSIGNED) AS failed,
             COUNT(DISTINCT CASE WHEN NOT a.is_error THEN r.hp_unique_id END) AS caregivers
      FROM life_digital_agent_action a
      JOIN life_digital_agent_run r ON r.id = a.run_id
      WHERE a.created_at >= ${IST} AND a.created_at < ${IST}
      GROUP BY a.action_type
      ORDER BY succeeded DESC;
    `,
    [from, to],
  );

  return rows as {
    action_type: string;
    succeeded: number;
    failed: number;
    caregivers: number;
  }[];
}

async function findRunsBySeverity(severities: string[], from: IstDateTime, to: IstDateTime) {
  const [rows] = await madhavi_pool.query<AgentRun[]>(
    `
      SELECT id, hp_unique_id, caregiver_name, agent_key, topic, severity,
             severity_reason, summary, escalated, started_at
      FROM life_digital_agent_run
      WHERE severity IN (?) AND started_at >= ${IST} AND started_at < ${IST}
      ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low'), started_at ASC;
    `,
    [severities, from, to],
  );

  return rows;
}

async function findRunSummaries(from: IstDateTime, to: IstDateTime) {
  const [rows] = await madhavi_pool.query<AgentRun[]>(
    `
      SELECT caregiver_name, agent_key, trigger_source, topic, severity,
             summary, escalated
      FROM life_digital_agent_run
      WHERE status = 'completed' AND summary IS NOT NULL
        AND started_at >= ${IST} AND started_at < ${IST}
      ORDER BY started_at ASC;
    `,
    [from, to],
  );

  return rows;
}

// Threads opened in Slack, by channel purpose. Purposes other than
// report / suggestion are agent channels, where an employee asked the
// agent to reach out to caregivers.
async function countSlackThreadsByPurpose(from: IstDateTime, to: IstDateTime) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT purpose,
             COUNT(DISTINCT channel_id, thread_ts) AS threads,
             COUNT(DISTINCT hp_unique_id) AS caregivers
      FROM life_digital_slack_conversation
      WHERE created_at >= ${IST} AND created_at < ${IST}
      GROUP BY purpose;
    `,
    [from, to],
  );

  return rows as { purpose: string; threads: number; caregivers: number }[];
}

async function countEscalationsAwaitingReply(from: IstDateTime, to: IstDateTime) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS threads, COUNT(DISTINCT c.hp_unique_id) AS caregivers
      FROM life_digital_slack_conversation c
      WHERE c.purpose = 'report'
        AND c.created_at >= ${IST} AND c.created_at < ${IST}
        AND NOT EXISTS (
          SELECT 1 FROM life_digital_slack_reply r
          WHERE r.slack_conversation_id = c.id
        );
    `,
    [from, to],
  );

  return rows[0] as { threads: number; caregivers: number };
}

async function getSlackReplyStats(from: IstDateTime, to: IstDateTime) {
  const [[received], [relayed], [pending]] = await Promise.all([
    madhavi_pool.query<RowDataPacket[]>(
      `
        SELECT COUNT(*) AS replies,
               COUNT(DISTINCT c.hp_unique_id) AS caregivers
        FROM life_digital_slack_reply r
        JOIN life_digital_slack_conversation c ON c.id = r.slack_conversation_id
        WHERE r.created_at >= ${IST} AND r.created_at < ${IST};
      `,
      [from, to],
    ),
    madhavi_pool.query<RowDataPacket[]>(
      `
        SELECT COUNT(*) AS replies,
               COUNT(DISTINCT c.hp_unique_id) AS caregivers
        FROM life_digital_slack_reply r
        JOIN life_digital_slack_conversation c ON c.id = r.slack_conversation_id
        WHERE r.relay_status = 'relayed'
          AND r.relayed_at >= ${IST} AND r.relayed_at < ${IST};
      `,
      [from, to],
    ),
    // Outstanding at the time the report is generated, not limited to the day
    madhavi_pool.query<RowDataPacket[]>(
      `
        SELECT COUNT(*) AS replies,
               COUNT(DISTINCT c.hp_unique_id) AS caregivers
        FROM life_digital_slack_reply r
        JOIN life_digital_slack_conversation c ON c.id = r.slack_conversation_id
        WHERE r.relay_status = 'pending';
      `,
    ),
  ]);

  return {
    received: received[0] as { replies: number; caregivers: number },
    relayed: relayed[0] as { replies: number; caregivers: number },
    pending: pending[0] as { replies: number; caregivers: number },
  };
}

async function getTokenUsageTotals(from: IstDateTime, to: IstDateTime) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS requests,
             CAST(COALESCE(SUM(total_tokens), 0) AS UNSIGNED) AS total_tokens
      FROM tenant_agent_tokens_usage
      WHERE tenant_id = 1 AND created_at >= ${IST} AND created_at < ${IST};
    `,
    [from, to],
  );

  return rows[0] as { requests: number; total_tokens: number };
}

async function findSlackThreadsByHpUniqueId(hp_unique_id: number) {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT id, chat_id, agent_key, purpose, channel_id, thread_ts, message,
             status, created_at, updated_at
      FROM life_digital_slack_conversation
      WHERE hp_unique_id = ?
      ORDER BY created_at DESC;
    `,
    [hp_unique_id],
  );

  return rows;
}

export {
  insertAgentRun,
  updateAgentRunCompleted,
  insertAgentAction,
  upsertDailyReport,
  updateDailyReportSlack,
  findAgentRuns,
  findAgentRunById,
  findAgentActionsByRunIds,
  getCaregiverAuditSummary,
  findDailyReport,
  findDailyReports,
  getRunTotals,
  countRunsBy,
  countActionsByType,
  findRunsBySeverity,
  findRunSummaries,
  countSlackThreadsByPurpose,
  countEscalationsAwaitingReply,
  getSlackReplyStats,
  findSlackThreadsByHpUniqueId,
  getTokenUsageTotals,
};
