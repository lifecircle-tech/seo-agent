import { Request, Response } from "express";
import {
  normalizePagination,
  parsePaginationQuery,
} from "../utils/common.js";
import {
  findAgentActionsByRunIds,
  findAgentRunById,
  findAgentRuns,
  findDailyReport,
  findDailyReports,
  findSlackThreadsByHpUniqueId,
  getCaregiverAuditSummary,
  type AgentRun,
} from "../models/lc-agent-audit.model.js";
import { getSlackRepliesByConversationIds } from "../models/lc-slack-conversation.model.js";
import {
  generateDailyReport,
  getReportDayRange,
  isValidReportDate,
  toIstDateTime,
  todayReportDate,
} from "../services/lc-daily-report.service.js";

function queryString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Attaches each run's tool calls to it, in call order.
async function withActions(runs: AgentRun[]) {
  const actions = await findAgentActionsByRunIds(runs.map((r) => r.id));

  return runs.map((run) => ({
    ...run,
    escalated: !!run.escalated,
    actions: actions
      .filter((a) => a.run_id === run.id)
      .map((a) => ({ ...a, is_error: !!a.is_error })),
  }));
}

// GET /agent-audit/runs?date=&from=&to=&hp_unique_id=&agent_key=&severity=&topic=&trigger_source=&escalated=&limit=&offset=
// `date` (IST day) takes precedence over from / to.
async function getAgentRuns(req: Request, res: Response) {
  const query = req.query as Record<string, unknown>;
  const { limit, offset } = normalizePagination(parsePaginationQuery(query));

  let from: string | undefined;
  let to: string | undefined;
  const date = queryString(query.date);
  if (date) {
    if (!isValidReportDate(date)) {
      res.status(400).json({ message: "date must be YYYY-MM-DD" });
      return;
    }
    ({ from, to } = getReportDayRange(date));
  } else {
    const from_date = queryString(query.from)
      ? new Date(String(query.from))
      : undefined;
    const to_date = queryString(query.to)
      ? new Date(String(query.to))
      : undefined;
    if (
      (from_date && Number.isNaN(from_date.getTime())) ||
      (to_date && Number.isNaN(to_date.getTime()))
    ) {
      res.status(400).json({ message: "from / to must be valid dates" });
      return;
    }
    from = from_date && toIstDateTime(from_date);
    to = to_date && toIstDateTime(to_date);
  }

  const escalated = queryString(query.escalated);
  const { rows, total } = await findAgentRuns({
    from,
    to,
    hp_unique_id: Number(query.hp_unique_id) || undefined,
    agent_key: queryString(query.agent_key),
    severity: queryString(query.severity),
    topic: queryString(query.topic),
    trigger_source: queryString(query.trigger_source),
    escalated: escalated === undefined ? undefined : escalated === "true",
    limit,
    offset,
  });

  res.json({ total, limit, offset, runs: await withActions(rows) });
}

// GET /agent-audit/runs/:id
async function getAgentRun(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid run id" });
    return;
  }

  const run = await findAgentRunById(id);
  if (!run) {
    res.status(404).json({ message: "Agent run not found" });
    return;
  }

  const [with_actions] = await withActions([run]);
  res.json(with_actions);
}

// GET /agent-audit/caregivers/:hp_unique_id?limit=&offset=
// Agent runs (newest first, paginated) plus every Slack thread raised
// about the caregiver with the care team's replies.
async function getCaregiverAudit(req: Request, res: Response) {
  const hp_unique_id = Number(req.params.hp_unique_id);
  if (!hp_unique_id) {
    res.status(400).json({ message: "Invalid hp_unique_id" });
    return;
  }

  const { limit, offset } = normalizePagination(
    parsePaginationQuery(req.query as Record<string, unknown>),
  );

  const [summary, runs, threads] = await Promise.all([
    getCaregiverAuditSummary(hp_unique_id),
    findAgentRuns({ hp_unique_id, limit, offset }),
    findSlackThreadsByHpUniqueId(hp_unique_id),
  ]);
  const replies = await getSlackRepliesByConversationIds(
    threads.map((t) => t.id),
  );

  res.json({
    hp_unique_id,
    caregiver_name: runs.rows[0]?.caregiver_name ?? null,
    summary,
    runs: {
      total: runs.total,
      limit,
      offset,
      items: await withActions(runs.rows),
    },
    slack_threads: threads.map((t) => ({
      ...t,
      replies: replies.filter((r) => r.slack_conversation_id === t.id),
    })),
  });
}

// GET /agent-audit/reports/daily?limit=&offset=
async function getDailyReports(req: Request, res: Response) {
  const { limit, offset } = normalizePagination(
    parsePaginationQuery(req.query as Record<string, unknown>),
  );

  res.json(await findDailyReports(limit, offset));
}

// GET /agent-audit/reports/daily/:date?refresh=true
// Today's report, a missing day, or ?refresh=true is built from the
// current data and stored.
async function getDailyReport(req: Request, res: Response) {
  const date = String(req.params.date);
  if (!isValidReportDate(date)) {
    res.status(400).json({ message: "date must be YYYY-MM-DD" });
    return;
  }

  const stored =
    req.query.refresh === "true" || date === todayReportDate()
      ? null
      : await findDailyReport(date);

  res.json(stored ?? (await generateDailyReport(date)));
}

// POST /agent-audit/reports/daily/:date/generate?notify=true
async function generateDailyReportNow(req: Request, res: Response) {
  const date = String(req.params.date);
  if (!isValidReportDate(date)) {
    res.status(400).json({ message: "date must be YYYY-MM-DD" });
    return;
  }

  res.json(
    await generateDailyReport(date, { notify: req.query.notify === "true" }),
  );
}

export {
  getAgentRuns,
  getAgentRun,
  getCaregiverAudit,
  getDailyReports,
  getDailyReport,
  generateDailyReportNow,
};
