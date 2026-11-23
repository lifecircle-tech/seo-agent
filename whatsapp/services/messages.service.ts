import { config } from "../config.js";
import { HttpError } from "../errors.js";
import * as graph from "../graph-api.js";
import { GraphApiError } from "../graph-api.js";
import { logger } from "../logger.js";
import {
  getChat,
  listChats as listChatRows,
  upsertChat,
  type WaChat,
} from "../models/chat.model.js";
import {
  getChatMessages as getChatMessageRows,
  insertMessage,
  type WaMessage,
} from "../models/message.model.js";
import { buildTemplateMessage } from "./templates.service.js";
import type {
  ApiChat,
  ApiMessage,
  ChatMessagesPage,
  MediaType,
  OutboundMessage,
  SendResult,
} from "../types.js";

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const MEDIA_TYPES = new Set<string>(["image", "video", "audio", "document", "sticker"]);
const TEXT_MAX = 4096;
const CAPTION_MAX = 1024;

// ── Validation ────────────────────────────────────────────────────────

// "+91 98765-43210" → "919876543210", the person's WhatsApp id. The
// country code is required: WhatsApp cannot tell a local number from one
// that starts with a country code.
function toWaId(phone: unknown): string {
  const value = typeof phone === "string" ? phone.trim() : "";
  const digits = value.slice(1).replace(/[\s()-]/g, "");

  if (!value.startsWith("+") || !/^\d{8,15}$/.test(digits)) {
    throw new HttpError(
      400,
      "invalid_phone",
      "Phone number must be in international format with a '+' and country code, e.g. +919876543210",
    );
  }

  return digits;
}

// Accepts a chat id or a phone number ("+919876543210").
function parseChatId(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) {
    throw new HttpError(400, "invalid_chat_id", "chat_id must be the person's WhatsApp number");
  }
  return digits;
}

function invalid(message: string): never {
  throw new HttpError(400, "invalid_message", message);
}

function optionalString(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") invalid(`${field} must be a string`);
  return value;
}

function parseOutboundMessage(body: any): OutboundMessage {
  const type = body?.type ?? "text";

  if (type === "text") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) invalid("text is required");
    if (text.length > TEXT_MAX) invalid(`text can be at most ${TEXT_MAX} characters`);
    return { type, text, preview_url: body.preview_url === true };
  }

  if (type === "template") {
    const template = body.template;
    if (typeof template?.name !== "string" || !template.name) {
      invalid("template.name is required");
    }
    if (template.components !== undefined && !Array.isArray(template.components)) {
      invalid("template.components must be an array");
    }

    let parameters: Record<string, string> | undefined;
    if (template.parameters !== undefined && template.parameters !== null) {
      if (typeof template.parameters !== "object" || Array.isArray(template.parameters)) {
        invalid('template.parameters must be an object, e.g. { "1": "Ravi" }');
      }
      if (template.components !== undefined) {
        invalid("Pass template.parameters or template.components, not both");
      }
      parameters = {};
      for (const [key, value] of Object.entries(template.parameters)) {
        if (typeof value !== "string" && typeof value !== "number") {
          invalid(`template.parameters.${key} must be a string`);
        }
        parameters[key] = String(value);
      }
    }

    return {
      type,
      template: {
        name: template.name,
        language: optionalString(template.language, "template.language"),
        parameters,
        components: template.components,
      },
    };
  }

  if (MEDIA_TYPES.has(type)) {
    const media_id = optionalString(body.media_id, "media_id");
    const link = optionalString(body.link, "link");
    const caption = optionalString(body.caption, "caption");
    const filename = optionalString(body.filename, "filename");

    if (!media_id === !link) invalid("Provide exactly one of media_id or link");
    if (link && !/^https:\/\//i.test(link)) invalid("link must be an https URL");
    if (caption && (type === "audio" || type === "sticker")) {
      invalid(`${type} messages cannot have a caption`);
    }
    if (caption && caption.length > CAPTION_MAX) {
      invalid(`caption can be at most ${CAPTION_MAX} characters`);
    }
    if (filename && type !== "document") invalid("filename is only used for documents");

    return { type: type as MediaType, media_id, link, caption, filename };
  }

  invalid(`Unsupported message type '${type}'`);
}

// ── Sending ───────────────────────────────────────────────────────────

