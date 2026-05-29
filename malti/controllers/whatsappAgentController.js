import { callClaude }          from "./claudeController.js";
import { sendWhatsAppTemplate } from "./whatsappController.js";
import { maltiLogger }          from "../utils/maltiLogger.js";
import { legacyPool }           from "../models/db.js";

const LOG = "WA_AGENT";

// ── DB lookups ────────────────────────────────────────────────────────────

async function lookupByPhone(phone) {
  const digits = phone.replace(/\D/g, "").slice(-10);

  const [cgRows] = await legacyPool.query(
    `SELECT lcd.id, lcd.fullname, lcd.city, lcp.current_status
     FROM life_cg_details lcd
     JOIN life_cg_personal lcp ON lcd.id = lcp.cg_id
     WHERE RIGHT(lcd.mobile, 10) = ? LIMIT 1`,
    [digits]
  );

  if (cgRows.length) {
    return { role: "cg", data: cgRows[0] };
  }

  const [userRows] = await legacyPool.query(
    `SELECT u.id, u.name, u.phone_number,
            b.id AS booking_id, b.status AS booking_status,
            b.service_start_date,
            hp.fullname AS hp_name
     FROM n_user u
     LEFT JOIN n_bookings b ON b.user_id = u.id AND b.status IN ('active','confirmed')
     LEFT JOIN n_hp_profile hp ON hp.id = b.hp_profile_id
     WHERE RIGHT(u.phone_number, 10) = ?
     ORDER BY b.created_at DESC LIMIT 1`,
    [digits]
  );

  if (userRows.length) {
    return { role: "customer", data: userRows[0] };
  }

  return { role: "unknown", data: null };
}

// ── Prompt builder ────────────────────────────────────────────────────────

function buildSystemPrompt(role, ctx) {
  const ist = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const base = `You are Malti, the WhatsApp assistant for LifeCircle, India's home healthcare company.
LifeCircle provides trained caregivers (CGs) to families needing home care for elderly or sick patients.

Today: ${ist}

Rules:
- Respond ONLY in plain text (no markdown, no symbols)
- Keep replies short — 2 to 4 sentences max
- Be warm and professional
- If you cannot answer, say: "I'll connect you with our team right away."
- Never make up booking dates or names`;

  if (role === "cg") {
    return `${base}

You are speaking with a caregiver (CG) named ${ctx.fullname} from ${ctx.city ?? "unknown city"}.
Their current status is: ${ctx.current_status}.
Help them with queries about their schedule, status, or connect them to their care manager.`;
  }

  if (role === "customer") {
    const bookingInfo = ctx.booking_id
      ? `Active booking #${ctx.booking_id}, status: ${ctx.booking_status}, caregiver: ${ctx.hp_name ?? "not yet assigned"}, service starts: ${ctx.service_start_date ?? "TBD"}.`
      : "No active booking found.";
    return `${base}

You are speaking with a client named ${ctx.name}.
${bookingInfo}
Help them with booking status, CG arrival, or connect them to their care manager.`;
  }

  return `${base}

This person is not yet registered in our system.
Ask for their name and city, and let them know we'll have a team member reach out.`;
}

// ── Interakt free-text reply ──────────────────────────────────────────────

async function sendTextReply(phone, text) {
  const apiKey = process.env.INTERAKT_API_KEY;
  if (!apiKey) throw new Error("INTERAKT_API_KEY not set");

  const cleanPhone = phone.replace(/^\+91/, "").replace(/^0/, "").replace(/\D/g, "");
  const res = await fetch("https://api.interakt.ai/v1/public/message/", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      countryCode: "+91",
      phoneNumber: cleanPhone,
      type: "Text",
      data: { message: text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  maltiLogger.info(LOG, "Text reply sent", { phone: cleanPhone, ok: res.ok, status: res.status });
  return { ok: res.ok, data };
}

// ── Main agent handler ────────────────────────────────────────────────────

export async function handleWhatsAppAgentMessage(req, res) {
  // Interakt webhook format: { wa_id, profile_name, text: { body }, ... }
  const raw = req.body;
  const phone   = raw.wa_id ?? raw.phone ?? raw.from ?? null;
  const message = raw.text?.body ?? raw.message ?? raw.body ?? "";

  if (!phone || !message.trim()) {
    maltiLogger.warn(LOG, "Missing phone or message", { body: JSON.stringify(raw).slice(0, 200) });
    return res.status(400).json({ success: false, error: "phone and message required" });
  }

  maltiLogger.info(LOG, "Inbound WA message", { phone, message: message.slice(0, 100) });

  try {
    const { role, data: ctx } = await lookupByPhone(phone);
    maltiLogger.info(LOG, "Phone lookup", { phone, role });

    const systemPrompt = buildSystemPrompt(role, ctx ?? {});
    const userMsg      = `Customer WhatsApp message: "${message}"`;

    const reply = await callClaude(systemPrompt, userMsg, 256);
    maltiLogger.info(LOG, "Claude reply", { reply: reply.slice(0, 100) });

    await sendTextReply(phone, reply);

    return res.json({ success: true, role, reply });
  } catch (err) {
    maltiLogger.error(LOG, "WA agent error", { error: String(err.message ?? err) });
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

// ── Outbound template sender (admin-triggered) ────────────────────────────

export async function sendOutboundTemplate(req, res) {
  const { phone, template_name, body_values = [], reason } = req.body;
  if (!phone || !template_name) {
    return res.status(400).json({ success: false, error: "phone and template_name required" });
  }
  maltiLogger.info(LOG, "Outbound template", { phone, template_name, reason });
  try {
    const result = await sendWhatsAppTemplate(phone, template_name, body_values);
    return res.json({ success: result.ok, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}
