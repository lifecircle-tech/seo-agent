import "dotenv/config";

export const config = {
  internalToken: process.env.INTERNAL_API_TOKEN ?? "",
  forwardUrl: (
    process.env.WHATSAPP_INTERNAL_WEBHOOK_URL ?? "http://localhost:3003/webhook"
  ).replace(/\/+$/, ""),
};
