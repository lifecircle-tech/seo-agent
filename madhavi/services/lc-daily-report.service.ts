import Anthropic from "@anthropic-ai/sdk";
import { webApi } from "@slack/bolt";
import { logger } from "../utils/logger";
import { getSlackChannel } from "../config/slack-channels";
import {
  countActionsByType,
  countEscalationsAwaitingReply,
  countRunsBy,
  countSlackThreadsByPurpose,
  findDailyReport,
  findRunsBySeverity,
  findRunSummaries,
  getRunTotals,
  getSlackReplyStats,
  getTokenUsageTotals,
  updateDailyReportSlack,
  upsertDailyReport,
  type IstDateTime,
} from "../models/lc-agent-audit.model";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 100 * 1000,
  maxRetries: 1,
});

const REPORT_MODEL = "claude-haiku-4-5";
// Report days run midnight to midnight IST.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const REPORT_TIMEZONE = "Asia/Kolkata";

const NARRATIVE_PROMPT = `You write the end-of-day summary for LifeCircle's care team about the conversations their care-management agent had with caregivers today.
You are given one short summary per agent run, with its topic and severity.
Write 3 to 6 Slack mrkdwn bullets (•) covering the main themes of the day, recurring issues across caregivers, and anything the care team should follow up on tomorrow. Name caregivers only for high or critical items.
Bold with single asterisks (*text*), Slack does not render **double**. No headings, no tables, no preamble. Be concise and factual; do not invent anything that is not in the summaries.`;

// Today's date in IST as YYYY-MM-DD.
export function todayReportDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE }).format(
    new Date(),
  );
}

export function isValidReportDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  // Rejects dates that roll over, e.g. 2026-02-30
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

// An instant as IST wall-clock time, 'YYYY-MM-DD HH:MM:SS'
export function toIstDateTime(date: Date): IstDateTime {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 19).replace("T", " ");
}

// [from, to) of an IST report day
export function getReportDayRange(date: string) {
  const next_day = new Date(`${date}T00:00:00Z`);
  next_day.setUTCDate(next_day.getUTCDate() + 1);

  return {
    from: `${date} 00:00:00` as IstDateTime,
    to: `${next_day.toISOString().slice(0, 10)} 00:00:00` as IstDateTime,
  };
}

function countFor<T extends { key: string }>(rows: T[], key: string) {
  return rows.find((r) => r.key === key);
}

async function buildDailyMetrics(date: string) {
  const { from, to } = getReportDayRange(date);

  const [
    totals,
    by_trigger,
    by_agent,
    by_topic,
    by_severity,
    actions,
    critical_and_high,
    slack_threads,
    escalations_awaiting_reply,
    slack_replies,
    token_usage,
  ] = await Promise.all([
    getRunTotals(from, to),
    countRunsBy("trigger_source", from, to),
    countRunsBy("agent_key", from, to),
    countRunsBy("topic", from, to),
    countRunsBy("severity", from, to),
    countActionsByType(from, to),
    findRunsBySeverity(["critical", "high"], from, to),
    countSlackThreadsByPurpose(from, to),
    countEscalationsAwaitingReply(from, to),
    getSlackReplyStats(from, to),
    getTokenUsageTotals(from, to),
  ]);

  const action = (type: string) =>
    actions.find((a) => a.action_type === type) ?? {
      action_type: type,
      succeeded: 0,
      failed: 0,
      caregivers: 0,
    };

  const outreach_threads = slack_threads.filter(
    (t) => t.purpose !== "report" && t.purpose !== "suggestion",
  );

  return {
    date,
    timezone: REPORT_TIMEZONE,
    conversations: {
      caregivers: Number(totals.caregivers),
      agent_runs: Number(totals.total_runs),
      failed_runs: Number(totals.failed_runs),
      caregiver_initiated:
        Number(countFor(by_trigger, "caregiver_message")?.caregivers ?? 0),
      scheduled_outreach:
        Number(countFor(by_trigger, "scheduled_outreach")?.caregivers ?? 0),
      by_trigger,
      by_agent,
    },
    topics: by_topic,
    severity: {
      critical_runs: Number(totals.critical_runs),
      critical_caregivers: Number(totals.critical_caregivers),
      by_severity,
      critical_and_high: critical_and_high.map((r) => ({
        run_id: r.id,
        hp_unique_id: r.hp_unique_id,
        caregiver_name: r.caregiver_name,
        agent_key: r.agent_key,
        topic: r.topic,
        severity: r.severity,
        summary: r.summary,
        severity_reason: r.severity_reason,
        escalated: !!r.escalated,
        at: r.started_at,
      })),
    },
    actions: {
      whatsapp_messages_sent: Number(action("whatsapp_message").succeeded),
      escalations: Number(action("escalation").succeeded),
      escalated_caregivers: Number(action("escalation").caregivers),
      suggestions: Number(action("suggestion").succeeded),
      support_tickets: Number(action("support_ticket").succeeded),
      slack_thread_updates: Number(action("slack_thread_update").succeeded),
      failed_tool_calls: actions.reduce((n, a) => n + Number(a.failed), 0),
      by_type: actions,
    },
    slack: {
      escalations_awaiting_reply: {
        threads: Number(escalations_awaiting_reply.threads),
        caregivers: Number(escalations_awaiting_reply.caregivers),
      },
      care_team_replies_received: {
        replies: Number(slack_replies.received.replies),
        caregivers: Number(slack_replies.received.caregivers),
      },
      replies_relayed_to_caregivers: {
        replies: Number(slack_replies.relayed.replies),
        caregivers: Number(slack_replies.relayed.caregivers),
      },
      replies_pending_relay: {
        replies: Number(slack_replies.pending.replies),
        caregivers: Number(slack_replies.pending.caregivers),
      },
      // Caregivers the agent messaged because an employee asked in an
      // agent channel (e.g. caregiver search)
      slack_requested_outreach: {
        threads: outreach_threads.reduce((n, t) => n + Number(t.threads), 0),
        caregivers: outreach_threads.reduce(
          (n, t) => n + Number(t.caregivers),
          0,
        ),
        by_channel: outreach_threads,
      },
    },
    token_usage: {
      requests: Number(token_usage.requests),
      total_tokens: Number(token_usage.total_tokens),
    },
  };
}

