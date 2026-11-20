import "dotenv/config";
import path from "node:path";

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.WHATSAPP_PORT ?? 3003),
  databaseUrl:
    process.env.WHATSAPP_DATABASE_URL ?? "mysql://root:@localhost:3306/whatsapp",
  dbAutoInit: process.env.DB_AUTO_INIT !== "false",

  // WhatsApp Cloud API (Meta app → WhatsApp → API setup)
  graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? "v25.0",
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  // WhatsApp Business Account ID (API setup), to list message templates.
  // Without it, templates can only be sent with raw components.
  businessAccountId: process.env.WHATSAPP_WABA_ID ?? "",

  // Webhooks (Meta app → WhatsApp → Configuration)
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",

  // Callers of this service send it in the x-internal-token header; it is
  // also sent to the forward URLs.
  internalToken: process.env.INTERNAL_API_TOKEN ?? "",

  // Received events are posted to each of these
  forwardUrls: list(process.env.WHATSAPP_FORWARD_WEBHOOK_URLS),

  mediaDir: path.resolve(
    process.cwd(),
    process.env.WHATSAPP_MEDIA_DIR ?? "storage/whatsapp-media",
  ),
  // WhatsApp's largest media type (documents) is 100 MB
  maxUploadBytes: 100 * 1024 * 1024,

  // Refuse free-form messages outside the 24h customer service window
  // instead of letting WhatsApp drop them. Set to false during the cut-over
  // from Timelines, when recent conversations are not in this database yet.
  enforceSessionWindow: process.env.WHATSAPP_ENFORCE_SESSION_WINDOW !== "false",
};

export function assertConfig() {
  const required: Record<string, string> = {
    WHATSAPP_ACCESS_TOKEN: config.accessToken,
    WHATSAPP_PHONE_NUMBER_ID: config.phoneNumberId,
    WHATSAPP_APP_SECRET: config.appSecret,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: config.webhookVerifyToken,
    INTERNAL_API_TOKEN: config.internalToken,
  };
  const missing = Object.keys(required).filter((name) => !required[name]);

  if (missing.length) {
    throw new Error(
      `[whatsapp] missing env vars: ${missing.join(", ")} — refusing to start`,
    );
  }
}
