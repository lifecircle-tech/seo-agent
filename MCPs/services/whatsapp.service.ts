import { whatsapp, WhatsappServiceError } from "../../whatsapp/client";
import { logger } from "../../madhavi/utils/logger";
import { isPhoneOptedOut } from "../../madhavi/models/lc-opt-out.model";

// Messages the agents get as chat history
const HISTORY_LIMIT = 20;

export type ChatMessage = {
  timestamp: string;
  sender: "madhavi" | "caregiver";
  message: string;
};

export type SendMessageResult = {
  status: "ok" | "error";
  message: string;
  // Set when the person has not messaged in the last 24 hours
  code?: "outside_session_window";
  chat_id?: string;
  message_id?: string;
};

// An approved template to send, with values by parameter key as
// 'list_whatsapp_templates' lists them
export type TemplateRequest = {
  name: string;
  language?: string;
  parameters?: Record<string, string>;
};

// Told to the agent when a free-form message cannot be sent
const OUTSIDE_WINDOW_MESSAGE =
  "Message not sent: this person has not messaged in the last 24 hours, so WhatsApp only allows an approved template. Call 'list_whatsapp_templates', choose the template that fits what you wanted to say, and send it with 'send_whatsapp_template'. If none fits, do not send anything.";

// The latest messages of a chat, newest first. Messages WhatsApp did not
// deliver are left out, so the agent does not take them as said. A chat
// the WhatsApp service has no messages for (such as one started on
// Timelines) has an empty history.
async function getChatMessages(chat_id: string): Promise<ChatMessage[]> {
  try {
    const { messages } = await whatsapp.getChatMessages(chat_id, {
      limit: HISTORY_LIMIT,
    });

    return messages
      .filter((m) => m.status !== "failed")
      .map((m) => ({
        timestamp: m.timestamp,
        sender: m.from_me ? "madhavi" : "caregiver",
        // Non-text messages come as a description, e.g. "[document: id.pdf]";
        // templates as "[template: name]" and their text
        message: m.text ?? `[${m.type}]`,
      }));
  } catch (err) {
    if (
      err instanceof WhatsappServiceError &&
      (err.code === "chat_not_found" || err.code === "invalid_chat_id")
    ) {
      return [];
    }
    throw err;
  }
}

// Why this phone cannot be messaged, or null when it can.
async function checkRecipient(
  phone: string,
  options: { allowOptedOut?: boolean },
): Promise<SendMessageResult | null> {
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

  // Hard stop for people who opted out: no agent or tool can message them.
  // Only the opt-out/opt-in confirmation itself may pass allowOptedOut.
  if (!options.allowOptedOut && (await isPhoneOptedOut(phone))) {
    return {
      status: "error",
      message:
        "This person has opted out of WhatsApp messages. Do not message them again.",
    };
  }

  return null;
}

// Free-form text. Only within 24 hours of the person's last message;
// otherwise the agent is told to send a template instead.
async function sendMessage(
  phone: string,
  message: string,
  options: { allowOptedOut?: boolean } = {},
): Promise<SendMessageResult> {
  if (!message) {
    return {
      status: "error",
      message: "Message cannot be empty",
    };
  }

  const refused = await checkRecipient(phone, options);
  if (refused) return refused;

  try {
    const sent = await whatsapp.sendText(phone, message);

    return {
      status: "ok",
      message: "Message sent",
      chat_id: sent.chat_id,
      message_id: sent.wamid,
    };
  } catch (err) {
    if (!(err instanceof WhatsappServiceError)) {
      logger.error("[whatsapp -> sendMessage]", err);
      throw err;
    }
    if (err.code === "outside_session_window") {
      return {
        status: "error",
        code: "outside_session_window",
        message: OUTSIDE_WINDOW_MESSAGE,
      };
    }

    logger.warn(`[whatsapp -> sendMessage] to ${phone} failed`, err.message);
    return { status: "error", message: `Message not sent: ${err.message}` };
  }
}

// An approved template. Allowed at any time, including outside the 24-hour
// window.
async function sendTemplateMessage(
  phone: string,
  template: TemplateRequest,
  options: { allowOptedOut?: boolean } = {},
): Promise<SendMessageResult> {
  if (!template?.name) {
    return { status: "error", message: "Template name is required" };
  }

  const refused = await checkRecipient(phone, options);
  if (refused) return refused;

  try {
    const sent = await whatsapp.sendTemplate(phone, {
      name: template.name,
      language: template.language,
      parameters: template.parameters ?? {},
    });

    return {
      status: "ok",
      message: `Template '${template.name}' sent`,
      chat_id: sent.chat_id,
      message_id: sent.wamid,
    };
  } catch (err) {
    if (!(err instanceof WhatsappServiceError)) {
      logger.error("[whatsapp -> sendTemplateMessage]", err);
      throw err;
    }

    logger.warn(
      `[whatsapp -> sendTemplateMessage] '${template.name}' to ${phone} failed`,
      err.message,
    );
    // Wrong or missing parameters, unknown template...: the reason tells
    // the agent what to fix
    return { status: "error", message: `Template not sent: ${err.message}` };
  }
}

// Sends the text, or the template when one is given.
async function sendWhatsapp(
  phone: string,
  content: { message?: string; template?: TemplateRequest },
  options: { allowOptedOut?: boolean } = {},
) {
  return content.template
    ? sendTemplateMessage(phone, content.template, options)
    : sendMessage(phone, content.message ?? "", options);
}

// Approved templates the agents can send, with what each says and the
// values it takes.
async function getApprovedTemplates() {
  const templates = await whatsapp.listTemplates();

  return templates
    .filter((t) => t.status === "APPROVED" && t.supported && t.name.startsWith("madhavi_") && t.name !== "madhavi_lc_initiate_conversation")
    .map((t) => ({
      name: t.name,
      language: t.language,
      category: t.category,
      header: t.header,
      body: t.body,
      footer: t.footer,
      buttons: t.buttons.map((b) => b.text),
      parameters: t.parameters,
    }));
}

export {
  getChatMessages,
  sendMessage,
  sendTemplateMessage,
  sendWhatsapp,
  getApprovedTemplates,
};
