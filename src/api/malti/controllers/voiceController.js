import { legacyPool } from "../models/db.js";

const BOLNA_API    = "https://api.bolna.dev";
const BOLNA_API_V2 = "https://api.bolna.ai";
const VAPI_API     = "https://api.vapi.ai";

async function bolnaApi(method, endpoint, body = null) {
  const apiKey = process.env.BOLNA_API_KEY;
  if (!apiKey) throw new Error("BOLNA_API_KEY not set");
  const opts = {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BOLNA_API}${endpoint}`, opts);
  return res.json().catch(() => ({}));
}

async function bolnaV2Api(method, endpoint, body = null) {
  const apiKey = process.env.BOLNA_API_KEY;
  if (!apiKey) throw new Error("BOLNA_API_KEY not set");
  const opts = {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BOLNA_API_V2}${endpoint}`, opts);
  return res.json().catch(() => ({}));
}

async function vapiApi(method, endpoint, body = null) {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) throw new Error("VAPI_API_KEY not set");
  const opts = {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${VAPI_API}${endpoint}`, opts);
  return res.json().catch(() => ({}));
}

export async function getBolnaCalls(req, res) {
  if (!process.env.BOLNA_API_KEY) {
    return res.json({ success: true, calls: [], warning: "BOLNA_API_KEY not configured" });
  }
  try {
    const data = await bolnaApi("GET", "/v1/executions?limit=20");
    return res.json({ success: true, calls: data });
  } catch (err) {
    return res.json({ success: true, calls: [], warning: String(err.message ?? err) });
  }
}

export async function makeBolnaCall(req, res) {
  const { phone, user_data } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: "phone required" });
  try {
    const agentId = process.env.BOLNA_AGENT_ID;
    if (!agentId) return res.status(500).json({ success: false, error: "BOLNA_AGENT_ID not set" });
    const data = await bolnaApi("POST", "/v1/agent/execute", {
      agent_id: agentId,
      recipient_phone_number: phone,
      user_data: user_data ?? {},
    });
    return res.json({ success: true, execution: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getVapiCalls(req, res) {
  const { limit = 20 } = req.query;
  try {
    const data = await vapiApi("GET", `/call?limit=${limit}`);
    return res.json({ success: true, calls: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function bolnaWebhook(req, res) {
  const data = req.body;
  const event = data.event ?? data.type ?? "unknown";
  // Log to care jobs if execution_id present
  return res.json({ success: true, event, received: true });
}

export async function getBolnaAgentsList(req, res) {
  if (!process.env.BOLNA_API_KEY) {
    return res.json({ success: true, agents: [], warning: "BOLNA_API_KEY not configured" });
  }
  try {
    // 1. Try list endpoint — handle all known Bolna response shapes
    const data = await bolnaApi("GET", "/v1/agent?limit=20");
    let agents = Array.isArray(data)
      ? data
      : (data.agents ?? data.data ?? data.items ?? data.results ?? data.agent_list ?? []);

    // 2. Fallback: if list empty, fetch each configured agent by ID individually
    if (agents.length === 0) {
      const ids = [process.env.BOLNA_AGENT_ID, process.env.BOLNA_SCREENING_AGENT_ID]
        .filter(Boolean);
      const fetched = await Promise.all(
        ids.map(id => bolnaApi("GET", `/v1/agent/${id}`).catch(() => null))
      );
      agents = fetched.filter(a => a && !a.error);
    }

    return res.json({ success: true, agents });
  } catch (err) {
    return res.json({ success: true, agents: [], warning: String(err.message ?? err) });
  }
}

export async function getBolnaAgent(req, res) {
  const { agentId } = req.params;
  if (!process.env.BOLNA_API_KEY)
    return res.status(500).json({ success: false, error: "BOLNA_API_KEY not configured" });
  if (!agentId)
    return res.status(400).json({ success: false, error: "agentId required" });
  try {
    const data = await bolnaV2Api("GET", `/v2/agent/${agentId}`);
    return res.json({ success: true, agent: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function updateBolnaAgent(req, res) {
  const { agentId } = req.params;
  if (!process.env.BOLNA_API_KEY)
    return res.status(500).json({ success: false, error: "BOLNA_API_KEY not configured" });
  if (!agentId)
    return res.status(400).json({ success: false, error: "agentId required" });
  try {
    // req.body = { agent_config: {...}, agent_prompts: {...} }
    const data = await bolnaV2Api("PUT", `/v2/agent/${agentId}`, req.body);
    return res.json({ success: true, agent: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getBolnaHistory(req, res) {
  const { agent_type, status, phone, page = 1, limit = 50 } = req.query;
  try {
    const offset = (Number(page) - 1) * Number(limit);
    let where = "WHERE 1=1";
    const params = [];
    if (agent_type) { where += " AND b.agent_type = ?"; params.push(agent_type); }
    if (status)     { where += " AND b.status = ?";     params.push(status); }
    if (phone)      { where += " AND b.phone LIKE ?";   params.push(`%${phone}%`); }

    // LEFT JOIN candidates to get recording URL fallback (b.recording_url may be NULL)
    const [rawRows] = await legacyPool.query(
      `SELECT b.*, c.call_recording_url AS _cg_recording_url
       FROM n_bolna_activity_log b
       LEFT JOIN n_care_jobs_candidates c ON b.lead_id = c.id
       ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [[{ total }]] = await legacyPool.query(
      `SELECT COUNT(*) AS total FROM n_bolna_activity_log b ${where}`,
      params
    );

    // Merge recording URL: prefer b.recording_url, fall back to c.call_recording_url
    const rows = rawRows.map(({ _cg_recording_url, ...r }) => ({
      ...r,
      recording_url: r.recording_url || _cg_recording_url || null,
    }));

    return res.json({ success: true, data: rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getBolnaErrors(req, res) {
  const { agent_type, page = 1, limit = 50 } = req.query;
  try {
    const offset = (Number(page) - 1) * Number(limit);
    let where = "WHERE b.has_error = 1";
    const params = [];
    if (agent_type) { where += " AND b.agent_type = ?"; params.push(agent_type); }

    const [rawRows] = await legacyPool.query(
      `SELECT b.*, c.call_recording_url AS _cg_recording_url
       FROM n_bolna_activity_log b
       LEFT JOIN n_care_jobs_candidates c ON b.lead_id = c.id
       ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [[{ total }]] = await legacyPool.query(
      `SELECT COUNT(*) AS total FROM n_bolna_activity_log b ${where}`,
      params
    );
    const rows = rawRows.map(({ _cg_recording_url, ...r }) => ({
      ...r,
      recording_url: r.recording_url || _cg_recording_url || null,
    }));
    return res.json({ success: true, data: rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getBolnaTimeline(req, res) {
  const { type, id } = req.query;
  if (!type || !id) return res.status(400).json({ success: false, error: "type and id are required" });
  try {
    const col = type === "cg" ? "b.cg_id" : "b.lead_id";
    const [rawRows] = await legacyPool.query(
      `SELECT b.*, c.call_recording_url AS _cg_recording_url
       FROM n_bolna_activity_log b
       LEFT JOIN n_care_jobs_candidates c ON b.lead_id = c.id
       WHERE ${col} = ? ORDER BY b.created_at ASC`,
      [id]
    );
    const rows = rawRows.map(({ _cg_recording_url, ...r }) => ({
      ...r,
      recording_url: r.recording_url || _cg_recording_url || null,
    }));
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}
