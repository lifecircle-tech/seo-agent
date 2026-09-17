import { setTimeout } from "timers/promises";

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

async function sendMessage(phone: string, message: string) {
  const token = getTimelineToken();
  console.log(`Service call send message to ${phone}: ${message}`);

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

  await setTimeout(1500);
  const chat_id = await getChatIdFromMessageId(data.data.message_uid);

  return {
    status: "ok",
    message: "Message sent",
    chat_id: chat_id ?? undefined,
  };
}

async function getChatIdFromMessageId(
  message_id: string,
): Promise<string | undefined> {
  const token = getTimelineToken();

  const url = `${baseUrl}/messages/${message_id}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error(
      `Failed to fetch chat id for message ${message_id}: ${response.status} ${response.statusText}`,
    );
    return undefined;
  }

  const data = await response.json();

  return data.data.chat_id;
}

export { getChatMessages, sendMessage, getChatIdFromMessageId };
