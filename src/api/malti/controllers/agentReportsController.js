import { callClaude }            from "./claudeController.js";
import { runSlackMonitorAgent }  from "./slackMonitorController.js";
import { maltiLogger }           from "../utils/maltiLogger.js";
import * as AgentModel           from "../models/AgentModel.js";

const LOG = "AGENT_REPORTS";

// ── Static AGENTS config (mirrors PHP $CONFIG['AGENTS']) ──────────────────
export const STATIC_AGENTS = {
  vapi_hourly_report: {
    name: "VAPI Call Report",
    version: "v1",
    type: "vapi_report",
    status: "operational",
    icon: "📞",
    color: "green",
    tier: 1,
    agent_type: "voice_intel",
    channels: ["tech_testing"],
    depends_on: [],
    personality: { display_name: "VAPI Call Report", tone: "concise, actionable", style: "operational", avatar: "📞" },
    prompt: `You are a voice call analyst for LifeCircle, India's home healthcare company.

Analyse the VAPI call logs below and return a JSON report.

Return ONLY valid JSON (no markdown):
{
  "report_date": "YYYY-MM-DD HH:MM IST",
  "total_calls": 0,
  "total_duration_min": 0,
  "total_cost_usd": "0.0000",
  "avg_duration_sec": 0,
  "hot_leads": [{"phone":"+91...","duration_s":0,"summary":"brief","action":"call back"}],
  "callbacks_needed": [{"phone":"+91...","reason":"brief"}],
  "resolved": [{"phone":"+91...","outcome":"brief"}],
  "unresolved": [{"phone":"+91...","issue":"brief"}],
  "missed_short": [{"phone":"+91...","duration_s":0}],
  "top_issues": ["issue 1","issue 2"],
  "recommendations": ["action 1","action 2"],
  "sentiment_summary": "Overall tone across calls",
  "status": "Normal | Needs Attention | Critical"
}

Today: TODAY_DATE`,
    output_channel: "tech_testing",
  },

  vapi_call_intelligence: {
    name: "VAPI Call Intelligence",
    version: "v1",
    type: "vapi_live_report",
    status: "operational",
    icon: "📲",
    color: "teal",
    tier: 2,
    agent_type: "voice_intel",
    channels: ["tech_testing"],
    depends_on: [],
    call_limit: 50,
    personality: { display_name: "VAPI Call Intelligence", tone: "concise, actionable", style: "data-driven, clear", avatar: "📲" },
    prompt: `You are a voice call analyst for LifeCircle, India's home healthcare company.

Analyse the VAPI call logs below and return a JSON report.

Return ONLY valid JSON (no markdown):
{
  "report_date": "YYYY-MM-DD HH:MM IST",
  "total_calls": 0,
  "total_duration_min": 0,
  "total_cost_usd": "0.0000",
  "avg_duration_sec": 0,
  "hot_leads": [{"phone":"+91...","duration_s":0,"summary":"brief","action":"call back"}],
  "callbacks_needed": [{"phone":"+91...","reason":"brief"}],
  "resolved": [{"phone":"+91...","outcome":"brief"}],
  "unresolved": [{"phone":"+91...","issue":"brief"}],
  "missed_short": [{"phone":"+91...","duration_s":0}],
  "top_issues": ["issue 1","issue 2"],
  "recommendations": ["action 1","action 2"],
  "sentiment_summary": "Overall tone across calls",
  "status": "Normal | Needs Attention | Critical"
}

Today: TODAY_DATE`,
    output_channel: "tech_testing",
  },

  bolna_hourly_report: {
    name: "Bolna Call Report",
    version: "v1",
    type: "bolna_report",
    status: "operational",
    icon: "🤖",
    color: "purple",
    tier: 1,
    agent_type: "voice_intel",
    channels: ["tech_testing"],
    depends_on: [],
    personality: { display_name: "Bolna Call Report", tone: "concise, actionable", style: "operational", avatar: "🤖" },
    prompt: `You are a voice call analyst for LifeCircle, India's home healthcare company.

Analyse the Bolna call logs below and return a JSON report.

Return ONLY valid JSON (no markdown):
{
  "report_date": "YYYY-MM-DD HH:MM IST",
  "total_calls": 0,
  "total_duration_min": 0,
  "total_cost_cents": 0,
  "avg_duration_sec": 0,
  "hot_leads": [{"phone":"+91...","duration_s":0,"summary":"brief","action":"call back"}],
  "callbacks_needed": [{"phone":"+91...","reason":"brief"}],
  "resolved": [{"phone":"+91...","outcome":"brief"}],
  "unresolved": [{"phone":"+91...","issue":"brief"}],
  "missed_short": [{"phone":"+91...","duration_s":0}],
  "top_issues": ["issue 1","issue 2"],
  "recommendations": ["action 1","action 2"],
  "sentiment_summary": "Overall tone across calls",
  "status": "Normal | Needs Attention | Critical"
}

Today: TODAY_DATE`,
    output_channel: "tech_testing",
  },

  cg_screening: {
    name: "Care Jobs — CG/Nurse Candidate Screening",
    version: "v1",
    type: "bolna_screening",
    status: "operational",
    icon: "🧑‍⚕️",
    color: "teal",
    tier: 1,
    agent_type: "voice_screening",
    channels: ["tech_testing"],
    depends_on: [],
    personality: { display_name: "Mallika (CG Screening)", tone: "warm, professional, respectful", style: "structured, empathetic", avatar: "🧑‍⚕️" },
    output_channel: "tech_testing",
    prompt: `You are a candidate screening analyst for LifeCircle, India's home healthcare company.

Analyse the Bolna screening calls below for caregiver/nurse candidates and return a JSON report.

Return ONLY valid JSON (no markdown):
{
  "report_date": "YYYY-MM-DD HH:MM IST",
  "total_calls": 0,
  "total_duration_min": 0,
  "qualified_candidates": [{"phone":"+91...","name":"name","city":"city","role":"caregiver|nurse","exp_years":0,"shift":"live_in|live_out","rating":0,"action":"next step"}],
  "rejected_candidates": [{"phone":"+91...","reason":"brief reason"}],
  "app_downloads_confirmed": [{"phone":"+91..."}],
  "referrals_collected": [{"referee_phone":"+91...","referred_by":"+91..."}],
  "escalations": [{"phone":"+91...","reason":"brief"}],
  "pending_followup": [{"phone":"+91...","reason":"brief"}],
  "top_issues": ["issue 1","issue 2"],
  "recommendations": ["action 1","action 2"],
  "pipeline_summary": "Overall candidate pipeline health",
  "status": "Normal | Needs Attention | Critical"
}

Today: TODAY_DATE`,
  },

  bolna_call_intelligence: {
    name: "Bolna Call Intelligence",
    version: "v1",
    type: "bolna_live_report",
    status: "operational",
    icon: "🤖",
    color: "indigo",
    tier: 2,
    agent_type: "voice_intel",
    channels: ["tech_testing"],
    depends_on: [],
    call_limit: 50,
    personality: { display_name: "Bolna Call Intelligence", tone: "concise, actionable", style: "data-driven, clear", avatar: "🤖" },
    prompt: `You are a voice call analyst for LifeCircle, India's home healthcare company.

Analyse the Bolna call logs below and return a JSON report.

Return ONLY valid JSON (no markdown):
{
  "report_date": "YYYY-MM-DD HH:MM IST",
  "total_calls": 0,
  "total_duration_min": 0,
  "total_cost_cents": 0,
  "avg_duration_sec": 0,
  "hot_leads": [{"phone":"+91...","duration_s":0,"summary":"brief","action":"call back"}],
  "callbacks_needed": [{"phone":"+91...","reason":"brief"}],
  "resolved": [{"phone":"+91...","outcome":"brief"}],
  "unresolved": [{"phone":"+91...","issue":"brief"}],
  "missed_short": [{"phone":"+91...","duration_s":0}],
  "top_issues": ["issue 1","issue 2"],
  "recommendations": ["action 1","action 2"],
  "sentiment_summary": "Overall tone across calls",
  "status": "Normal | Needs Attention | Critical"
}

Today: TODAY_DATE`,
    output_channel: "tech_testing",
  },

  // ── Slack Channel Monitor — reads multiple channels via Ollama ──────────
  slack_channel_monitor: {
    name: "Slack Channel Monitor",
    version: "v1",
    type: "slack_channel_monitor",
    status: "operational",
    icon: "👁️",
    color: "blue",
    tier: 1,
    agent_type: "slack_intel",
    // channels = sources to READ from; output_channel = where to POST the report
    channels: (process.env.MONITOR_CHANNELS ?? "tech_testing").split(",").map(s => s.trim()),
    output_channel: process.env.MONITOR_OUTPUT_CHANNEL ?? "tech_testing",
    lookback_hours: parseInt(process.env.MONITOR_LOOKBACK_HOURS ?? "24", 10),
    depends_on: [],
    personality: {
      display_name: "Slack Monitor (Ollama)",
      tone:         "analytical, concise",
      style:        "structured, actionable",
      avatar:       "👁️",
    },
    prompt: `You are an AI operations monitor for LifeCircle, India's home healthcare company.

Analyze the Slack messages below from multiple channels and provide a structured report.

Identify and report on:
1. 🔴 Issues / Problems — anything broken, delayed, or blocked
2. 📋 Action Items — tasks that need follow-up or are pending
3. 🚨 Escalations — urgent matters needing immediate attention
4. 💬 Activity Summary — overall team communication health

Format your response clearly with these sections. Use bullet points. Be concise.
Flag severity as: [CRITICAL], [HIGH], [MEDIUM], or [LOW].

Today: TODAY_DATE`,
  },
};