function buildPayload(message: OutboundMessage) {
  switch (message.type) {
    case "text":
      return {
        type: "text",
        text: { body: message.text, preview_url: message.preview_url ?? false },
      };
    case "template":
      return {
        type: "template",
        template: {
          name: message.template.name,
          language: { code: message.template.language ?? "en" },
          ...(message.template.components?.length
            ? { components: message.template.components }
            : {}),
        },
      };
    default: {
      const media: Record<string, string> = message.media_id
        ? { id: message.media_id }
        : { link: message.link as string };
      if (message.caption) media.caption = message.caption;
      if (message.filename) media.filename = message.filename;
      return { type: message.type, [message.type]: media };
    }
  }
}

// What the message says, for the chat history
function describeOutbound(message: OutboundMessage): string {
  switch (message.type) {
    case "text":
      return message.text;
    case "template": {
      // Body parameters, so the history shows who/what the template was about
      const params = (message.template.components ?? [])
        .flatMap((c: any) => (Array.isArray(c?.parameters) ? c.parameters : []))
        .map((p: any) => p?.text)
        .filter(Boolean);
      return [`[template: ${message.template.name}]`, params.join(" | ")]
        .filter(Boolean)
        .join(" ");
    }
    default: {
      const label =
        message.type === "document"
          ? `[document: ${message.filename ?? "file"}]`
          : `[${message.type}]`;
      return [label, message.caption].filter(Boolean).join(" ");
    }
  }
}

function sessionExpiresAt(chat: WaChat | undefined) {
  return chat?.last_inbound_at
    ? new Date(chat.last_inbound_at.getTime() + SESSION_WINDOW_MS)
    : null;
}

// A template sent by name is filled in from its definition, and its text
// (with the values) goes in the history. One with raw components is sent
// as it is.
async function resolveTemplate(message: OutboundMessage) {
  if (
    message.type !== "template" ||
    message.template.components ||
    !(message.template.parameters || config.businessAccountId)
  ) {
    return { message, text: undefined };
  }

  const { name, language, parameters } = message.template;
  const built = await buildTemplateMessage(name, language, parameters);
  return {
    message: {
      type: "template",
      template: { name, language: built.language, components: built.components },
    } satisfies OutboundMessage,
    text: `[template: ${name}]\n${built.text}`,
  };
}

async function recordOutbound(data: {
  chat_id: string;
  wamid: string | null;
  message: OutboundMessage;
  // What the message says, when it is not the message's own text
  text?: string;
  payload: unknown;
  context_wamid: string | null;
  status: "accepted" | "failed";
  error_code?: number | null;
  error_message?: string | null;
  message_at: Date;
}) {
  await upsertChat({
    chat_id: data.chat_id,
    phone_number_id: config.phoneNumberId,
    last_message_at: data.message_at,
  });

  return insertMessage({
    wamid: data.wamid,
    chat_id: data.chat_id,
    direction: "outbound",
    type: data.message.type,
    text: data.text ?? describeOutbound(data.message),
    media_id: "media_id" in data.message ? (data.message.media_id ?? null) : null,
    context_wamid: data.context_wamid,
    status: data.status,
    error_code: data.error_code,
    error_message: data.error_message,
    payload: data.payload,
    message_at: data.message_at,
  });
}

async function sendMessage(
  to: unknown,
  requested: OutboundMessage,
  options: { reply_to?: string } = {},
): Promise<SendResult> {
  const wa_id = toWaId(to);
  const { message, text } = await resolveTemplate(requested);

  logger.log(`[whatsapp] sending ${message.type} to ${wa_id}`);
  // WhatsApp only delivers free-form messages within 24 hours of the
  // person's last message; outside it, only an approved template can be
  // sent. WhatsApp would accept the message and fail it later (131047).
  if (message.type !== "template" && config.enforceSessionWindow) {
    const chat = await getChat(wa_id);
    logger.debug(`[whatsapp] chat found: ${JSON.stringify(chat)}`);
    const expires_at = sessionExpiresAt(chat);
    if (!expires_at || expires_at.getTime() <= Date.now()) {
      throw new HttpError(
        409,
        "outside_session_window",
        "This person has not messaged in the last 24 hours, so WhatsApp only allows a template message.",
        { last_inbound_at: chat?.last_inbound_at?.toISOString() ?? null },
      );
    }
  }

  const context_wamid = options.reply_to ?? null;
  const payload = {
    to: wa_id,
    ...buildPayload(message),
    ...(context_wamid ? { context: { message_id: context_wamid } } : {}),
  };
  const message_at = new Date();

  let response: graph.SendMessageResponse;
  try {
    response = await graph.sendMessage(payload);
  } catch (err) {
    if (!(err instanceof GraphApiError)) throw err;

    await recordOutbound({
      chat_id: wa_id,
      wamid: null,
      message,
      text,
      payload,
      context_wamid,
      status: "failed",
      error_code: err.code ?? null,
      error_message: err.details ?? err.message,
      message_at,
    }).catch((dbErr) => logger.error("[whatsapp] could not store failed send", dbErr));

    logger.warn(`[whatsapp] send to ${wa_id} failed: ${err.code} ${err.message}`);
    throw new HttpError(502, "whatsapp_api_error", err.message, {
      graph_status: err.status,
      graph_code: err.code ?? null,
      graph_details: err.details ?? null,
      fbtrace_id: err.fbtrace_id ?? null,
    });
  }

  const wamid = response.messages?.[0]?.id;
  if (!wamid) {
    logger.error("[whatsapp] send response without a message id", response);
    throw new HttpError(502, "whatsapp_api_error", "WhatsApp did not return a message id");
  }
  const chat_id = response.contacts?.[0]?.wa_id ?? wa_id;

  // The message is sent from here on: never report an error, or the caller
  // may send it again.
  let message_id: number | null = null;
  try {
    message_id = await recordOutbound({
      chat_id,
      wamid,
      message,
      text,
      payload,
      context_wamid,
      status: "accepted",
      message_at,
    });
  } catch (err) {
    logger.error(`[whatsapp] message ${wamid} was sent but could not be stored`, err);
  }

  logger.log(`[whatsapp] sent ${message.type} ${wamid} to ${chat_id}`);
  return { chat_id, message_id, wamid, status: "accepted" };
}

