const BOLNA_API = "https://api.bolna.dev";
const VAPI_API  = "https://api.vapi.ai";

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
  try {
    const data = await bolnaApi("GET", "/v1/executions?limit=20");
    return res.json({ success: true, calls: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
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
