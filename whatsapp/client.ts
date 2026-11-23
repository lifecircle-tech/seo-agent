/**
 * Client for the WhatsApp service (whatsapp/server.ts), for code in other
 * processes such as Madhavi and the MCP tools.
 *
 * Env: WHATSAPP_SERVICE_URL (default http://localhost:3003), INTERNAL_API_TOKEN.
 */

import type {
  ApiChat,
  ChatMessagesPage,
  OutboundMessage,
  SendResult,
  UploadedMedia,
  WhatsappTemplate,
} from "./types.js";

export class WhatsappServiceError extends Error {
  constructor(
    readonly status: number,
    // e.g. "invalid_phone", "outside_session_window", "whatsapp_api_error"
    readonly code: string | undefined,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function baseUrl() {
  return (process.env.WHATSAPP_SERVICE_URL ?? "http://localhost:3003").replace(/\/+$/, "");
}

function authHeader() {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) throw new Error("Missing env var INTERNAL_API_TOKEN");
  return { "x-internal-token": token };
}

async function call(path: string, init: { method?: string; json?: unknown; body?: Buffer; contentType?: string } = {}) {
  const contentType = init.json !== undefined ? "application/json" : init.contentType;
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers: { ...authHeader(), ...(contentType ? { "Content-Type": contentType } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body ? new Uint8Array(init.body) : undefined,
  });

  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    throw new WhatsappServiceError(
      res.status,
      body.code,
      body.error ?? `${res.status} ${res.statusText}`,
      body.details,
    );
  }
  return res;
}

async function request<T>(path: string, init?: Parameters<typeof call>[1]): Promise<T> {
  const body: any = await (await call(path, init)).json();
  return body.data as T;
}

function sendMessage(to: string, message: OutboundMessage, options: { reply_to?: string } = {}) {
  return request<SendResult>("/messages", {
    method: "POST",
    json: { to, ...message, ...options },
  });
}

export const whatsapp = {
  sendMessage,

  // Only within 24h of the person's last message; otherwise use sendTemplate
  sendText: (to: string, text: string, options: { reply_to?: string } = {}) =>
    sendMessage(to, { type: "text", text }, options),

  // An approved template by name, with values by parameter key as listed by
  // listTemplates, e.g. { "1": "Ravi" }. Allowed outside the 24h window.
  sendTemplate: (
    to: string,
    template: {
      name: string;
      language?: string;
      parameters?: Record<string, string>;
      components?: unknown[];
    },
  ) => sendMessage(to, { type: "template", template }),

  // Templates of every status; filter on status === "APPROVED" && supported
  listTemplates: (options: { refresh?: boolean } = {}) =>
    request<WhatsappTemplate[]>(`/templates${options.refresh ? "?refresh=true" : ""}`),

  sendDocument: (
    to: string,
    document: { media_id?: string; link?: string; filename?: string; caption?: string },
  ) => sendMessage(to, { type: "document", ...document }),

  markAsRead: (wamid: string, options: { typing?: boolean } = {}) =>
    call(`/messages/${encodeURIComponent(wamid)}/read`, { method: "POST", json: options }).then(() => undefined),

  // chat_id is the person's WhatsApp number (digits, or "+" and digits)
  getChat: (chat_id: string) => request<ApiChat>(`/chats/${encodeURIComponent(chat_id)}`),

  // Newest first
  getChatMessages: (chat_id: string, options: { limit?: number; before?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", String(options.limit));
    if (options.before) query.set("before", options.before);
    const qs = query.toString();
    return request<ChatMessagesPage>(
      `/chats/${encodeURIComponent(chat_id)}/messages${qs ? `?${qs}` : ""}`,
    );
  },

  uploadMedia: (file: Buffer, mime_type: string, filename?: string) =>
    request<UploadedMedia>(
      `/media${filename ? `?filename=${encodeURIComponent(filename)}` : ""}`,
      { method: "POST", body: file, contentType: mime_type },
    ),

  // The file of a received (or sent) media item, e.g. a document a person sent
  downloadMedia: async (media_id: string) => {
    const res = await call(`/media/${encodeURIComponent(media_id)}`);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mime_type: res.headers.get("content-type"),
    };
  },
};
