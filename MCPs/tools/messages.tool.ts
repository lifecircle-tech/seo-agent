import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendMessage } from "../services/timelines.service.js";
import { notifyCareManager } from "../services/slack.service.js";
import {
  notifyMadhaviReport,
  notifyMissingInformation,
} from "../services/slack.service.js";

const slackOutputSchema = z.object({
  status: z.enum(["ok", "error"]),
  message: z.string(),
});

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
      try {
        const data = await sendMessage(phone, message);

        const reply = {
          status: data.status ?? undefined,
          message: data.message ?? undefined,
          chat_id: data.chat_id != null ? String(data.chat_id) : undefined,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(reply) }],
          structuredContent: reply,
        };
      } catch (err: any) {
        const error = {
          status: "error",
          message: `Failed to send timeline message: ${err.message}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(error) }],
          structuredContent: error,
        };
      }
    },
  );
}

// Tools for reporting to Slack
export function registerSlackMessage(server: McpServer) {
  // Notify a care manager via Slack.
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
      outputSchema: slackOutputSchema,
    },
    async ({ cm_id, message }) => {
      const data = await notifyCareManager(cm_id, message);

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

  server.registerTool(
    "report_to_slack",
    {
      title: "Report to Slack",
      description: "Send a report or emergency alert message to Slack channel",
      inputSchema: {
        message: z.string(),
      },
      outputSchema: slackOutputSchema,
    },
    async ({ message }) => {
      const result = await notifyMadhaviReport(message);

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result.status === "error",
      };
    },
  );

  server.registerTool(
    "ask_missing_in_slack",
    {
      title:
        "Ask Missing Information, suggestion or report tool error to Slack",
      description:
        "Post about missing information in documents, improvements, suggestions or report tool error to Slack channel",
      inputSchema: {
        message: z.string(),
      },
      outputSchema: slackOutputSchema,
    },
    async ({ message }) => {
      const result = await notifyMissingInformation(message);

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result.status === "error",
      };
    },
  );
}
