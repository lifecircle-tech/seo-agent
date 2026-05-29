import { maltiLogger } from "../utils/maltiLogger.js";
import { getAllSlackChannels, upsertSlackChannels } from "../models/AgentModel.js";

const LOG       = "SLACK_CTRL";
const SLACK_API = "https://slack.com/api";

// 1-hour in-memory channel name → ID cache
const channelCache = new Map();
let cacheExpiry = 0;

async function slackApi(method, params = {}) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");
  maltiLogger.debug(LOG, `Slack API → ${method}`);
  const res  = await fetch(`${SLACK_API}/${method}`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body:    JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) maltiLogger.warn(LOG, `Slack API ${method} returned error`, { error: data.error });
  return data;
}

// Fetch ALL channels across all pages using cursor pagination
async function fetchAllChannels() {
  const all    = [];
  let   cursor = "";
  let   page   = 0;

  do {
    page++;
    const params = {
      types:            "public_channel,private_channel",
      exclude_archived: false,
      limit:            200,
    };
    if (cursor) params.cursor = cursor;

    maltiLogger.debug(LOG, `fetchAllChannels page ${page}`, { cursor: cursor.slice(0, 20) || "start" });
    const data = await slackApi("conversations.list", params);

    if (!data.ok) {
      maltiLogger.warn(LOG, `conversations.list failed on page ${page}`, { error: data.error });
      break;
    }
    all.push(...(data.channels ?? []));
    cursor = data.response_metadata?.next_cursor ?? "";
    maltiLogger.debug(LOG, `fetchAllChannels page ${page} fetched`, { count: data.channels?.length ?? 0, has_more: !!cursor });
  } while (cursor);

  maltiLogger.info(LOG, `fetchAllChannels complete`, { total: all.length, pages: page });
  return all;
}

