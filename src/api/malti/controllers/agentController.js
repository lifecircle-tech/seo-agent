import * as AgentModel from "../models/AgentModel.js";
import { getAllAgents, generateReport, formatReportForSlack, postReportToSlack } from "./agentReportsController.js";

// ── Training ───────────────────────────────────────────────────────────────
export async function getTraining(req, res) {
  try {
    const data = await AgentModel.loadTrainingData(req.params.agentKey);
    return res.json({ success: true, training: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function saveTraining(req, res) {
  const { training } = req.body;
  if (!training) return res.status(400).json({ success: false, error: "training object required" });
  try {
    await AgentModel.saveTrainingData(req.params.agentKey, training);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getTrainingSummary(req, res) {
  try {
    const data = await AgentModel.loadTrainingData(req.params.agentKey);
    return res.json({
      success: true,
      summary: {
        documents: data.documents?.length ?? 0,
        policies: data.policies?.length ?? 0,
        faqs: data.faqs?.length ?? 0,
        has_context: !!data.company_context,
        has_values: !!data.company_values,
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getTrainingContext(req, res) {
  try {
    const data = await AgentModel.loadTrainingData(req.params.agentKey);
    const context = AgentModel.buildTrainingContext(data);
    return res.json({ success: true, context });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

// ── Run History ────────────────────────────────────────────────────────────
export async function logRunHistory(req, res) {
  const { agent_key, status, duration_s, msg_count, channel, error } = req.body;
  if (!agent_key || !status) return res.status(400).json({ success: false, error: "agent_key and status required" });
  try {
    await AgentModel.logRun(agent_key, status, { duration_s, msg_count, channel, error });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getHistory(req, res) {
  const { agent_key, limit = 50 } = req.query;
  try {
    const history = await AgentModel.getRunHistory(agent_key ?? null, Number(limit));
    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getStats(req, res) {
  try {
    const stats = await AgentModel.getAgentStats();
    return res.json({ success: true, stats });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

// ── Schedule CRUD ──────────────────────────────────────────────────────────
export async function getSchedules(req, res) {
  try {
    const schedules = await AgentModel.getAllSchedules();
    return res.json({ success: true, schedules });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function saveSchedule(req, res) {
  const { key } = req.params;
  const { enabled, times, days, target_channel } = req.body;
  try {
    await AgentModel.saveAgentSchedule(key, { enabled: !!enabled, times: times ?? [], days: days ?? [1,2,3,4,5], target_channel: target_channel ?? "tech_testing" });
    return res.json({ success: true, agent_key: key });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function toggleSchedule(req, res) {
  const { key } = req.params;
  try {
    const current = await AgentModel.getAgentSchedule(key);
    current.enabled = !current.enabled;
    await AgentModel.saveAgentSchedule(key, current);
    return res.json({ success: true, agent_key: key, enabled: current.enabled });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

// ── Cron — internal runner (called by Express handler AND node-cron) ───────
let cronRunning = false;

export async function runScheduledAgents() {
  if (cronRunning) return { skipped_all: true, reason: "already_running" };
  cronRunning = true;
  const cronStart = Date.now();

  try {
    // IST time
    const istStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const ist    = new Date(istStr);
    const nowH   = ist.getHours();
    const nowM   = ist.getMinutes();
    const nowDay = ist.getDay(); // 0=Sun … 6=Sat
    const dateStr = new Date().toISOString().slice(0, 10);

    const results = {}, skipped = {};

    const [allAgents, schedules] = await Promise.all([
      getAllAgents(),
      AgentModel.getAllSchedules(),
    ]);

    for (const [key, agent] of Object.entries(allAgents)) {
      // Must have prompt and channels to be schedulable
      if (!agent.prompt || !agent.channels?.length) { skipped[key] = "no_prompt_or_channels"; continue; }

      const sched = schedules[key];
      if (!sched?.enabled) { skipped[key] = "disabled"; continue; }

      const times = sched.times ?? [];
      if (!times.length) { skipped[key] = "no_times_configured"; continue; }

      const days = sched.days ?? [1,2,3,4,5];
      if (!days.includes(nowDay)) { skipped[key] = `wrong_day (today=${nowDay} allowed=${days.join(",")})`; continue; }

      // Find a scheduled time within ±4 minutes of now
      let matched = false, matchedTime = "", closestDiff = 9999;
      for (const t of times) {
        const [h, m] = t.split(":").map(Number);
        const diff = Math.abs(nowH * 60 + nowM - (h * 60 + m));
        if (diff < closestDiff) closestDiff = diff;
        if (diff <= 4) { matched = true; matchedTime = t; break; }
      }
      if (!matched) {
        skipped[key] = `time_not_matched (now=${String(nowH).padStart(2,"0")}:${String(nowM).padStart(2,"0")} scheduled=${times.join(",")} closest=${closestDiff}min)`;
        continue;
      }

      // Dedup: one run per scheduled time slot per day
      const lockWindow = `${dateStr}_${matchedTime}`;
      if (await AgentModel.checkCronLock(key, lockWindow)) { skipped[key] = "already_ran_this_window"; continue; }

      // Dependency check: each dep must have run today
      let depsOk = true;
      for (const dep of agent.depends_on ?? []) {
        const history = await AgentModel.getRunHistory(dep, 1);
        const last = history[0];
        if (!last) { depsOk = false; break; }
        const runDate = last.created_at instanceof Date
          ? last.created_at.toISOString().slice(0, 10)
          : String(last.created_at).slice(0, 10);
        if (runDate !== dateStr) { depsOk = false; break; }
      }
      if (!depsOk) { skipped[key] = "dependency_not_met"; continue; }

      const targetChannel = sched.target_channel ?? agent.output_channel ?? "tech_testing";

      try {
        const report = await generateReport(key, false, allAgents);
        if (report.status === "ok") {
          const slackMsg = formatReportForSlack(agent, report);
          const r = await postReportToSlack(targetChannel, slackMsg, agent.personality?.display_name ?? "LifeCircle AI", agent.icon ?? ":robot_face:");
          results[key] = r.ok ? `posted to #${targetChannel}` : `post_failed: ${r.error ?? ""}`;
          await AgentModel.logRun(key, "success", { duration_s: report.duration_s, msg_count: report.msg_count ?? 0, channel: targetChannel });
        } else {
          results[key] = `error: ${report.errors?.join("; ") ?? "unknown"}`;
          await AgentModel.logRun(key, "error", { error: report.errors?.join("; ") ?? "unknown", channel: targetChannel });
        }
        await AgentModel.setCronLock(key, lockWindow);
      } catch (err) {
        results[key] = `exception: ${String(err.message ?? err)}`;
        await AgentModel.logRun(key, "error", { error: String(err.message ?? err), channel: targetChannel });
      }
    }

    await AgentModel.purgeStaleCronLocks();

    cronRunning = false;
    return {
      time: `${String(nowH).padStart(2,"0")}:${String(nowM).padStart(2,"0")}`,
      day: nowDay,
      results,
      skipped,
      duration_ms: Date.now() - cronStart,
    };
  } catch (err) {
    cronRunning = false;
    throw err;
  }
}

export async function runCron(req, res) {
  try {
    const result = await runScheduledAgents();
    if (result.skipped_all) return res.json({ success: false, message: result.reason });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export function getCronStatus(_req, res) {
  return res.json({ success: true, running: cronRunning });
}