async function markAsRead(wamid: string, typing: boolean) {
  try {
    await graph.markAsRead(wamid, typing);
  } catch (err) {
    if (!(err instanceof GraphApiError)) throw err;
    throw new HttpError(502, "whatsapp_api_error", err.message, {
      graph_code: err.code ?? null,
    });
  }
}

// ── Reading ───────────────────────────────────────────────────────────

function toApiChat(chat: WaChat): ApiChat {
  const expires_at = sessionExpiresAt(chat);
  return {
    chat_id: chat.chat_id,
    phone: chat.phone,
    name: chat.profile_name,
    last_inbound_at: chat.last_inbound_at?.toISOString() ?? null,
    last_message_at: chat.last_message_at?.toISOString() ?? null,
    session_open: !!expires_at && expires_at.getTime() > Date.now(),
    session_expires_at: expires_at?.toISOString() ?? null,
  };
}

function toApiMessage(row: WaMessage): ApiMessage {
  return {
    id: row.id,
    wamid: row.wamid,
    chat_id: row.chat_id,
    direction: row.direction,
    from_me: row.direction === "outbound",
    type: row.type,
    text: row.text,
    status: row.status,
    error:
      row.error_code != null || row.error_message != null
        ? { code: row.error_code, message: row.error_message }
        : null,
    reply_to: row.context_wamid,
    timestamp: row.message_at.toISOString(),
    media: row.media_id
      ? {
          media_id: row.media_id,
          mime_type: row.media_mime_type,
          filename: row.media_filename,
          file_size: row.media_file_size,
          status: row.media_status,
          url: `/media/${encodeURIComponent(row.media_id)}`,
        }
      : null,
    raw: row.payload,
  };
}

async function getChatOrThrow(chat_id: string) {
  const chat = await getChat(chat_id);
  if (!chat) throw new HttpError(404, "chat_not_found", `No chat with ${chat_id}`);
  return toApiChat(chat);
}

async function listChats(limit: number, offset: number) {
  return (await listChatRows(limit, offset)).map(toApiChat);
}

// Cursor: "<message_at ms>_<id>" of the last message of the previous page
function parseCursor(cursor: string | undefined) {
  if (!cursor) return undefined;
  const match = /^(\d+)_(\d+)$/.exec(cursor);
  if (!match) throw new HttpError(400, "invalid_cursor", "before must be a next_cursor value");
  return { message_at: new Date(Number(match[1])), id: Number(match[2]) };
}

async function getChatHistory(
  chat_id: string,
  limit: number,
  before?: string,
): Promise<ChatMessagesPage> {
  const chat = await getChatOrThrow(chat_id);
  const rows = await getChatMessageRows(chat_id, limit, parseCursor(before));
  const last = rows[rows.length - 1];

  return {
    chat,
    messages: rows.map(toApiMessage),
    next_cursor:
      rows.length === limit && last ? `${last.message_at.getTime()}_${last.id}` : null,
  };
}

export {
  toWaId,
  parseChatId,
  parseOutboundMessage,
  sendMessage,
  markAsRead,
  toApiMessage,
  getChatOrThrow,
  listChats,
  getChatHistory,
};
