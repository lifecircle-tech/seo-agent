import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getApprovedTemplates,
  sendMessage,
  sendTemplateMessage,
  type SendMessageResult,
} from "../services/whatsapp.service";
import { notifyCareManager } from "../services/slack.service.js";
import {
  notifyMadhaviReport,
  notifyMissingInformation,
} from "../services/slack.service.js";
import { logger } from "../../madhavi/utils/logger.js";

// channel_id / thread_ts are set when the post went through the Slack Web
// API; the orchestrator uses them to link the thread to the user.
const slackOutputSchema = z.object({
  status: z.enum(["ok", "error"]),
  message: z.string(),
  purpose: z.string().optional(),
  channel_id: z.string().optional(),
  thread_ts: z.string().optional(),
});

const sendOutputSchema = z.object({
  status: z.string().optional(),
  message: z.string().optional(),
  chat_id: z.string().optional(),
  message_id: z.string().optional(),
});

// Runs a send and turns its result (or error) into the tool's reply.
async function toSendReply(tool: string, send: () => Promise<SendMessageResult>) {
  try {
    const data = await send();
    logger.debug(`[${tool}]`, data);

    const reply = {
      status: data.status,
      message: data.message,
      chat_id: data.chat_id,
      message_id: data.message_id,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(reply) }],
      structuredContent: reply,
    };
  } catch (err: any) {
    const error = {
      status: "error",
      message: `Something went wrong: ${err.message}`,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(error) }],
      structuredContent: error,
    };
  }
}

// WhatsApp messages to a phone, through the WhatsApp service. Free-form
// messages only reach people who wrote in the last 24 hours; anyone else
// can only be sent an approved template.
export function registerWhatsappMessage(server: McpServer) {
  server.registerTool(
    "send_whatsapp_message",
    {
      title: "Send WhatsApp Message",
      description:
        "Sends a WhatsApp message to a phone number. Phone number requires country code (e.g. +91). Only works if the person messaged in the last 24 hours; otherwise it tells you to send a template with 'send_whatsapp_template'",
      inputSchema: {
        phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
        message: z.string().max(1000),
      },
      outputSchema: sendOutputSchema,
    },
    async ({ phone, message }) =>
      toSendReply("send_whatsapp_message", () => sendMessage(phone, message)),
  );

  server.registerTool(
    "list_whatsapp_templates",
    {
      title: "List WhatsApp Templates",
      description:
        "Lists the approved WhatsApp message templates: what each says, its language, and the parameters it needs (key and example). Use it when 'send_whatsapp_message' says the person has not messaged in the last 24 hours",
      inputSchema: {},
      outputSchema: z.object({
        status: z.enum(["ok", "error"]),
        message: z.string().optional(),
        templates: z
          .array(
            z.object({
              name: z.string(),
              language: z.string(),
              category: z.string(),
              header: z.string().nullable(),
              body: z.string(),
              footer: z.string().nullable(),
              buttons: z.array(z.string()),
              parameters: z.array(
                z.object({
                  key: z.string(),
                  component: z.string(),
                  example: z.string().nullable(),
                }),
              ),
            }),
          )
          .optional(),
      }),
    },
    async () => {
      try {
        const templates = await getApprovedTemplates();
        const reply = templates.length
          ? { status: "ok" as const, templates }
          : {
              status: "error" as const,
              message:
                "No approved WhatsApp templates. Do not send anything; report it if the message was important.",
            };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(reply) }],
          structuredContent: reply,
        };
      } catch (err: any) {
        const error = {
          status: "error" as const,
          message: `Templates could not be listed: ${err.message}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(error) }],
          structuredContent: error,
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "send_whatsapp_template",
    {
      title: "Send WhatsApp Template",
      description:
        "Sends an approved WhatsApp template to a phone number (with country code, e.g. +91). Works at any time, including when the person has not messaged in the last 24 hours. Take the template name, language and parameter keys from 'list_whatsapp_templates', and give every parameter a value, e.g. { \"1\": \"Ravi ji\" }. Values are single lines",
      inputSchema: {
        phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
        template_name: z.string().min(1),
        language: z
          .string()
          .optional()
          .describe("Needed only when the template exists in several languages"),
        parameters: z
          .record(z.string(), z.string())
          .optional()
          .describe("Value for each parameter key the template lists"),
      },
      outputSchema: sendOutputSchema,
    },
    async ({ phone, template_name, language, parameters }) =>
      toSendReply("send_whatsapp_template", () =>
        sendTemplateMessage(phone, { name: template_name, language, parameters }),
      ),
  );
}

// Tools for reporting to Slack
export function registerSlackMessage(server: McpServer) {
  // Notify a care manager via Slack.
  server.registerTool(
    "send_message_to_cm",
    {
      title: "Send Slack message to CM",
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