export type DailyMetrics = Awaited<ReturnType<typeof buildDailyMetrics>>;

async function writeNarrative(date: string) {
  const { from, to } = getReportDayRange(date);
  const runs = await findRunSummaries(from, to);
  if (runs.length === 0) return null;

  const response = await client.messages.create({
    model: REPORT_MODEL,
    max_tokens: 1000,
    system: NARRATIVE_PROMPT,
    messages: [
      {
        role: "user",
        content: `CONVERSATIONS ON ${date}:\n${JSON.stringify(
          runs.map((r) => ({
            caregiver: r.caregiver_name,
            agent: r.agent_key,
            trigger: r.trigger_source,
            topic: r.topic,
            severity: r.severity,
            escalated: !!r.escalated,
            summary: r.summary,
          })),
        )}`,
      },
    ],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

const label = (key: string) => key.replace(/_/g, " ");

function formatSlackReport(metrics: DailyMetrics, narrative: string | null) {
  const { conversations, severity, actions, slack } = metrics;
  const lines: string[] = [
    `*Madhavi daily report: ${metrics.date}*`,
    "",
    `*Conversations:* ${conversations.caregivers} caregivers, ${conversations.agent_runs} agent runs` +
      (conversations.failed_runs ? ` (${conversations.failed_runs} failed)` : ""),
    `• Caregiver initiated: ${conversations.caregiver_initiated}  • Scheduled outreach: ${conversations.scheduled_outreach}`,
    `*Critical:* ${severity.critical_caregivers} caregivers (${severity.critical_runs} runs)`,
    `*Escalations:* ${actions.escalations} to Slack for ${actions.escalated_caregivers} caregivers, ${slack.escalations_awaiting_reply.threads} still awaiting a care-team reply`,
    `*Relayed from Slack:* ${slack.replies_relayed_to_caregivers.replies} care-team replies to ${slack.replies_relayed_to_caregivers.caregivers} caregivers` +
      (slack.replies_pending_relay.replies
        ? `, ${slack.replies_pending_relay.replies} pending`
        : ""),
    `*Slack-requested outreach:* ${slack.slack_requested_outreach.caregivers} caregivers`,
    `*Agent actions:* ${actions.whatsapp_messages_sent} WhatsApp messages, ${actions.support_tickets} support tickets, ${actions.suggestions} suggestions, ${actions.slack_thread_updates} thread updates` +
      (actions.failed_tool_calls
        ? `, ${actions.failed_tool_calls} failed tool calls`
        : ""),
  ];

  if (metrics.topics.length > 0) {
    lines.push(
      "",
      "*Topics:* " +
        metrics.topics
          .map((t) => `${label(t.key)} (${t.caregivers})`)
          .join(", "),
    );
  }

  if (narrative) {
    lines.push("", "*Highlights*", narrative);
  }

  if (severity.critical_and_high.length > 0) {
    lines.push("", "*Needs attention*");
    for (const run of severity.critical_and_high) {
      lines.push(
        `• [${run.severity}] ${run.caregiver_name ?? run.hp_unique_id ?? "unknown"}` +
          ` (${label(run.topic ?? "unclassified")})${run.escalated ? " - escalated" : ""}: ${run.summary ?? ""}`,
      );
    }
  }

  return lines.join("\n");
}

async function postReportToSlack(date: string, text: string) {
  const token =
    process.env.SLACK_BOT_TOKEN_MADHAVI ?? process.env.SLACK_BOT_TOKEN;
  const channel = "C0C5688UBR8";
    // process.env.MADHAVI_DAILY_REPORT_CHANNEL_ID ??
    // getSlackChannel("report")?.channel_id;

  if (!token || !channel) {
    logger.warn(
      "[dailyReport] Slack bot token or MADHAVI_DAILY_REPORT_CHANNEL_ID not set, report not posted",
    );
    return;
  }

  const slack = new webApi.WebClient(token);
  const result = await slack.chat.postMessage({ channel, text });
  if (result.channel && result.ts) {
    await updateDailyReportSlack(date, result.channel, result.ts);
  }
}

// Builds and stores the report for an IST day. Re-running for the same day
// replaces it. `notify` also posts it to Slack.
async function generateDailyReport(date: string, { notify = false } = {}) {
  const metrics = await buildDailyMetrics(date);

  let narrative: string | null = null;
  try {
    narrative = await writeNarrative(date);
  } catch (err) {
    logger.error("[dailyReport] narrative failed", err);
  }

  await upsertDailyReport({ report_date: date, metrics, narrative });

  if (notify) {
    try {
      await postReportToSlack(date, formatSlackReport(metrics, narrative));
    } catch (err) {
      logger.error("[dailyReport] Slack post failed", err);
    }
  }

  return findDailyReport(date);
}

export { generateDailyReport, buildDailyMetrics };
