import * as Campaign from "../models/CampaignModel.js";
import { callClaude } from "./claudeController.js";
import { sendWhatsAppTemplate } from "./whatsappController.js";

export async function create(req, res) {
  const { name, goal, briefing, outcome_definitions, rules, audience_source } = req.body;
  if (!name || !goal) return res.status(400).json({ success: false, error: "name and goal required" });
  try {
    const campaign = await Campaign.createCampaign({
      name, goal, briefing, outcome_definitions, rules, audience_source,
      created_by: req.user?.email ?? null
    });
    return res.status(201).json({ success: true, campaign });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function list(req, res) {
  const { status, limit = 50 } = req.query;
  try {
    const campaigns = await Campaign.listCampaigns(status ?? null, Number(limit));
    return res.json({ success: true, campaigns });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getOne(req, res) {
  try {
    const campaign = await Campaign.getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: "Campaign not found" });
    return res.json({ success: true, campaign });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function updateStatus(req, res) {
  const { status } = req.body;
  const valid = ["draft", "active", "paused", "completed", "cancelled"];
  if (!valid.includes(status)) return res.status(400).json({ success: false, error: "Invalid status" });
  try {
    await Campaign.updateCampaignStatus(req.params.id, status);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function addStage(req, res) {
  const { stage_num = 1, agent_key, channel, goal, rate_limit, follow_up_hours, max_follow_ups } = req.body;
  if (!agent_key) return res.status(400).json({ success: false, error: "agent_key required" });
  try {
    const stageId = await Campaign.addCampaignStage(req.params.id, stage_num, {
      agent_key, channel, goal, rate_limit, follow_up_hours, max_follow_ups
    });
    return res.status(201).json({ success: true, stage_id: stageId });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function addTasks(req, res) {
  const { contacts } = req.body;
  if (!Array.isArray(contacts) || !contacts.length) {
    return res.status(400).json({ success: false, error: "contacts array required" });
  }
  try {
    const count = await Campaign.addCampaignTasks(req.params.id, contacts);
    return res.status(201).json({ success: true, added: count });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function importCSV(req, res) {
  const csvText = req.body?.csv;
  if (!csvText) return res.status(400).json({ success: false, error: "csv body required" });
  try {
    const lines = csvText.split("\n").filter(Boolean);
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
    const contacts = lines.slice(1).map(line => {
      const vals = line.split(",").map(v => v.trim());
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ?? null; });
      return { name: obj.name ?? obj.full_name ?? null, phone: obj.phone ?? obj.mobile ?? null, email: obj.email ?? null };
    }).filter(c => c.phone || c.email);
    const count = await Campaign.addCampaignTasks(req.params.id, contacts);
    return res.json({ success: true, imported: count });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function listTasks(req, res) {
  const { status, limit = 100, offset = 0 } = req.query;
  try {
    const tasks = await Campaign.getTasksForCampaign(req.params.id, status ?? null, Number(limit), Number(offset));
    return res.json({ success: true, tasks });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function executeTask(req, res) {
  const { taskId } = req.params;
  try {
    const task = await Campaign.getTask(taskId);
    if (!task) return res.status(404).json({ success: false, error: "Task not found" });

    const campaign = await Campaign.getCampaign(task.campaign_id);
    const messages = task.messages ? (typeof task.messages === "string" ? JSON.parse(task.messages) : task.messages) : [];
    const historyText = messages.map(m => `[${m.direction}] ${m.text}`).join("\n") || "No prior messages.";

    const systemPrompt = `You are an AI sales agent for LifeCircle.
Campaign Goal: ${campaign.goal}
${campaign.briefing ? `Briefing: ${campaign.briefing}` : ""}
Respond ONLY in JSON: {"message": "...", "outcome": "interested|not_interested|no_response|needs_follow_up", "needs_human": false, "follow_up_days": 2}`;

    const userPrompt = `Contact: ${task.contact_name ?? "Unknown"}, Phone: ${task.contact_phone ?? "N/A"}
Conversation history:\n${historyText}
Generate the next outbound message.`;

    const raw = await callClaude(systemPrompt, userPrompt);
    let parsed = {};
    try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { parsed = { message: raw }; }

    const message = parsed.message ?? raw;
    await Campaign.appendTaskMessage(taskId, "outbound", message, "whatsapp");

    if (task.contact_phone && message) {
      await sendWhatsAppTemplate(task.contact_phone, "campaign_message", [message]).catch(() => null);
    }

    const newStatus = parsed.outcome && parsed.outcome !== "needs_follow_up" ? "completed" : "sent";
    await Campaign.updateTask(taskId, { status: newStatus, outcome: parsed.outcome ?? null });

    return res.json({ success: true, message, outcome: parsed.outcome, needs_human: parsed.needs_human ?? false });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function handleReply(req, res) {
  const { phone, email, text, channel = "whatsapp" } = req.body;
  if (!text) return res.status(400).json({ success: false, error: "text required" });
  try {
    const task = await Campaign.findTaskByContact(phone ?? null, email ?? null);
    if (!task) return res.json({ success: true, matched: false });

    await Campaign.appendTaskMessage(task.id, "inbound", text, channel);

    const campaign = await Campaign.getCampaign(task.campaign_id);
    const messages = task.messages ? (typeof task.messages === "string" ? JSON.parse(task.messages) : task.messages) : [];
    messages.push({ direction: "inbound", text, channel, ts: new Date().toISOString() });
    const historyText = messages.map(m => `[${m.direction}] ${m.text}`).join("\n");

    const systemPrompt = `You are an AI sales agent for LifeCircle.
Campaign Goal: ${campaign.goal}
Respond ONLY in JSON: {"reply": "...", "outcome": "interested|not_interested|needs_follow_up", "needs_human": false}`;

    const raw = await callClaude(systemPrompt, `Conversation:\n${historyText}\n\nGenerate reply to latest inbound message.`);
    let parsed = {};
    try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { parsed = { reply: raw }; }

    const reply = parsed.reply ?? raw;
    await Campaign.appendTaskMessage(task.id, "outbound", reply, channel);
    if (task.contact_phone && reply) {
      await sendWhatsAppTemplate(task.contact_phone, "campaign_reply", [reply]).catch(() => null);
    }

    return res.json({ success: true, matched: true, reply, outcome: parsed.outcome, needs_human: parsed.needs_human ?? false });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getMetrics(req, res) {
  try {
    const metrics = await Campaign.getCampaignMetrics(req.params.id);
    return res.json({ success: true, metrics });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}
