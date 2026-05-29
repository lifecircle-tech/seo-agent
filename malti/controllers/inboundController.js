import { randomUUID } from "node:crypto";
import * as Contact from "../models/ContactModel.js";
import { callClaude } from "./claudeController.js";
import { sendWhatsAppTemplate } from "./whatsappController.js";
import { postSlackWebhook } from "./slackController.js";

const CITY_LANGUAGE_MAP = {
  "delhi": "hi", "up": "hi", "bihar": "hi", "rajasthan": "hi", "mp": "hi", "haryana": "hi",
  "ap": "te", "telangana": "te",
  "karnataka": "kn",
  "tamil": "ta", "tn": "ta",
  "kerala": "ml",
  "maharashtra": "mr",
  "bengal": "bn", "wb": "bn",
  "gujarat": "gu",
  "punjab": "pa",
};

function detectLanguageFromCity(city = "") {
  const lower = city.toLowerCase();
  for (const [key, lang] of Object.entries(CITY_LANGUAGE_MAP)) {
    if (lower.includes(key)) return lang;
  }
  return "en";
}

export function normalizeInboundData(channel, data) {
  switch (channel) {
    case "phone":
    case "ozonetel":
      return {
        name: data.CallerName ?? data.caller_name ?? null,
        phone: data.CallerNumber ?? data.caller_number ?? null,
        email: null,
        city: data.circle ?? data.city ?? null,
        message: data.transcript ?? data.message ?? "Incoming call",
        language: detectLanguageFromCity(data.circle ?? ""),
        source_detail: data.call_id ?? null,
      };
    case "web_form":
      return {
        name: data.full_name ?? data.name ?? null,
        phone: data.phone ?? data.mobile ?? null,
        email: data.email ?? null,
        city: data.city ?? data.location ?? null,
        message: data.requirement ?? data.message ?? data.query ?? "",
        language: "en",
        source_detail: data.form_id ?? "web_form",
      };
    case "whatsapp":
      return {
        name: data.profile_name ?? data.name ?? null,
        phone: data.wa_id ?? data.phone ?? null,
        email: null,
        city: null,
        message: data.message ?? data.text ?? "",
        language: "en",
        source_detail: data.wa_id ?? null,
      };
    case "email":
      return {
        name: data.from_name ?? null,
        phone: null,
        email: data.from_email ?? data.email ?? null,
        city: null,
        message: `Subject: ${data.subject ?? ""}\n\n${data.body ?? ""}`,
        language: "en",
        source_detail: data.message_id ?? null,
      };
    default:
      return { name: null, phone: data.phone ?? null, email: data.email ?? null, city: null, message: data.message ?? "", language: "en", source_detail: null };
  }
}

async function scoreLead(lead, channel) {
  const systemPrompt = `You are a lead scoring AI for LifeCircle eldercare.
Score this lead on:
- need_clarity: 0-30 (clear need=30, vague=0)
- urgency: 0-25 (immediate=25, future=5)
- budget: 0-25 (above 50k=25, under 20k=5)
- city: 0-10 (metro=10, tier2=7, unserviceable=0)
Return ONLY JSON: {"need_clarity":0,"urgency":0,"budget":0,"city":0,"total":0,"grade":"hot|warm|cold","sentiment":"positive|neutral|negative","factors":["..."]}`;

  const userPrompt = `Channel: ${channel}
Name: ${lead.name ?? "Unknown"}
Phone: ${lead.phone ?? "N/A"}
City: ${lead.city ?? "Unknown"}
Message: ${lead.message ?? ""}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt, 512);
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const total = parsed.total ?? ((parsed.need_clarity ?? 0) + (parsed.urgency ?? 0) + (parsed.budget ?? 0) + (parsed.city ?? 0));
    const grade = total >= 70 ? "hot" : total >= 40 ? "warm" : "cold";
    return { ...parsed, total, grade };
  } catch {
    return { total: 30, grade: "cold", factors: ["scoring_error"], sentiment: "neutral" };
  }
}

export async function processInboundLead(req, res) {
  const { channel, ...data } = req.body;
  if (!channel) return res.status(400).json({ success: false, error: "channel required" });
  try {
    const lead = normalizeInboundData(channel, data);
    const contactId = randomUUID();

    // Register contact
    const contact = await Contact.upsertContact(contactId, {
      name: lead.name, phone: lead.phone, email: lead.email,
      city: lead.city, contact_type: "lead", preferred_language: lead.language
    });

    // Ownership check
    const lockCheck = await Contact.checkOwnershipLock(contact.contact_id, `${channel}_inbound`);
    if (!lockCheck.allowed) {
      return res.json({ success: true, contact_id: contact.contact_id, locked_by: lockCheck.current_owner });
    }

    // Score
    const score = await scoreLead(lead, channel);

    // Add to timeline
    await Contact.addToTimeline(contact.contact_id, channel, "channel", "inbound", channel, "message", lead.message);

    // Route
    let routing = "cold_ai";
    if (score.grade === "hot") {
      routing = "hot_transfer";
      await Contact.assignOwnership(contact.contact_id, "hot_queue", "ai");
      const warRoomWebhook = process.env.SLACK_WEBHOOK_WAR_ROOM;
      if (warRoomWebhook) {
        await postSlackWebhook(warRoomWebhook,
          `🔥 HOT LEAD (${score.total}/100)\nName: ${lead.name ?? "Unknown"} | Phone: ${lead.phone ?? "N/A"} | City: ${lead.city ?? "Unknown"}\nMessage: ${lead.message?.slice(0, 200) ?? ""}`
        );
      }
    } else if (score.grade === "warm") {
      routing = "warm_ai";
      await Contact.assignOwnership(contact.contact_id, "arjun_sales", "ai");
    } else {
      routing = "cold_ai";
      if (lead.phone) {
        await sendWhatsAppTemplate(lead.phone, "cold_lead_info_pack", [lead.name ?? "there"]).catch(() => null);
      }
    }

    return res.json({ success: true, contact_id: contact.contact_id, score, routing });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getStats(req, res) {
  // TODO: aggregate from contact_registry and contact_timeline
  return res.json({ success: true, stats: { message: "Stats endpoint — query contact_registry for aggregations" } });
}