async function resolveChannelId(name) {
  const clean = name.replace(/^#/, "");

  // Return as-is if it already looks like a Slack channel ID (C... format)
  if (/^[CGD][A-Z0-9]+$/.test(clean)) {
    maltiLogger.debug(LOG, `resolveChannelId: ${clean} is already an ID`);
    return clean;
  }

  if (Date.now() < cacheExpiry && channelCache.has(clean)) {
    maltiLogger.debug(LOG, `Cache hit for #${clean}`);
    return channelCache.get(clean);
  }
  maltiLogger.info(LOG, `Refreshing channel list (full paginated fetch)`);
  const channels = await fetchAllChannels();
  if (channels.length) {
    cacheExpiry = Date.now() + 3600000;
    channelCache.clear();
    channels.forEach(c => channelCache.set(c.name, c.id));
    maltiLogger.info(LOG, `Channel cache updated`, { count: channels.length });
  }
  return channelCache.get(clean) ?? clean;
}

export async function postToChannel(req, res) {
  const { channel, text, blocks } = req.body;
  if (!channel || !text) return res.status(400).json({ success: false, error: "channel and text required" });
  maltiLogger.info(LOG, `postToChannel: #${channel}`, { text_len: text.length });
  try {
    const channelId = await resolveChannelId(channel);
    const result    = await slackApi("chat.postMessage", { channel: channelId, text, ...(blocks ? { blocks } : {}) });
    maltiLogger.info(LOG, `Message posted`, { channel, ok: result.ok, ts: result.ts });
    return res.json({ success: result.ok, ts: result.ts, error: result.error ?? null });
  } catch (err) {
    maltiLogger.error(LOG, `postToChannel failed`, { channel, error: String(err.message ?? err) });
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function postViaWebhook(req, res) {
  const { webhook_key, text, username } = req.body;
  if (!webhook_key || !text) return res.status(400).json({ success: false, error: "webhook_key and text required" });

  const webhookUrl = process.env[`SLACK_WEBHOOK_${webhook_key.toUpperCase()}`];
  if (!webhookUrl) {
    maltiLogger.warn(LOG, `Unknown webhook key: ${webhook_key}`);
    return res.status(400).json({ success: false, error: `Unknown webhook key: ${webhook_key}` });
  }

  maltiLogger.info(LOG, `postViaWebhook: key=${webhook_key}`, { username });
  try {
    const payload = { text };
    if (username) payload.username = username;
    const r = await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    maltiLogger.info(LOG, `Webhook posted`, { webhook_key, status: r.status, ok: r.ok });
    return res.json({ success: r.ok, status: r.status });
  } catch (err) {
    maltiLogger.error(LOG, `postViaWebhook failed`, { webhook_key, error: String(err.message ?? err) });
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function fetchMessages(req, res) {
  const { channel, lookback_hours = 48 } = req.query;
  if (!channel) return res.status(400).json({ success: false, error: "channel required" });
  maltiLogger.info(LOG, `fetchMessages: #${channel}`, { lookback_hours });
  try {
    const channelId = await resolveChannelId(channel);
    const oldest    = (Date.now() / 1000 - Number(lookback_hours) * 3600).toFixed(0);
    const result    = await slackApi("conversations.history", { channel: channelId, oldest, limit: 100 });
    const count     = (result.messages ?? []).length;
    maltiLogger.info(LOG, `fetchMessages complete`, { channel, count, ok: result.ok });
    return res.json({ success: result.ok, messages: result.messages ?? [], error: result.error ?? null });
  } catch (err) {
    maltiLogger.error(LOG, `fetchMessages failed`, { channel, error: String(err.message ?? err) });
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

// Read all SLACK_WEBHOOK_* keys from env and return as webhook-type channels
function getWebhookChannels() {
  return Object.keys(process.env)
    .filter(k => k.startsWith("SLACK_WEBHOOK_") && process.env[k])
    .map(k => {
      const key  = k.replace("SLACK_WEBHOOK_", "").toLowerCase();
      const name = key.replace(/_/g, "-");
      return { id: `webhook:${key}`, name, type: "webhook" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listChannels(req, res) {
  maltiLogger.info(LOG, "listChannels called");
  try {
    const dbChannels      = await getAllSlackChannels();
    const webhookChannels = getWebhookChannels();

    const channels = [
      ...dbChannels.map(c => ({ id: c.channel_id, name: c.name, type: "api" })),
      ...webhookChannels,
    ].sort((a, b) => a.name.localeCompare(b.name));

    maltiLogger.info(LOG, `listChannels returning ${channels.length} channels`, {
      db: dbChannels.length, webhooks: webhookChannels.length,
    });
    return res.json({ success: true, channels });
  } catch (err) {
    maltiLogger.error(LOG, "listChannels error", { error: String(err.message ?? err) });
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function seedChannels(req, res) {
  const CHANNELS = [
    { channel_id: "C025MS8E2",    name: "general",                                  is_private: 0 },
    { channel_id: "C025MS8E6",    name: "random",                                   is_private: 0 },
    { channel_id: "C08B80RRSNR",  name: "tech-testing",                             is_private: 0 },
    { channel_id: "C0AST76N6AX",  name: "seo-agent",                                is_private: 1 },
    { channel_id: "C0ARE3RNAQ1",  name: "tech-tasks",                               is_private: 1 },
    { channel_id: "C06SXSXCSPL",  name: "tech-team",                                is_private: 1 },
    { channel_id: "CELR4HEAW",    name: "tech-support",                             is_private: 1 },
    { channel_id: "C091EJNDUHL",  name: "tech-support-carevidya-academy",           is_private: 1 },
    { channel_id: "C080NQYQWF5",  name: "firebase_alerts",                          is_private: 1 },
    { channel_id: "C0AEY6F0SBH",  name: "care-tube-alerts",                         is_private: 1 },
    { channel_id: "C0AEFJ0VDRN",  name: "cva-alerts",                               is_private: 1 },
    { channel_id: "C0ADK5W8RV4",  name: "audit-alerts",                             is_private: 1 },
    { channel_id: "C0A3S9AJ8GL",  name: "leads-alerts",                             is_private: 1 },
    { channel_id: "C0A0V9K4361",  name: "care-jobs-web-alerts",                     is_private: 1 },
    { channel_id: "C08BBCKCYGZ",  name: "crisp-chats",                              is_private: 1 },
    { channel_id: "C09V94LD43Y",  name: "care-bridge",                              is_private: 1 },
    { channel_id: "C0A1CJ01J8L",  name: "caretube-core-team",                       is_private: 1 },
    { channel_id: "C07CJ0DQE0L",  name: "care-tube-academy",                        is_private: 1 },
    { channel_id: "C0AFSH4S7TK",  name: "care-tube-course",                         is_private: 1 },
    { channel_id: "C07PQHMQ4JH",  name: "caretube-contact-us-details",              is_private: 1 },
    { channel_id: "C025AM4JPPT",  name: "care-mgrs-team",                           is_private: 1 },
    { channel_id: "C0ALDSELQHW",  name: "care_mgr_karthik_hyd",                     is_private: 1 },
    { channel_id: "C0AM5S171GB",  name: "care_mgr_blossom-vijayawada",              is_private: 1 },
    { channel_id: "C08TMJVCE8G",  name: "care_mgr_tanmayee-mumbai",                 is_private: 1 },
    { channel_id: "C0AENP90BGR",  name: "care_mgr_jagadeesha_mysore",               is_private: 1 },
    { channel_id: "C06158DTABF",  name: "care_mgr_anand-pune",                      is_private: 1 },
    { channel_id: "GELN2CPS8",    name: "care_mgr_jitendra_ncr",                    is_private: 1 },
    { channel_id: "C076GHSDR5F",  name: "care_mgr_shankar-hyd",                     is_private: 1 },
    { channel_id: "C087T2FK48H",  name: "care-mgr-bharathi-blore",                  is_private: 1 },
    { channel_id: "C08024GE5HP",  name: "care-mgr-raviteja-hyd",                    is_private: 1 },
    { channel_id: "C02QFEY6JV6",  name: "care-mgr-salome-chennai",                  is_private: 1 },
    { channel_id: "C0AG1J910GM",  name: "care-mgr-santhoshi-vizag",                 is_private: 1 },
    { channel_id: "CEMSMMJCF",    name: "care-mgr-vijay-hyd",                       is_private: 1 },
    { channel_id: "C071280KT5L",  name: "orientation-schedule",                     is_private: 1 },
    { channel_id: "C0A4FJMQDQT",  name: "hyd-office-team",                          is_private: 1 },
    { channel_id: "C0A3S3JRGUE",  name: "office-lunch-cpr",                         is_private: 1 },
    { channel_id: "GGUD5G2GL",    name: "office_team-south-west",                   is_private: 1 },
    { channel_id: "C0A6Q9F8D1A",  name: "gift-collection",                          is_private: 1 },
    { channel_id: "C09SMPNDBNJ",  name: "admin-help-info",                          is_private: 1 },
    { channel_id: "C01TN41B69F",  name: "process-support",                          is_private: 1 },
    { channel_id: "C092BEQ9T7C",  name: "90-days-project",                          is_private: 1 },
    { channel_id: "C08SWAUP3BL",  name: "pvlf",                                     is_private: 1 },
    { channel_id: "C0950FB18BW",  name: "cm-whatsapp",                              is_private: 1 },
    { channel_id: "C08AP9BJJCV",  name: "welcome-exit-calls",                       is_private: 1 },
    { channel_id: "C09Q5FFS3EK",  name: "pcp-review-feedback",                      is_private: 1 },
    { channel_id: "C07FCMT7H3L",  name: "provisional-receipts",                     is_private: 1 },
    { channel_id: "C07JUM900JV",  name: "account-deletion-request",                 is_private: 1 },
    { channel_id: "C07HTV4RWRM",  name: "referral-cg-and-client",                   is_private: 1 },
    { channel_id: "C07J0AU7LNL",  name: "aditional-services-lead",                  is_private: 1 },
    { channel_id: "C07KRECA2VA",  name: "unrecorded-attendance-details",             is_private: 1 },
    { channel_id: "C0899015V0T",  name: "hostel-occupancy",                         is_private: 1 },
    { channel_id: "C06BYRGS99S",  name: "leads-others",                             is_private: 1 },
    { channel_id: "C04JM4UQAQJ",  name: "leads_secunderabad",                       is_private: 1 },
    { channel_id: "GF0UMPNBD",    name: "leads_hyderabad-target-75-placements",     is_private: 1 },
    { channel_id: "GHM8BTVJL",    name: "leads-bangalore-target-15-placements-pm",  is_private: 1 },
    { channel_id: "C077UQ4T3KR",  name: "leads-chennai-target-10-placements",       is_private: 1 },
    { channel_id: "C08TR2PQS1F",  name: "leads-mumbai-15-placements",               is_private: 1 },
    { channel_id: "C0AGFQ223LG",  name: "leads-mysuru-target-10-placements",        is_private: 1 },
    { channel_id: "C0AFV8YCY7L",  name: "leads-vijaywada-target-10-placements",     is_private: 1 },
    { channel_id: "C0AG0DXSL9X",  name: "leads-vizag-taregt-10-placements",         is_private: 1 },
    { channel_id: "C06BPNS5L4E",  name: "job_applications-web",                     is_private: 1 },
    { channel_id: "G01366Q38AH",  name: "hp_new_placement-ncr",                     is_private: 1 },
    { channel_id: "G01CNDLESM6",  name: "hp_new-placement-south",                   is_private: 1 },
    { channel_id: "C04SX05F4P2",  name: "hp_replacement-south",                     is_private: 1 },
    { channel_id: "GNLAXPM4N",    name: "hp_search-registration-south",             is_private: 1 },
    { channel_id: "G01JTJ2QD9R",  name: "hp_search_registration-ncr",               is_private: 1 },
    { channel_id: "C05FQE0V7T7",  name: "service_cancellations-ncr",                is_private: 1 },
    { channel_id: "C04SKV0BH7B",  name: "service_cancellations-south",              is_private: 1 },
    { channel_id: "C08E42C745B",  name: "cg-registration-status-india",             is_private: 1 },
    { channel_id: "C08E6NVTWFM",  name: "cg-registration-leave-retention-southwest",is_private: 1 },
    { channel_id: "G01KN40916V",  name: "care_quality-alerts",                      is_private: 1 },
    { channel_id: "G018X56DB9U",  name: "cash_flow_south",                          is_private: 1 },
    { channel_id: "G016G1A0BMK",  name: "cash_flow-ncr",                            is_private: 1 },
    { channel_id: "C083Z30H63U",  name: "hyd-secbad-benchlist",                     is_private: 1 },
    { channel_id: "C084N5WP8KA",  name: "bangalore-bench-list",                     is_private: 1 },
    { channel_id: "C09F4BCR89F",  name: "delhi-ncr-bench-list",                     is_private: 1 },
    { channel_id: "C09H94XT142",  name: "mumbai-bench-list",                        is_private: 1 },
    { channel_id: "C09H4EDJVEF",  name: "chennai-bench-llist",                      is_private: 1 },
    { channel_id: "C09H4EH8MU3",  name: "pune-bench-list",                          is_private: 1 },
    { channel_id: "C09EANQ3X55",  name: "planned-leave-ncr",                        is_private: 1 },
    { channel_id: "C08EK5T41TK",  name: "planned-leaves-south-west",                is_private: 1 },
  ];

  maltiLogger.info(LOG, `seedChannels called`, { count: CHANNELS.length });
  try {
    await upsertSlackChannels(CHANNELS);
    maltiLogger.info(LOG, `seedChannels done`, { count: CHANNELS.length });
    return res.json({ success: true, seeded: CHANNELS.length });
  } catch (err) {
    maltiLogger.error(LOG, "seedChannels error", { error: String(err.message ?? err) });
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

// Internal helper for other controllers — routes via bot token or webhook
export async function postSlackMessage(channel, text) {
  maltiLogger.debug(LOG, `postSlackMessage (internal)`, { channel, text_len: text.length });
  const channelId = await resolveChannelId(channel);
  const result    = await slackApi("chat.postMessage", { channel: channelId, text });
  maltiLogger.info(LOG, `postSlackMessage result`, { channel, ok: result.ok });
  return result;
}

// Unified output helper: accepts "webhook:<key>", a bare webhook key, or a real channel ID/name
export async function postSlackOutput(target, text) {
  const key = target.startsWith("webhook:") ? target.replace("webhook:", "") : target;
  const webhookUrl = process.env[`SLACK_WEBHOOK_${key.toUpperCase()}`];

  if (webhookUrl) {
    maltiLogger.debug(LOG, `postSlackOutput via webhook`, { key, text_len: text.length });
    const r = await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text }),
    });
    maltiLogger.info(LOG, `postSlackOutput webhook result`, { key, status: r.status, ok: r.ok });
    return { ok: r.ok, status: r.status };
  }

  return postSlackMessage(target, text);
}

export async function postSlackWebhook(webhookUrl, text) {
  maltiLogger.debug(LOG, `postSlackWebhook`, { url: webhookUrl.slice(0, 50) });
  return fetch(webhookUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text }),
  });
}
