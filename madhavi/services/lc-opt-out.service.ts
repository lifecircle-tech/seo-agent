import { logger } from "../utils/logger";
import { getChatMessages, sendMessage } from "./timelines.service";
import { getCMChatByHpUniqueId } from "./lc-cm-conversation.service";
import { getCaregiverPhoneByHpUniqueId } from "../models/lc-caregivers.model";
import {
  getPhoneKey,
  isPhoneOptedOut,
  upsertOptOut,
  updateOptIn,
} from "../models/lc-opt-out.model";

// Matched against the WHOLE message only, so "stop" inside a sentence
// ("please stop the AC", "stop asking about leave") never opts anyone out.
// Anything less explicit is left to the agent's stricter judgement.
const OPT_OUT_KEYWORDS = new Set([
  "stop",
  "stop all",
  "unsubscribe",
  "opt out",
  "optout",
]);
const OPT_IN_KEYWORDS = new Set(["start", "unstop"]);

const OPT_OUT_CONFIRMATION =
  "You have been unsubscribed and will not receive any more WhatsApp messages from LifeCircle's assistant. Reply START anytime to receive messages again.";
const OPT_IN_CONFIRMATION =
  "You will receive WhatsApp messages from LifeCircle's assistant again. Reply STOP anytime to unsubscribe.";

// How many of the person's latest messages the agent's quote is checked
// against before an opt-out is recorded.
const RECENT_MESSAGES_TO_VERIFY = 5;

type ChatMessage = { timestamp: string; sender: string; message: string };

// Lowercase, punctuation and emoji removed, whitespace collapsed. Letters
// and combining marks of any script are kept (e.g. Hindi).
function normalizeMessage(text: unknown) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toWhatsappPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

// Messages the person sent since the last message to them (history is
// newest first).
function getUnansweredMessages(chat_history: ChatMessage[]) {
  const unanswered: ChatMessage[] = [];
  for (const message of chat_history) {
    if (message.sender !== "caregiver") break;
    unanswered.push(message);
  }
  return unanswered;
}

// Never throws: the opt-out is already saved and must stand even if the
// confirmation cannot be delivered.
async function sendConfirmation(phone: string, text: string) {
  try {
    const result = await sendMessage(toWhatsappPhone(phone), text, {
      allowOptedOut: true,
    });
    if (result.status !== "ok") {
      logger.warn(`[opt-out] confirmation to ${phone} failed`, result);
    }
  } catch (err) {
    logger.error(`[opt-out] confirmation to ${phone} failed`, err);
  }
}

async function optOutPhone({
  phone,
  hp_unique_id,
  chat_id,
  source,
  user_message,
  reason,
}: {
  phone: string;
  hp_unique_id: number | null;
  chat_id: string | null;
  source: "keyword" | "agent" | "manual";
  user_message: string | null;
  reason: string | null;
}) {
  // Saved before the confirmation goes out, so an agent run already in
  // flight is blocked and the confirmation is the last message sent.
  await upsertOptOut({
    phone_key: getPhoneKey(phone),
    phone,
    hp_unique_id,
    chat_id,
    source,
    user_message,
    reason,
  });
  logger.log(`[opt-out] ${phone} (hp ${hp_unique_id}) opted out via ${source}`);

  await sendConfirmation(phone, OPT_OUT_CONFIRMATION);
}

async function optInPhone(phone: string) {
  await updateOptIn(getPhoneKey(phone));
  logger.log(`[opt-out] ${phone} opted back in`);

  await sendConfirmation(phone, OPT_IN_CONFIRMATION);
}

// Runs before the agent for an incoming WhatsApp message. Returns true when
// the message was handled here and the agent must not run:
// - an opted-out person is never answered, unless they send START
// - a message that is exactly an opt-out keyword opts them out
async function handleInboundOptOut({
  chat_id,
  hp_unique_id,
  phone,
}: {
  chat_id: string;
  hp_unique_id: number;
  phone: string;
}) {
  const chat_history: ChatMessage[] = await getChatMessages(chat_id);
  const unanswered = getUnansweredMessages(chat_history);

  if (await isPhoneOptedOut(phone)) {
    if (unanswered.some((m) => OPT_IN_KEYWORDS.has(normalizeMessage(m.message)))) {
      await optInPhone(phone);
    } else {
      logger.log(`[opt-out] not answering opted-out chat ${chat_id}`);
    }
    return true;
  }

  const keyword_message = unanswered.find((m) =>
    OPT_OUT_KEYWORDS.has(normalizeMessage(m.message)),
  );
  if (keyword_message) {
    await optOutPhone({
      phone,
      hp_unique_id,
      chat_id,
      source: "keyword",
      user_message: keyword_message.message,
      reason: "Sent opt-out keyword",
    });
    return true;
  }

  return false;
}

// Backs the agent's 'record_messaging_opt_out' tool. The agent must quote
// one of the person's recent messages exactly; the quote is checked against
// the real chat, so an opt-out is never recorded from a misread or invented
// message.
async function optOutFromAgent({
  hp_unique_id,
  user_message,
  reason,
}: {
  hp_unique_id: number;
  user_message: string;
  reason: string;
}): Promise<{ status: "ok" | "error"; message: string }> {
  const cm_chat = await getCMChatByHpUniqueId(hp_unique_id);
  if (!cm_chat?.chat_id) {
    return {
      status: "error",
      message: `No WhatsApp chat found for cg_id ${hp_unique_id}. Opt-out not recorded.`,
    };
  }

  const chat_history: ChatMessage[] = await getChatMessages(cm_chat.chat_id);
  const quote = normalizeMessage(user_message);
  const matched = chat_history
    .filter((m) => m.sender === "caregiver")
    .slice(0, RECENT_MESSAGES_TO_VERIFY)
    .find((m) => normalizeMessage(m.message) === quote);

  if (!quote || !matched) {
    return {
      status: "error",
      message:
        "user_message does not match any of the person's recent messages. Pass the exact full text of the message in which they asked to stop. Opt-out not recorded.",
    };
  }

  const phone = await getCaregiverPhoneByHpUniqueId(hp_unique_id);
  if (!phone) {
    return {
      status: "error",
      message: `No phone number found for cg_id ${hp_unique_id}. Opt-out not recorded.`,
    };
  }

  await optOutPhone({
    phone,
    hp_unique_id,
    chat_id: cm_chat.chat_id,
    source: "agent",
    user_message: matched.message,
    reason,
  });

  return {
    status: "ok",
    message:
      "Opt-out recorded and confirmation sent to the person. Do not send them any more messages; end this conversation.",
  };
}

export { isPhoneOptedOut, handleInboundOptOut, optOutFromAgent };
