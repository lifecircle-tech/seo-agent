/**
 * Slack Channel Monitor Agent
 *
 * Flow:
 *  1. Read messages from multiple Slack channels (Slack Web API)
 *  2. Build a consolidated issues prompt
 *  3. Send to Ollama for analysis
 *  4. Post the report to the assigned output channel
 *  5. Log every step to console + logs/malti.log
 */

import { maltiLogger }    from "../utils/maltiLogger.js";
import { postSlackOutput } from "./slackController.js";
import * as AgentModel    from "../models/AgentModel.js";

const LOG = "SLACK_MONITOR";
const SLACK_API       = "https://slack.com/api";
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/v1$/, "");
const OLLAMA_MODEL    = "llama3.2:3b";

// ── In-memory channel-name → ID cache (1 hour) ───────────────────────────
const _channelIdCache  = new Map();
let   _channelCacheExp = 0;

// ── Slack helpers ─────────────────────────────────────────────────────────

async function slackApi(method, params = {}) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");

  maltiLogger.debug(LOG, `Slack API call: ${method}`, { params });

  const res = await fetch(`${SLACK_API}/${method}`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body:    JSON.stringify(params),
  });
  const data = await res.json();

  if (!data.ok) maltiLogger.warn(LOG, `Slack API warning: ${method}`, { error: data.error });
  return data;
}

async function resolveChannelId(name) {
  const clean = name.replace(/^#/, "");

  if (Date.now() < _channelCacheExp && _channelIdCache.has(clean)) {
    maltiLogger.debug(LOG, `Channel ID cache hit: #${clean} → ${_channelIdCache.get(clean)}`);
    return _channelIdCache.get(clean);
  }

  maltiLogger.info(LOG, `Refreshing channel list from Slack API`);
  const data = await slackApi("conversations.list", { limit: 200 });
  if (data.ok && data.channels) {
    _channelCacheExp = Date.now() + 3_600_000;
    _channelIdCache.clear();
    data.channels.forEach(c => _channelIdCache.set(c.name, c.id));
    maltiLogger.info(LOG, `Channel cache refreshed`, { count: data.channels.length });
  }

  const id = _channelIdCache.get(clean) ?? clean;
  maltiLogger.debug(LOG, `Resolved #${clean} → ${id}`);
  return id;
}

async function fetchChannelMessages(channelName, lookbackHours = 24) {
  maltiLogger.info(LOG, `Fetching messages from #${channelName}`, { lookback_hours: lookbackHours });

  const channelId = await resolveChannelId(channelName);
  const oldest    = (Date.now() / 1000 - lookbackHours * 3600).toFixed(0);

  const result = await slackApi("conversations.history", {
    channel: channelId,
    oldest,
    limit: 100,
  });

  if (!result.ok) {
    maltiLogger.error(LOG, `Failed to fetch #${channelName}`, { error: result.error });
    return [];
  }

  const msgs = result.messages ?? [];
  maltiLogger.info(LOG, `Fetched ${msgs.length} messages from #${channelName}`);
  return msgs;
}

// ── Ollama helper ─────────────────────────────────────────────────────────

async function callOllama(systemPrompt, userMessage) {
  const url = `${OLLAMA_BASE_URL}/v1/chat/completions`;
  maltiLogger.info(LOG, `Calling Ollama`, { model: OLLAMA_MODEL, url });

  const payload = {
    model:      OLLAMA_MODEL,
    messages:   [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage  },
    ],
    max_tokens: 4096,
    stream:     false,
  };
  maltiLogger.debug(LOG, `Ollama request payload size`, {
    system_chars: systemPrompt.length,
    user_chars:   userMessage.length,
  });

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text();
    maltiLogger.error(LOG, `Ollama HTTP error`, { status: res.status, body: body.slice(0, 200) });
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }

  const data  = await res.json();
  maltiLogger.info(LOG, `Ollama response received`, { usage: data.usage });

  // Strip <think>...</think> reasoning sections (deepseek-r1)
  const text = (data.choices?.[0]?.message?.content || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

  maltiLogger.debug(LOG, `Ollama clean response length: ${text.length} chars`);
  return { text, usage: data.usage };
}

// ── Prompt builder ────────────────────────────────────────────────────────

function buildPrompt(channelData, agentPrompt) {
  const today = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const sections = channelData.map(({ channel, messages }) => {
    if (!messages.length) return `#${channel}: No messages in this period.`;

    const lines = messages.map(m => {
      const ts   = new Date(parseFloat(m.ts) * 1000)
        .toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
      const user = m.username ?? m.user ?? "unknown";
      const text = (m.text ?? "").slice(0, 300).replace(/\n/g, " ");
      return `  [${ts}] ${user}: ${text}`;
    });

    return `#${channel} (${messages.length} messages):\n${lines.join("\n")}`;
  }).join("\n\n---\n\n");

  const systemPrompt = agentPrompt
    ? agentPrompt.replace(/TODAY_DATE/g, today)
    : `You are an AI operations monitor for LifeCircle, India's home healthcare company.

Analyze the Slack messages below and identify:
1. Issues or problems mentioned
2. Pending tasks or action items
3. Escalations or urgent matters
4. Overall team activity summary

Today: ${today}

Be concise and actionable. Use plain text with emoji for readability.`;

  const userMessage = `Slack channel messages for the monitored period:\n\n${sections}`;
  maltiLogger.debug(LOG, "Prompt built", {
    system_chars: systemPrompt.length,
    user_chars:   userMessage.length,
  });
  return { systemPrompt, userMessage };
}

