import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendMessage } from "../services/timelines.service.js";
import { notifyCareManager } from "../services/slack.service.js";
import { logger } from "../../seo-agent/utils/logger.js";

// Send message to whatsapp through timeline for a given phone.
export function registerWhatsappMessage(server: McpServer) {
  server.registerTool(
    "send_whatsapp_message",
    {
      title: "Send WhatsApp Message",
      description:
        "Sends a message to WhatsApp number through the Timeline service. Phone number requires country code (e.g. +91)",
      inputSchema: {
        phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
        message: z.string().max(1000),
      },
      outputSchema: z.object({
        status: z.string().optional(),
        message: z.string().optional(),
        chat_id: z.string().optional(),
      }),
    },
    async ({ phone, message }) => {
      const data = await sendMessage(phone, message);
      logger.log("TIMELINE Send ", data);

      const reply = {
        status: data.status ?? undefined,
        message: data.message ?? undefined,
        chat_id: data.chat_id != null ? String(data.chat_id) : undefined,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(reply) }],
        structuredContent: reply,
      };
    },
  );
}

// Notify a care manager via Slack.
export function registerSlackMessage(server: McpServer) {
  server.registerTool(
    "send_slack_message",
    {
      title: "Send Slack Message",
      description:
        "Sends a Slack message to a care manager by care manager id.",
      inputSchema: {
        cm_id: z.number(),
        message: z.string().max(1000),
      },
      outputSchema: z.object({
        status: z.string().optional(),
        message: z.string().optional(),
      }),
    },
    async ({ cm_id, message }) => {
      const data = await notifyCareManager(cm_id, message);
      logger.log("SLACK Send ", cm_id, message);

      const reply = {
        status: data.status ?? undefined,
        message: data.message ?? undefined,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(reply) }],
        structuredContent: reply,
      };
    },
  );
}
