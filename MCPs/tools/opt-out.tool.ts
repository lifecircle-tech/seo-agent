import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { optOutFromAgent } from "../../madhavi/services/lc-opt-out.service.js";
import { logger } from "../../madhavi/utils/logger.js";

// Records that a person asked not to be messaged on WhatsApp. Once
// recorded, 'send_whatsapp_message' refuses to message them.
export function registerMessagingOptOut(server: McpServer) {
  server.registerTool(
    "record_messaging_opt_out",
    {
      title: "Record Messaging Opt-Out",
      description:
        "Stops ALL future WhatsApp messages to a person who explicitly asked not to be messaged anymore, and sends them a confirmation. Irreversible by the agent. Never use for a request to stop one topic or reminder.",
      inputSchema: {
        cg_id: z.number().describe("cg_id of the person"),
        user_message: z
          .string()
          .min(1)
          .max(1000)
          .describe(
            "Exact full text of the person's message asking to stop all messages, unchanged",
          ),
        reason: z
          .string()
          .max(500)
          .describe("Why this message is an explicit request to stop all messages"),
      },
      outputSchema: z.object({
        status: z.enum(["ok", "error"]),
        message: z.string(),
      }),
    },
    async ({ cg_id, user_message, reason }) => {
      let result: { status: "ok" | "error"; message: string };
      try {
        result = await optOutFromAgent({
          hp_unique_id: cg_id,
          user_message,
          reason,
        });
      } catch (err: any) {
        logger.error("[record_messaging_opt_out]", err);
        result = {
          status: "error",
          message: `Something went wrong: ${err.message}. Opt-out not recorded; report it with 'ask_missing_in_slack'.`,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result.status === "error",
      };
    },
  );
}
