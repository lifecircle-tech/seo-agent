// Shapes of the WhatsApp service's HTTP API and forwarded events, shared by
// the service and its client (whatsapp/client.ts).

export type MediaType = "image" | "video" | "audio" | "document" | "sticker";

export type OutboundMessage =
  | { type: "text"; text: string; preview_url?: boolean }
  | {
      type: MediaType;
      // Exactly one of media_id (from POST /media) or a public https link
      media_id?: string;
      link?: string;
      caption?: string;
      filename?: string;
    }
  | {
      type: "template";
      template: {
        name: string;
        // Optional when the template exists in one language only
        language?: string;
        // Values by parameter key, as listed by GET /templates, e.g.
        // { "1": "Ravi", "header": "Andheri" }. The service builds the
        // components from the template.
        parameters?: Record<string, string>;
        // Or the raw Cloud API components, sent as they are
        components?: unknown[];
      };
    };

// An approved (or pending, rejected...) message template, from GET /templates
export type TemplateParameter = {
  // Key to pass in template.parameters: "1", "2"... (or the variable's name)
  // for the body, "header" for the header, "button_<index>" for a URL button
  key: string;
  component: "header" | "body" | "button";
  example: string | null;
};

export type WhatsappTemplate = {
  name: string;
  language: string;
  category: string;
  // APPROVED, PENDING, REJECTED, PAUSED, DISABLED
  status: string;
  header: string | null;
  body: string;
  footer: string | null;
  buttons: { type: string; text: string }[];
  parameters: TemplateParameter[];
  // false when it needs something the service cannot fill in, such as a
  // media header
  supported: boolean;
  unsupported_reason: string | null;
};

export type MessageDirection = "inbound" | "outbound";

// received: inbound. accepted → sent → delivered → read: outbound, as
// reported by WhatsApp status webhooks. failed: outbound, not delivered.
export type MessageStatus =
  | "received"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type SendResult = {
  chat_id: string;
  // null only if the message was sent but could not be stored
  message_id: number | null;
  wamid: string;
  status: "accepted";
};

export type ApiMedia = {
  media_id: string;
  mime_type: string | null;
  filename: string | null;
  file_size: number | null;
  status: "pending" | "stored" | "failed" | null;
  // Path on this service; GET it with the internal token to get the file
  url: string;
};

export type ApiMessage = {
  id: number;
  wamid: string | null;
  chat_id: string;
  direction: MessageDirection;
  from_me: boolean;
  type: string;
  // Message text, or a short description for non-text messages,
  // e.g. "[document: invoice.pdf] caption"
  text: string | null;
  status: MessageStatus;
  error: { code: number | null; message: string | null } | null;
  reply_to: string | null;
  timestamp: string;
  media: ApiMedia | null;
  // The message object as WhatsApp sent it (inbound) or as it was sent (outbound)
  raw: unknown;
};

export type ApiChat = {
  chat_id: string;
  phone: string;
  name: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  // Free-form messages can only be sent while the 24h window is open
  session_open: boolean;
  session_expires_at: string | null;
};

export type ChatMessagesPage = {
  chat: ApiChat;
  // Newest first
  messages: ApiMessage[];
  // Pass as ?before= for the next (older) page; null when there are no more
  next_cursor: string | null;
};

export type UploadedMedia = {
  media_id: string;
  mime_type: string;
  filename: string | null;
  file_size: number;
};

export type EventChat = {
  chat_id: string;
  phone: string;
  name: string | null;
  is_group: false;
};

// Posted to every WHATSAPP_FORWARD_WEBHOOK_URLS endpoint. The received
// event keeps the Timelines shape (event_type, chat.chat_id, chat.phone,
// chat.is_group), so existing Timelines webhook handlers keep working.
export type WhatsappEvent =
  | {
      event_type: "message:received:new";
      chat: EventChat;
      message: ApiMessage;
    }
  | {
      event_type: "message:status:updated";
      chat: EventChat;
      status: {
        wamid: string;
        status: string;
        timestamp: string;
        error: { code: number | null; message: string | null } | null;
      };
    };
