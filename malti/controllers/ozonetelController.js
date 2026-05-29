import { normalizeInboundData, processInboundLead } from "./inboundController.js";

// In-memory call map: call_id → { contact_id, score, channel }
const callMap = new Map();

export async function handleWebhook(req, res) {
  const data = req.body;
  const secret = process.env.OZONETEL_WEBHOOK_SECRET;
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }

  const event = data.event ?? data.EventName ?? "incoming";

  try {
    switch (event.toLowerCase()) {
      case "incoming":
      case "call_incoming":
        return handleIncoming(data, res);
      case "answered":
      case "call_answered":
        return handleAnswered(data, res);
      case "ended":
      case "call_ended":
      case "disconnected":
        return handleEnded(data, res);
      case "transcript":
      case "transcription_available":
        return handleTranscript(data, res);
      default:
        return res.json({ success: true, event, handled: false });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

async function handleIncoming(data, res) {
  const callId = data.call_id ?? data.CallId;
  const phone = data.CallerNumber ?? data.caller_number;

  callMap.set(callId, { phone, started_at: Date.now() });

  // Return TTS greeting for Ozonetel IVR
  return res.json({
    success: true,
    action: "PlayTTS",
    text: "Welcome to LifeCircle. Please hold while we connect you.",
    call_id: callId,
  });
}

async function handleAnswered(data, res) {
  const callId = data.call_id ?? data.CallId;
  if (callMap.has(callId)) {
    callMap.get(callId).answered_at = Date.now();
  }
  return res.json({ success: true, action: "Continue" });
}

async function handleEnded(data, res) {
  const callId = data.call_id ?? data.CallId;
  const entry = callMap.get(callId) ?? {};
  const duration = data.duration ?? data.Duration ?? 0;

  callMap.delete(callId);

  return res.json({
    success: true,
    call_id: callId,
    duration,
    disposition: data.disposition ?? data.CallStatus ?? "unknown",
    phone: entry.phone ?? null,
  });
}

async function handleTranscript(data, res) {
  const callId = data.call_id ?? data.CallId;
  const transcript = data.transcript ?? data.Transcript ?? "";
  const phone = data.CallerNumber ?? data.caller_number ?? callMap.get(callId)?.phone;

  if (phone && transcript) {
    // Feed transcript through inbound lead processor
    const fakeReq = {
      body: {
        channel: "ozonetel",
        CallerNumber: phone,
        CallerName: data.CallerName ?? null,
        circle: data.circle ?? null,
        transcript,
        call_id: callId,
      },
    };
    const fakeRes = { json: () => {}, status: () => ({ json: () => {} }) };
    await processInboundLead(fakeReq, fakeRes);
  }

  return res.json({ success: true, call_id: callId, transcript_length: transcript.length });
}
