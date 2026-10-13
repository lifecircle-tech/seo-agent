import { setTimeout } from "timers/promises";
import { logger } from "../../madhavi/utils/logger";

const baseUrl = process.env.TIMELINE_URL;

function getTimelineToken() {
  const token = process.env.TIMELINE_TOKEN;
  if (!token) {
    throw new Error("Missing env var TIMELINE_TOKEN");
  }

  return token;
}

async function getChatMessages(chat_id: string) {
  const token = getTimelineToken();

  const url = `${baseUrl}/chats/${chat_id}/messages`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  const temp_messages = data.data.messages.slice(0, 20);
  const messages = temp_messages.map((message: any) => ({
    timestamp: message.timestamp,
    sender: message.from_me ? "madhavi" : "caregiver",
    message: message.text,
  }));

  return messages;
}

// Timelines assigns the chat to a sent message asynchronously, so the chat
// id is polled with growing waits (~11s in total) instead of one fixed wait.
const CHAT_ID_RETRY_DELAYS_MS = [1000, 2000, 3000, 5000];

// A WhatsApp number keeps the same chat, so a resolved chat id is reused
// for later messages to that phone without waiting on Timelines.
const chatIdByPhone = new Map<string, string>();

async function sendMessage(phone: string, message: string) {
  const token = getTimelineToken();

  if (!phone.startsWith("+")) {
    return {
      status: "error",
      message: "Phone number must start with a '+' sign",
    };
  }

  const phoneWithoutPlus = phone.slice(1);

  if (phoneWithoutPlus.length < 10 || phoneWithoutPlus.length > 12) {
    return {
      status: "error",
      message: "Phone number must be between 10 and 12 digits long",
    };
  }

  if (!message) {
    return {
      status: "error",
      message: "Message cannot be empty",
    };
  }

  let message_id: string | undefined;
  try {
    const url = `${baseUrl}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: phone,
        whatsapp_account_phone: "+919154241774",
        text: message,
      }),
    });

    if (!response.ok) {
      return {
        status: "error",
        message: `Failed to send timeline message: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    message_id = data?.data?.message_uid;
  } catch (err: any) {
    logger.error("[timelines -> sendMessage]", err);
    throw new Error(err.message);
  }

  // The message is sent from here on: never report an error, or the agent
  // may send it again. A missing chat id is resolved later by the caller.
  const chat_id =
    chatIdByPhone.get(phone) ??
    (message_id ? await getChatIdFromMessageId(message_id) : undefined);

  if (chat_id) {
    chatIdByPhone.set(phone, chat_id);
  } else {
    logger.warn(
      `[timelines -> sendMessage] chat id not available yet for message ${message_id}`,
    );
  }

  return {
    status: "ok",
    message: "Message sent",
    chat_id,
    message_id,
  };
}

// Single lookup; never throws, so a slow or failing Timelines cannot turn
// a sent message into an error.
async function fetchChatIdFromMessageId(
  message_id: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(`${baseUrl}/messages/${message_id}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getTimelineToken()}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      logger.warn(
        `[timelines] chat id lookup for message ${message_id}: ${response.status} ${response.statusText}`,
      );
      return undefined;
    }

    const data = await response.json();
    return data?.data?.chat_id != null ? String(data.data.chat_id) : undefined;
  } catch (err) {
    logger.warn(`[timelines] chat id lookup for message ${message_id} failed`, err);
    return undefined;
  }
}

async function getChatIdFromMessageId(
  message_id: string,
  delays_ms: number[] = CHAT_ID_RETRY_DELAYS_MS,
): Promise<string | undefined> {
  for (const delay of delays_ms) {
    await setTimeout(delay);
    const chat_id = await fetchChatIdFromMessageId(message_id);
    if (chat_id) return chat_id;
  }
  return undefined;
}

export { getChatMessages, sendMessage, getChatIdFromMessageId };
