import * as AgentModel from "../models/AgentModel.js";
import { postSlackWebhook } from "./slackController.js";

export async function propose(req, res) {
  const { agent_key, operation, target_table, data, where_clause, reason } = req.body;
  if (!agent_key || !operation || !target_table || !data) {
    return res.status(400).json({ success: false, error: "agent_key, operation, target_table, data required" });
  }
  try {
    const result = await AgentModel.proposeDBWrite({ agentKey: agent_key, operation, targetTable: target_table, data, whereClause: where_clause, reason });

    // Notify Slack
    const webhookUrl = process.env.SLACK_WEBHOOK_DB_APPROVALS;
    if (webhookUrl) {
      await postSlackWebhook(webhookUrl,
        `🔐 DB Write Request\nAgent: ${agent_key} | Op: ${operation.toUpperCase()} | Table: ${target_table}\nReason: ${reason ?? "N/A"}\nSQL Preview: \`${result.sql_preview}\`\nRequest ID: \`${result.id}\``
      ).catch(() => null);
    }

    return res.status(201).json({ success: true, request_id: result.id, sql_preview: result.sql_preview });
  } catch (err) {
    return res.status(400).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function list(req, res) {
  const { status, agent_key, limit = 50 } = req.query;
  try {
    const requests = await AgentModel.listDBWriteRequests(status ?? null, agent_key ?? null, Number(limit));
    return res.json({ success: true, requests });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getOne(req, res) {
  try {
    const request = await AgentModel.getDBWriteRequest(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: "Request not found" });
    return res.json({ success: true, request });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function approve(req, res) {
  const { actioned_by } = req.body;
  if (!actioned_by) return res.status(400).json({ success: false, error: "actioned_by required" });
  try {
    const result = await AgentModel.actionDBWriteRequest(req.params.id, "approve", actioned_by);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function reject(req, res) {
  const { actioned_by, reason } = req.body;
  if (!actioned_by) return res.status(400).json({ success: false, error: "actioned_by required" });
  try {
    await AgentModel.actionDBWriteRequest(req.params.id, "reject", actioned_by, reason);
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ success: false, error: String(err.message ?? err) });
  }
}
