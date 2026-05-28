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

function normalizeBolnaExecution(e) {
  const telephony = e.telephony_data ?? {};
  const phone = telephony.to_number ?? telephony.from_number ?? e.recipient_phone_number ?? e.user_number ?? e.to_number ?? e.phone ?? null;
  return {
    execution_id:     e.execution_id ?? e.id,
    phone,
    status:           (e.status ?? '').toLowerCase().replace(/-/g, '_'),
    duration_seconds: e.conversation_duration ?? e.conversation_time ?? e.duration ?? e.duration_seconds ?? 0,
    agent_type:       'voice_call',
    has_error:        !!(e.error_info ?? e.error ?? e.error_message),
    error_message:    e.error_info?.message ?? e.error_message ?? null,
    recording_url:    telephony.recording_url ?? e.recording_url ?? e.audio_url ?? null,
    call_summary:     e.summary ?? e.transcript_summary ?? null,
    created_at:       e.created_at ?? e.initiated_at ?? e.start_time ?? null,
    completed_at:     e.ended_at ?? e.end_time ?? null,
    ...e,
  };
}

export async function getBolnaHistory(req, res) {
  const { status, phone, page = 1, limit = 50 } = req.query;
  if (!process.env.BOLNA_API_KEY) {
    return res.json({ success: true, data: [], total: 0, page: 1 });
  }
  try {
    const agentIds = [process.env.BOLNA_AGENT_ID, process.env.BOLNA_SCREENING_AGENT_ID].filter(Boolean);
    if (!agentIds.length) return res.json({ success: true, data: [], total: 0, page: Number(page) });

    const pageSize = Math.min(Number(limit), 50);
    const pageNum  = Number(page);

    const qs = new URLSearchParams({ page_number: pageNum, page_size: pageSize });
    if (status) qs.set('status', status);

    const results = await Promise.all(
      agentIds.map(id =>
        bolnaV2Api("GET", `/v2/agent/${id}/executions?${qs}`)
          .catch(() => ({ executions: [], total: 0 }))
      )
    );

    let rows = results
      .flatMap(r => Array.isArray(r) ? r : (r.executions ?? r.data ?? r.results ?? []))
      .map(normalizeBolnaExecution);

    const total = results.reduce((sum, r) => sum + (r.total ?? r.total_count ?? 0), 0);

    if (phone) rows = rows.filter((r) => (r.phone ?? '').includes(phone));

    return res.json({ success: true, data: rows, total: total || rows.length, page: pageNum, limit: pageSize });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getBolnaErrors(req, res) {
  if (!process.env.BOLNA_API_KEY) {
    return res.json({ success: true, data: [], total: 0, page: 1 });
  }
  try {
    const { page = 1 } = req.query;
    const agentIds = [process.env.BOLNA_AGENT_ID, process.env.BOLNA_SCREENING_AGENT_ID].filter(Boolean);
    if (!agentIds.length) return res.json({ success: true, data: [], total: 0, page: 1 });

    const qs = new URLSearchParams({ page_number: Number(page), page_size: 50, status: 'error' });

    const results = await Promise.all(
      agentIds.map(id =>
        bolnaV2Api("GET", `/v2/agent/${id}/executions?${qs}`)
          .catch(() => ({ executions: [] }))
      )
    );

    const rows = results
      .flatMap(r => Array.isArray(r) ? r : (r.executions ?? r.data ?? []))
      .map(normalizeBolnaExecution)
      .filter((r) => r.has_error || r.status === 'error' || r.status === 'failed');

    return res.json({ success: true, data: rows, total: rows.length, page: Number(page), limit: 50 });
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