// ── Report formatter ──────────────────────────────────────────────────────

function formatReport(agentName, icon, channelData, ollamaResponse, durationS) {
  const ist = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const totalMsgs  = channelData.reduce((s, { messages }) => s + messages.length, 0);
  const chList     = channelData.map(({ channel }) => `#${channel}`).join(", ");

  let report = `${icon} *${agentName}*\n`;
  report    += `📊 _${totalMsgs} messages from ${chList} · ${durationS}s · ${ist} IST_\n`;
  report    += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report    += ollamaResponse;

  if (report.length > 3900) {
    report = report.slice(0, 3850) + "\n\n_... truncated_";
  }
  return report;
}

// ── Main agent runner ─────────────────────────────────────────────────────

export async function runSlackMonitorAgent(agentKey, agent) {
  const start = Date.now();
  maltiLogger.info(LOG, `=== START: ${agentKey} ===`, {
    channels:       agent.channels,
    output_channel: agent.output_channel,
    lookback_hours: agent.lookback_hours ?? 24,
  });

  const channelData = [];
  const errors      = [];

  // ── Step 1: Fetch messages from all channels ─────────────────────────
  maltiLogger.info(LOG, `Step 1 — Fetching from ${(agent.channels ?? []).length} channels`);

  for (const channel of (agent.channels ?? [])) {
    try {
      const messages = await fetchChannelMessages(channel, agent.lookback_hours ?? 24);
      channelData.push({ channel, messages });
    } catch (err) {
      maltiLogger.error(LOG, `Channel fetch failed: #${channel}`, { error: String(err.message ?? err) });
      errors.push(`#${channel}: ${err.message}`);
      channelData.push({ channel, messages: [] });
    }
  }

  const totalMessages = channelData.reduce((s, { messages }) => s + messages.length, 0);
  maltiLogger.info(LOG, `Step 1 complete`, {
    total_messages:   totalMessages,
    channels_fetched: channelData.length,
    errors:           errors.length,
  });

  if (totalMessages === 0) {
    maltiLogger.warn(LOG, "No messages found — skipping Ollama and Slack post");
    return {
      agent_key:  agentKey,
      agent_name: agent.name,
      generated:  new Date().toISOString(),
      status:     "ok",
      msg_count:  0,
      channels:   agent.channels,
      errors,
      data:       "_No messages found in monitored channels for this period._",
      duration_s: parseFloat(((Date.now() - start) / 1000).toFixed(1)),
    };
  }

  // ── Step 2: Build prompt → Ollama ────────────────────────────────────
  maltiLogger.info(LOG, `Step 2 — Sending ${totalMessages} messages to Ollama (${OLLAMA_MODEL})`);
  const { systemPrompt, userMessage } = buildPrompt(channelData, agent.prompt);

  let ollamaText;
  try {
    const { text, usage } = await callOllama(systemPrompt, userMessage);
    ollamaText = text;
    maltiLogger.info(LOG, `Step 2 complete — Ollama returned ${text.length} chars`, { usage });
  } catch (err) {
    maltiLogger.error(LOG, `Ollama failed`, { error: String(err.message ?? err) });
    errors.push(`Ollama: ${err.message}`);
    ollamaText = `_Ollama unavailable. Error: ${err.message}_\n\nRaw data: ${totalMessages} messages collected from ${channelData.length} channels.`;
  }

  // ── Step 3: Format and post to Slack ─────────────────────────────────
  maltiLogger.info(LOG, `Step 3 — Posting report to Slack`);
  const durationS    = parseFloat(((Date.now() - start) / 1000).toFixed(1));
  const reportText   = formatReport(
    agent.name  ?? "Slack Monitor",
    agent.icon  ?? "👁️",
    channelData,
    ollamaText,
    durationS,
  );
  const outputChannel = agent.output_channel ?? "tech_testing";

  maltiLogger.info(LOG, `Posting to #${outputChannel}`, { report_chars: reportText.length });
  try {
    await postSlackOutput(outputChannel, reportText);
    maltiLogger.info(LOG, `Report posted to #${outputChannel} successfully`);
  } catch (err) {
    maltiLogger.error(LOG, `Slack post failed`, { channel: outputChannel, error: String(err.message ?? err) });
    errors.push(`Slack post: ${err.message}`);
  }

  maltiLogger.info(LOG, `=== END: ${agentKey} ===`, {
    duration_s:     durationS,
    total_messages: totalMessages,
    error_count:    errors.length,
  });

  return {
    agent_key:  agentKey,
    agent_name: agent.name,
    generated:  new Date().toISOString(),
    status:     errors.length > 0 ? "partial" : "ok",
    msg_count:  totalMessages,
    channels:   agent.channels,
    errors,
    data:       ollamaText,
    duration_s: durationS,
  };
}