// ── Merge static + DB custom agents with personality/channel overrides ────
export async function getAllAgents() {
  const [custom, personalities, channelOverrides] = await Promise.all([
    AgentModel.getCustomAgents(),
    AgentModel.getPersonalityOverrides(),
    AgentModel.getChannelOverrides(),
  ]);

  const all = { ...STATIC_AGENTS, ...custom };

  for (const key of Object.keys(all)) {
    if (personalities[key]) all[key] = { ...all[key], personality: { ...(all[key].personality ?? {}), ...personalities[key] } };
    if (channelOverrides[key]) all[key] = { ...all[key], output_channel: channelOverrides[key] };
  }

  return all;
}

// ── API helpers ───────────────────────────────────────────────────────────
async function fetchVapiCalls(limit = 50) {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) throw new Error("VAPI_API_KEY not set");
  const res = await fetch(`https://api.vapi.ai/call?limit=${limit}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Vapi API ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.data ?? []);
}

async function fetchBolnaExecutions(limit = 50) {
  const apiKey = process.env.BOLNA_API_KEY;
  if (!apiKey) throw new Error("BOLNA_API_KEY not set");
  const res = await fetch(`https://api.bolna.dev/v1/executions?limit=${limit}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Bolna API ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.data ?? json.executions ?? json.results ?? []);
}

