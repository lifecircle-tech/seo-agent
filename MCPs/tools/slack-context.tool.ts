import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  postSlackThreadReply,
  readSlackThread,
} from "../services/slack.service.js";
import { getSlackThreadsContext } from "../../madhavi/services/lc-slack-conversation.service.js";
import { getSlackConversationById } from "../../madhavi/models/lc-slack-conversation.model.js";

// Tools that give the agent the care team's Slack context for a user.
export function registerSlackContext(server: McpServer) {
  server.registerTool(
    "get_slack_context",
    {
      title: "Get Slack Context",
      description:
        "Get the Slack threads raised about a caregiver (by cg_id / hp_unique_id) and the care team's replies to them, newest thread first",
      inputSchema: {
        hp_unique_id: z.number(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      outputSchema: z.object({
        threads: z.array(
          z.object({
            thread_id: z.number(),
            purpose: z.string(),
            reported_at: z.string(),
            report: z.string(),
            status: z.string(),
            replies: z.array(
              z.object({
                reply_id: z.number(),
                from: z.string(),
                message: z.string(),
                at: z.string(),
                relay_status: z.string(),
              }),
            ),
          }),
        ),
      }),
    },
    async ({ hp_unique_id, limit }) => {
      const threads = await getSlackThreadsContext(hp_unique_id, limit ?? 5);

      return {
        content: [{ type: "text", text: JSON.stringify({ threads }) }],
        structuredContent: { threads },
      };
    },
  );

  server.registerTool(
    "read_slack_thread",
    {
      title: "Read Slack Thread",
      description:
        "Read every message of a Slack thread live from Slack, including discussion not stored as replies. Use thread_id from 'get_slack_context'",
      inputSchema: {
        thread_id: z.number(),
      },
      outputSchema: z.object({
        status: z.enum(["ok", "error"]),
        message: z.string().optional(),
        messages: z
          .array(
            z.object({
              from: z.enum(["agent", "care_team"]),
              user: z.string().optional(),
              text: z.string(),
              ts: z.string(),
            }),
          )
          .optional(),
      }),
    },
    async ({ thread_id }) => {
      let result;
      try {
        const conversation = await getSlackConversationById(thread_id);
        result = conversation
          ? {
              status: "ok" as const,
              messages: await readSlackThread(
                conversation.channel_id,
                conversation.thread_ts,
              ),
            }
          : {
              status: "error" as const,
              message: `Slack thread ${thread_id} not found`,
            };
      } catch (err: any) {
        result = {
          status: "error" as const,
          message: `Something went wrong: ${err.message}`,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result.status === "error",
      };
    },
  );

  server.registerTool(
    "reply_in_slack_thread",
    {
      title: "Reply in Slack Thread",
      description:
        "Post an update in a Slack thread about this person (e.g. their reply to a care team request). Use thread_id from the Slack threads context or 'get_slack_context'",
      inputSchema: {
        thread_id: z.number(),
        message: z.string().max(3000),
      },
      outputSchema: z.object({
        status: z.enum(["ok", "error"]),
        message: z.string(),
      }),
    },
    async ({ thread_id, message }) => {
      const conversation = await getSlackConversationById(thread_id);
      const result = conversation
        ? await postSlackThreadReply(
            conversation.channel_id,
            conversation.thread_ts,
            message,
          )
        : {
            status: "error" as const,
            message: `Slack thread ${thread_id} not found`,
          };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result.status === "error",
      };
    },
  );
}
