/**
 * WhatsApp Cloud API (Meta Graph API) calls. Nothing here touches the
 * database; see services/ for that.
 */

import { config } from "./config.js";

export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly details?: string,
    readonly fbtrace_id?: string,
  ) {
    super(message);
  }
}

export type SendMessageResponse = {
  messaging_product: "whatsapp";
  contacts?: { input: string; wa_id: string }[];
  messages?: { id: string; message_status?: string }[];
};

export type MediaInfo = {
  id: string;
  // Valid for 5 minutes, and only with the access token
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
};

function graphUrl(path: string) {
  return `https://graph.facebook.com/${config.graphVersion}/${path}`;
}

function authHeader() {
  return { Authorization: `Bearer ${config.accessToken}` };
}

async function toGraphError(res: Response) {
  const body: any = await res.json().catch(() => ({}));
  const e = body?.error ?? {};
  return new GraphApiError(
    e.message ?? `${res.status} ${res.statusText}`,
    res.status,
    e.code,
    e.error_data?.details,
    e.fbtrace_id,
  );
}

async function graphRequest<T>(
  path: string,
  init: { method?: string; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(graphUrl(path), {
    method: init.method ?? "GET",
    headers: {
      ...authHeader(),
      ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw await toGraphError(res);
  return (await res.json()) as T;
}

// `payload` is the message object without messaging_product, e.g.
// { to, type: "text", text: { body } }.
export function sendMessage(payload: Record<string, unknown>) {
  return graphRequest<SendMessageResponse>(`${config.phoneNumberId}/messages`, {
    method: "POST",
    json: { messaging_product: "whatsapp", recipient_type: "individual", ...payload },
  });
}

// Shows blue ticks to the sender; with `typing`, also a typing indicator
// until the reply is sent (or 25 seconds pass).
export function markAsRead(wamid: string, typing = false) {
  return graphRequest<{ success: boolean }>(`${config.phoneNumberId}/messages`, {
    method: "POST",
    json: {
      messaging_product: "whatsapp",
      status: "read",
      message_id: wamid,
      ...(typing ? { typing_indicator: { type: "text" } } : {}),
    },
  });
}

export function getMediaInfo(media_id: string) {
  return graphRequest<MediaInfo>(encodeURIComponent(media_id));
}

// Starts the download of a media URL from getMediaInfo; the caller reads
// the body.
export async function downloadMedia(url: string) {
  const res = await fetch(url, {
    headers: authHeader(),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!res.ok || !res.body) throw await toGraphError(res);
  return res;
}

export function uploadMedia(file: Buffer, mime_type: string, filename: string) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime_type);
  form.append("file", new Blob([new Uint8Array(file)], { type: mime_type }), filename);

  return graphRequest<{ id: string }>(`${config.phoneNumberId}/media`, {
    method: "POST",
    form,
  });
}

export type GraphTemplateComponent = {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  // HEADER: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION
  format?: string;
  text?: string;
  example?: {
    header_text?: string[];
    body_text?: string[][];
    header_text_named_params?: { param_name: string; example: string }[];
    body_text_named_params?: { param_name: string; example: string }[];
  };
  buttons?: { type: string; text: string; url?: string; example?: string[] }[];
};

export type GraphTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameter_format?: "POSITIONAL" | "NAMED";
  components: GraphTemplateComponent[];
};

// All message templates of the WhatsApp Business Account, every status
export async function listTemplates(waba_id: string) {
  const templates: GraphTemplate[] = [];
  const fields = "name,language,status,category,parameter_format,components";
  let after: string | undefined;

  // At most 2,000 templates (20 pages of 100)
  for (let page = 0; page < 20; page++) {
    const res = await graphRequest<{
      data: GraphTemplate[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>(
      `${encodeURIComponent(waba_id)}/message_templates?fields=${fields}&limit=100` +
        (after ? `&after=${encodeURIComponent(after)}` : ""),
    );
    templates.push(...res.data);

    after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) break;
  }

  return templates;
}