async function fetchBolnaScreeningExecutions(limit = 30) {
  const apiKey = process.env.BOLNA_API_KEY;
  const agentId = process.env.BOLNA_SCREENING_AGENT_ID ?? process.env.BOLNA_AGENT_ID;
  if (!apiKey) throw new Error("BOLNA_API_KEY not set");
  if (!agentId) throw new Error("BOLNA_SCREENING_AGENT_ID not set");
  const res = await fetch(`https://api.bolna.ai/v2/agent/${agentId}/executions?page_number=1&page_size=${limit}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Bolna Screening API ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.results ?? json.data ?? []);
}

async function claudeJSON(systemPrompt, userMsg) {
  const raw = await callClaude(systemPrompt, userMsg, 4096);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

// ── Vapi analysis (shared between vapi_report and vapi_live_report) ────────
async function runVapiAnalysis(agentKey, agent, newCalls, cursorKey, start) {
  let totalSec = 0, totalCost = 0;
  const callLines = newCalls.map((c, i) => {
    const phone = c.customer?.number ?? c.phoneNumber?.number ?? "unknown";
    let dur = parseInt(c.duration ?? 0);
    if (!dur && c.startedAt && c.endedAt)
      dur = Math.max(0, Math.floor((new Date(c.endedAt) - new Date(c.startedAt)) / 1000));
    const cost = parseFloat(c.cost ?? 0);
    totalSec += dur; totalCost += cost;
    const messages = c.artifact?.messages ?? [];
    const transcript = c.artifact?.transcript ?? c.transcript ?? "";
    const snippet = messages.length
      ? messages.slice(0, 20).map(m => `[${(m.role ?? "?").toUpperCase()}] ${(m.message ?? m.content ?? "").slice(0, 120)}`).join("\n")
      : transcript.slice(0, 600);
    const dFmt = dur >= 60 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : `${dur}s`;
    return `--- Call ${i + 1} ---\nPhone: ${phone}\nDuration: ${dFmt}\nStatus: ${c.status ?? "ended"} | Reason: ${c.endedReason ?? "unknown"}\nCost: $${cost.toFixed(4)}\nStartedAt: ${c.startedAt ?? "—"}\n${snippet ? `Conversation:\n${snippet}\n` : "No transcript.\n"}`;
  });

  const istDate = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const prompt = (agent.prompt ?? "").replace(/TODAY_DATE/g, istDate);
  let analysis = await claudeJSON(prompt, `Total new calls: ${newCalls.length}\n\n${callLines.join("\n")}`);
  if (!analysis) analysis = { error: "Claude parse failed", total_calls: newCalls.length };

  await AgentModel.setCursor(cursorKey, { last_run_ts: Math.floor(Date.now() / 1000) });
  return makeReport(agentKey, agent, analysis, newCalls.length, start);
}

// ── Bolna analysis (shared between bolna_report, bolna_live_report, bolna_screening) ──
async function runBolnaAnalysis(agentKey, agent, newCalls, latestId, cursorKey, start) {
  const callsSummary = newCalls.slice(0, 30).map(c => {
    const tel = c.telephony_data ?? {};
    return {
      id: c.id ?? "",
      phone: tel.to_number ?? tel.from_number ?? c.batch_run_data?.recipient_phone_number ?? "",
      type: tel.call_type ?? c.call_type ?? "",
      duration_s: parseInt(c.conversation_duration ?? c.conversation_time ?? tel.duration ?? 0),
      status: c.status ?? "",
      cost_cents: c.total_cost ?? 0,
      transcript_snippet: (c.transcript ?? "").slice(0, 500),
      hangup_by: tel.hangup_by ?? "",
      voicemail: c.answered_by_voice_mail ?? false,
      extracted: c.extracted_data ?? {},
    };
  });

  const istDate = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const prompt = (agent.prompt ?? "").replace(/TODAY_DATE/g, istDate);
  let analysis = await claudeJSON(prompt, JSON.stringify(callsSummary, null, 2));
  if (!analysis) analysis = { error: "Claude parse failed", total_calls: newCalls.length };

  await AgentModel.setCursor(cursorKey, { last_execution_id: latestId, last_run: new Date().toISOString() });
  return makeReport(agentKey, agent, analysis, newCalls.length, start);
}

// ── Report generators by type ─────────────────────────────────────────────
async function generateVapiReport(agentKey, agent) {
  const start = Date.now();
  let calls;
  try { calls = await fetchVapiCalls(agent.call_limit ?? 50); }
  catch (err) { return makeErrorReport(agentKey, agent, err, start); }

  const cursor = await AgentModel.getCursor(`vapi_cursor_${agentKey}`);
  const lastTs = cursor.last_run_ts ?? null;
  const newCalls = lastTs ? calls.filter(c => new Date(c.startedAt ?? 0).getTime() / 1000 > lastTs) : calls;

  if (!newCalls.length) {
    await AgentModel.setCursor(`vapi_cursor_${agentKey}`, { last_run_ts: Math.floor(Date.now() / 1000) });
    return makeEmptyReport(agentKey, agent, "_No new VAPI calls since last run._", start);
  }
  return runVapiAnalysis(agentKey, agent, newCalls, `vapi_cursor_${agentKey}`, start);
}

async function generateVapiLiveReport(agentKey, agent) {
  const start = Date.now();
  let calls;
  try { calls = await fetchVapiCalls(agent.call_limit ?? 50); }
  catch (err) { return makeErrorReport(agentKey, agent, err, start); }

  const cursor = await AgentModel.getCursor(`vapi_live_cursor_${agentKey}`);
  const lastTs = cursor.last_run_ts ?? null;
  const newCalls = lastTs ? calls.filter(c => new Date(c.startedAt ?? 0).getTime() / 1000 > lastTs) : calls;

  if (!newCalls.length) {
    await AgentModel.setCursor(`vapi_live_cursor_${agentKey}`, { last_run_ts: Math.floor(Date.now() / 1000) });
    return makeEmptyReport(agentKey, agent, "_No new VAPI calls since last run._", start);
  }
  return runVapiAnalysis(agentKey, agent, newCalls, `vapi_live_cursor_${agentKey}`, start);
}

async function generateBolnaReport(agentKey, agent) {
  const start = Date.now();
  let allCalls;
  try { allCalls = await fetchBolnaExecutions(50); }
  catch (err) { return makeErrorReport(agentKey, agent, err, start); }
  if (!allCalls.length) return makeEmptyReport(agentKey, agent, "_No calls found in Bolna._", start);

  const cursor = await AgentModel.getCursor(`bolna_cursor_${agentKey}`);
  const lastId = cursor.last_execution_id ?? null;
  let newCalls = allCalls;
  if (lastId) {
    const idx = allCalls.findIndex(c => c.id === lastId);
    if (idx > 0) newCalls = allCalls.slice(0, idx);
  }
  if (!newCalls.length) {
    await AgentModel.setCursor(`bolna_cursor_${agentKey}`, { last_execution_id: allCalls[0]?.id, last_run: new Date().toISOString() });
    return makeEmptyReport(agentKey, agent, "_No new Bolna calls since last run._", start);
  }
  return runBolnaAnalysis(agentKey, agent, newCalls, allCalls[0]?.id, `bolna_cursor_${agentKey}`, start);
}

async function generateBolnaLiveReport(agentKey, agent) {
  const start = Date.now();
  let allCalls;
  try { allCalls = await fetchBolnaExecutions(agent.call_limit ?? 50); }
  catch (err) { return makeErrorReport(agentKey, agent, err, start); }
  if (!allCalls.length) return makeEmptyReport(agentKey, agent, "_No calls found in Bolna._", start);

  const cursor = await AgentModel.getCursor(`bolna_live_cursor_${agentKey}`);
  const lastId = cursor.last_execution_id ?? null;
  let newCalls = allCalls;
  if (lastId) {
    const idx = allCalls.findIndex(c => c.id === lastId);
    if (idx > 0) newCalls = allCalls.slice(0, idx);
  }
  if (!newCalls.length) {
    await AgentModel.setCursor(`bolna_live_cursor_${agentKey}`, { last_execution_id: allCalls[0]?.id, last_run: new Date().toISOString() });
    return makeEmptyReport(agentKey, agent, "_No new Bolna calls since last run._", start);
  }
  return runBolnaAnalysis(agentKey, agent, newCalls, allCalls[0]?.id, `bolna_live_cursor_${agentKey}`, start);
}

async function generateBolnaScreeningReport(agentKey, agent) {
  const start = Date.now();
  let allCalls;
  try { allCalls = await fetchBolnaScreeningExecutions(30); }
  catch (err) { return makeErrorReport(agentKey, agent, err, start); }
  if (!allCalls.length) return makeEmptyReport(agentKey, agent, "_No screening calls found._", start);

  const cursor = await AgentModel.getCursor(`bolna_screening_cursor_${agentKey}`);
  const lastId = cursor.last_execution_id ?? null;
  let newCalls = allCalls;
  if (lastId) {
    const idx = allCalls.findIndex(c => c.id === lastId);
    if (idx > 0) newCalls = allCalls.slice(0, idx);
  }
  if (!newCalls.length) {
    await AgentModel.setCursor(`bolna_screening_cursor_${agentKey}`, { last_execution_id: allCalls[0]?.id, last_run: new Date().toISOString() });
    return makeEmptyReport(agentKey, agent, "_No new screening calls since last run._", start);
  }
  return runBolnaAnalysis(agentKey, agent, newCalls, allCalls[0]?.id, `bolna_screening_cursor_${agentKey}`, start);
}

// ── Report dispatcher ─────────────────────────────────────────────────────
export async function generateReport(agentKey, forceRefresh = false, agentsParam = null) {
  const agents = agentsParam ?? await getAllAgents();
  const agent  = agents[agentKey];
  if (!agent) throw new Error(`Agent '${agentKey}' not found`);

  maltiLogger.info(LOG, `generateReport called`, { agentKey, type: agent.type, forceRefresh });

  switch (agent.type) {
    case "vapi_report":            return generateVapiReport(agentKey, agent);
    case "vapi_live_report":       return generateVapiLiveReport(agentKey, agent);
    case "bolna_report":           return generateBolnaReport(agentKey, agent);
    case "bolna_live_report":      return generateBolnaLiveReport(agentKey, agent);
    case "bolna_screening":        return generateBolnaScreeningReport(agentKey, agent);
    case "slack_channel_monitor":  return runSlackMonitorAgent(agentKey, agent);
    case "slack_bot":              return runSlackMonitorAgent(agentKey, agent);
    default: throw new Error(`Unknown agent type: ${agent.type}`);
  }
}

// ── Post to Slack (webhook first, bot token fallback) ──────────────────────
export async function postReportToSlack(channelKey, text, username = "LifeCircle AI", icon = ":robot_face:") {
  const envKey = `SLACK_WEBHOOK_${channelKey.toUpperCase().replace(/[-. ]/g, "_")}`;
  const webhookUrl = process.env[envKey];

  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, username, icon_emoji: icon }),
    });
    return { ok: res.ok, status: res.status };
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: `No webhook env ${envKey} and no SLACK_BOT_TOKEN` };
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: channelKey, text, username }),
  });
  const data = await res.json();
  return { ok: data.ok, error: data.error ?? null };
}

// ── Format report as Slack message ────────────────────────────────────────
export function formatReportForSlack(agent, report) {
  const data = report.data ?? {};
  const ist = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const icon = agent.icon ?? "🤖";
  const msgCount = report.msg_count ?? 0;
  const dur = report.duration_s ?? 0;
  const chCount = (report.channels ?? []).length;

  let txt = `${icon} *${agent.name ?? "Agent"}*\n📊 _${msgCount} messages from ${chCount} channels · ${dur}s · ${ist} IST_\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (typeof data === "string") return (txt + data).slice(0, 3900);
  if (!data || Object.keys(data).length === 0) return txt + "_No structured data returned._";

  txt += formatDataSection(data, 0);
  if (txt.length > 3900) txt = txt.slice(0, 3850) + "\n\n_... truncated_";
  return txt;
}

const STATUS_EMOJIS = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢", warning: "⚠️", info: "ℹ️", open: "🔴", in_progress: "🟡", resolved: "✅", success: "✅", error: "❌", pending: "⏳" };
const TOP_KEYS = ["executive_summary", "summary", "cross_agent_insights", "overall_star_rating", "tech_health_score", "report_date", "briefing_date"];

function formatDataSection(data, depth) {
  let txt = "";
  const ind = "  ".repeat(depth);

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    const label = key.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    if (Array.isArray(value) && value.length > 0) {
      if (typeof value[0] === "object" && value[0] !== null) {
        txt += `\n${ind}*${label}* (${value.length}):\n`;
        value.slice(0, 8).forEach((item, i) => {
          const parts = Object.entries(item)
            .filter(([, iv]) => iv !== null && iv !== "" && typeof iv !== "object")
            .map(([ik, iv]) => {
              const il = ik.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              if (["severity","level","priority","status","type"].includes(ik))
                return `${STATUS_EMOJIS[String(iv).toLowerCase()] ?? "▪️"} ${iv}`;
              return `*${il}:* ${iv}`;
            });
          txt += `${ind}  ${i + 1}. ${parts.join(" · ")}\n`;
        });
        if (value.length > 8) txt += `${ind}  _... +${value.length - 8} more_\n`;
      } else {
        txt += `\n${ind}*${label}:*\n`;
        value.slice(0, 10).forEach(v => { txt += `${ind}  • ${v}\n`; });
      }
    } else if (typeof value === "object" && !Array.isArray(value)) {
      txt += `\n${ind}*${label}:*\n${formatDataSection(value, depth + 1)}`;
    } else if (typeof value === "string" || typeof value === "number") {
      if (depth === 0 && TOP_KEYS.includes(key)) {
        if (["executive_summary","summary","cross_agent_insights"].includes(key)) txt += `\n💡 *${label}:* ${value}\n`;
        else if (key.includes("score") || key.includes("rating")) txt += `📈 *${label}:* ${value} ${"⭐".repeat(Math.min(Number(value) || 0, 5))}\n`;
        else txt += `📅 *${label}:* ${value}\n`;
      } else {
        txt += `${ind}▸ ${label}: *${value}*\n`;
      }
    } else if (typeof value === "boolean") {
      txt += `${ind}▸ ${label}: ${value ? "✅ Yes" : "❌ No"}\n`;
    }
  }
  return txt;
}

