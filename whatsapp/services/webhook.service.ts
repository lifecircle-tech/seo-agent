/**
 * Processes WhatsApp webhook payloads: stores received messages and their
 * media, applies delivery statuses, and forwards both as events.
 *
 * Payload reference:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */

import { config } from "../config.js";
import { logger } from "../logger.js";
import { upsertChat } from "../models/chat.model.js";
import { insertMedia } from "../models/media.model.js";
import {
  getMessageById,
  insertMessage,
  updateMessageStatus,
} from "../models/message.model.js";
import type { EventChat } from "../types.js";
import { forwardEvent } from "./events.service.js";
import { downloadInBackground } from "./media.service.js";
import { toApiMessage } from "./messages.service.js";

type InboundMedia = {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
};

type InboundMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  context?: { from?: string; id?: string };
  [field: string]: any;
};

type WebhookError = {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
};

type StatusUpdate = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
  errors?: WebhookError[];
};

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

// WhatsApp timestamps are unix seconds, as strings
function fromUnix(timestamp: string) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

function eventChat(chat_id: string, name: string | null = null): EventChat {
  return { chat_id, phone: `+${chat_id}`, name, is_group: false };
}

function getInboundMedia(message: InboundMessage): InboundMedia | null {
  const media = MEDIA_TYPES.has(message.type) ? message[message.type] : null;
  return media?.id ? media : null;
}

// The message as text, so agents reading the history can follow it
function describeInbound(m: InboundMessage): string | null {
  const withCaption = (label: string, media?: InboundMedia) =>
    [label, media?.caption].filter(Boolean).join(" ");

  switch (m.type) {
    case "text":
      return m.text?.body ?? null;
    case "image":
      return withCaption("[image]", m.image);
    case "video":
      return withCaption("[video]", m.video);
    case "document":
      return withCaption(`[document: ${m.document?.filename ?? "file"}]`, m.document);
    case "audio":
      return m.audio?.voice ? "[voice message]" : "[audio]";
    case "sticker":
      return "[sticker]";
    case "location": {
      const l = m.location ?? {};
      const place = [l.name, l.address].filter(Boolean).join(", ");
      return `[location: ${place ? `${place} ` : ""}(${l.latitude}, ${l.longitude})]`;
    }
    case "contacts": {
      const people = (m.contacts ?? [])
        .map((c: any) =>
          [c.name?.formatted_name, c.phones?.[0]?.phone].filter(Boolean).join(" "),
        )
        .filter(Boolean);
      return `[contact: ${people.join(", ")}]`;
    }
    case "interactive": {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return reply?.title ?? "[interactive reply]";
    }
    case "button":
      // Quick reply button on a template
      return m.button?.text ?? null;
    case "reaction":
      return m.reaction?.emoji ? `[reacted ${m.reaction.emoji}]` : "[removed reaction]";
    case "system":
      return m.system?.body ?? "[system message]";
    default:
      // unsupported, order, request_welcome, ...
      return `[${m.type}]`;
  }
}

async function handleInboundMessage(message: InboundMessage, profile_name: string | null) {
  const chat_id = String(message.from);
  const message_at = fromUnix(message.timestamp);
  const media = getInboundMedia(message);

  await upsertChat({
    chat_id,
    phone_number_id: config.phoneNumberId,
    profile_name,
    last_inbound_at: message_at,
    last_message_at: message_at,
  });

  if (media) {
    await insertMedia({
      media_id: media.id,
      direction: "inbound",
      mime_type: media.mime_type ?? null,
      filename: media.filename ?? null,
      sha256: media.sha256 ?? null,
    });
  }

  const id = await insertMessage({
    wamid: message.id,
    chat_id,
    direction: "inbound",
    type: message.type,
    text: describeInbound(message),
    media_id: media?.id ?? null,
    context_wamid: message.context?.id ?? null,
    status: "received",
    payload: message,
    message_at,
  });

  // Already handled: WhatsApp retries a webhook until it gets a 200
  if (id == null) {
    logger.log(`[whatsapp] message ${message.id} already received`);
    return;
  }

  logger.log(`[whatsapp] received ${message.type} ${message.id} from ${chat_id}`);

  if (media) downloadInBackground(media.id);

  const row = await getMessageById(id);
  forwardEvent({
    event_type: "message:received:new",
    chat: eventChat(chat_id, profile_name),
    message: toApiMessage(row),
  });
}

async function handleStatus(status: StatusUpdate) {
  const error = status.errors?.[0];
  const error_message = error
    ? [error.title ?? error.message, error.error_data?.details].filter(Boolean).join(": ")
    : null;
  const status_at = fromUnix(status.timestamp);

  await updateMessageStatus({
    wamid: status.id,
    status: status.status,
    status_at,
    error_code: error?.code ?? null,
    error_message,
  });

  if (status.status === "failed") {
    logger.warn(
      `[whatsapp] message ${status.id} to ${status.recipient_id} failed: ${error?.code} ${error_message}`,
    );
  }

  forwardEvent({
    event_type: "message:status:updated",
    chat: eventChat(String(status.recipient_id)),
    status: {
      wamid: status.id,
      status: status.status,
      timestamp: status_at.toISOString(),
      error: error ? { code: error.code ?? null, message: error_message } : null,
    },
  });
}

// Throws on a database error, so the route answers 500 and WhatsApp
// retries the webhook. Already stored messages are skipped on retry.
export async function handleWebhook(body: any) {
  if (body?.object !== "whatsapp_business_account") {
    logger.warn(`[whatsapp] ignored webhook for object '${body?.object}'`);
    return;
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") {
        logger.log(`[whatsapp] ignored webhook field '${change.field}'`);
        continue;
      }

      const value = change.value ?? {};
      const phone_number_id = value.metadata?.phone_number_id;
      if (phone_number_id !== config.phoneNumberId) {
        logger.warn(`[whatsapp] ignored webhook for phone number id ${phone_number_id}`);
        continue;
      }

      const names = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) {
          names.set(String(contact.wa_id), contact.profile.name);
        }
      }

      for (const message of value.messages ?? []) {
        await handleInboundMessage(message, names.get(String(message.from)) ?? null);
      }
      for (const status of value.statuses ?? []) {
        await handleStatus(status);
      }
      for (const error of value.errors ?? []) {
        logger.error("[whatsapp] webhook error", error);
      }
    }
  }
}