// ── Report shape helpers ──────────────────────────────────────────────────
function makeReport(agentKey, agent, data, msgCount, start) {
  return {
    agent_key: agentKey, agent_name: agent.name,
    generated: new Date().toISOString(), status: "ok",
    msg_count: msgCount, channels: agent.channels ?? [], errors: [],
    data, duration_s: parseFloat(((Date.now() - start) / 1000).toFixed(1)),
  };
}

function makeEmptyReport(agentKey, agent, message, start) {
  return { agent_key: agentKey, agent_name: agent.name, generated: new Date().toISOString(), status: "ok", msg_count: 0, channels: [], errors: [], data: message, duration_s: parseFloat(((Date.now() - start) / 1000).toFixed(1)) };
}

function makeErrorReport(agentKey, agent, err, start) {
  return { agent_key: agentKey, agent_name: agent.name, generated: new Date().toISOString(), status: "error", errors: [String(err.message ?? err)], data: [], duration_s: parseFloat(((Date.now() - start) / 1000).toFixed(1)) };
}

// ── Express route handlers ────────────────────────────────────────────────
export async function getAgentsList(req, res) {
  try {
    const [agents, schedules] = await Promise.all([getAllAgents(), AgentModel.getAllSchedules()]);
    const result = Object.entries(agents).map(([key, ag]) => ({
      key, name: ag.name, type: ag.type, icon: ag.icon ?? "🤖",
      status: ag.status ?? "operational", tier: ag.tier ?? 1,
      agent_type: ag.agent_type,
      personality: ag.personality ?? {},
      schedule: schedules[key] ?? { enabled: false, times: [], days: [1,2,3,4,5], target_channel: "tech_testing" },
    }));
    return res.json({ success: true, agents: result, count: result.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function runAgentReport(req, res) {
  const { key } = req.params;
  maltiLogger.info(LOG, `API run triggered for agent: ${key}`, { ip: req.ip });
  try {
    const agents = await getAllAgents();
    if (!agents[key]) {
      maltiLogger.warn(LOG, `Agent not found: ${key}`);
      return res.status(404).json({ success: false, error: `Agent '${key}' not found` });
    }
    const agent = agents[key];
    maltiLogger.info(LOG, `Running agent`, { key, type: agent.type, output_channel: agent.output_channel });

    const report = await generateReport(key, true, agents);
    maltiLogger.info(LOG, `Report generated`, { key, status: report.status, msg_count: report.msg_count, duration_s: report.duration_s });

    // slack_channel_monitor and slack_bot already post to Slack inside runSlackMonitorAgent
    let slack = { ok: true, note: "posted inside agent" };
    if (agent.type !== "slack_channel_monitor" && agent.type !== "slack_bot") {
      const text    = formatReportForSlack(agent, report);
      const channel = agent.output_channel ?? "tech_testing";
      slack         = await postReportToSlack(channel, text, agent.personality?.display_name ?? agent.name, agent.icon ?? ":robot_face:");
      maltiLogger.info(LOG, `Report posted to Slack`, { channel, ok: slack.ok });
    }

    await AgentModel.logRun(key, report.status === "ok" ? "success" : "error", {
      duration_s: report.duration_s, msg_count: report.msg_count ?? 0,
      channel: agent.output_channel ?? "tech_testing", error: report.errors?.[0] ?? null,
    });
    maltiLogger.info(LOG, `Run history logged for ${key}`);
    return res.json({ success: true, report, slack });
  } catch (err) {
    maltiLogger.error(LOG, `runAgentReport crashed`, { key, error: String(err.message ?? err) });
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function createCustomAgent(req, res) {
  const { agent_key, config } = req.body;
  if (!agent_key || !config) return res.status(400).json({ success: false, error: "agent_key and config required" });
  if (STATIC_AGENTS[agent_key]) return res.status(400).json({ success: false, error: "Cannot overwrite built-in agent" });
  try {
    await AgentModel.saveCustomAgent(agent_key, config);
    return res.json({ success: true, agent_key });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function updateCustomAgent(req, res) {
  const { key } = req.params;
  if (STATIC_AGENTS[key]) return res.status(400).json({ success: false, error: "Cannot modify built-in agent" });
  try {
    const custom = await AgentModel.getCustomAgents();
    if (!custom[key]) return res.status(404).json({ success: false, error: "Custom agent not found" });
    await AgentModel.saveCustomAgent(key, { ...custom[key], ...req.body });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function deleteCustomAgent(req, res) {
  const { key } = req.params;
  if (STATIC_AGENTS[key]) return res.status(400).json({ success: false, error: "Cannot delete built-in agent" });
  try {
    await AgentModel.deleteCustomAgent(key);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function savePersonality(req, res) {
  const { key } = req.params;
  const { personality } = req.body;
  if (!personality) return res.status(400).json({ success: false, error: "personality required" });
  try {
    await AgentModel.saveAgentPersonality(key, personality);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function saveChannelOverride(req, res) {
  const { key } = req.params;
  const { channel_key } = req.body;
  if (!channel_key) return res.status(400).json({ success: false, error: "channel_key required" });
  try {
    await AgentModel.saveChannelOverride(key, channel_key);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}
