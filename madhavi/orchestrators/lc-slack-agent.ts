import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger";
import { connectMcp } from "./lc-orchestrator";
import {
  getAgentsPrompt,
  getTenantsSpecificPrompt,
} from "../services/prompts.service";
import { getTenantsTools } from "../services/tenants-tools.service";
import {
  getAgentTools,
  getAgentDocumentTools,
  getAgentSkillTools,
} from "../services/agent.service";
import { recordTenantAgentTokensUsage } from "../services/tenant-token-usage.service";
import { linkWhatsappRecipientToSlackThread } from "../services/lc-slack-conversation.service";
import { resolveChatIdLater } from "../services/timelines.service";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 100 * 1000,
  maxRetries: 1,
});

const SLACK_AGENT_MODEL = "claude-haiku-4-5";
// Upper bound on model turns, so a tool loop can never run forever.
const MAX_TURNS = 10;

const SLACK_AGENT_PROMPT = `
You work for LifeCircle and are replying in a Slack thread to LifeCircle employees.
- Answer the latest request, using the earlier thread messages as context.
- Use tools to get data; never guess or invent records.
- If the tools cannot answer the request, say so briefly and what is missing.
- Format for Slack mrkdwn (*bold*, bullet lists with •). No markdown tables or headings.
- Be concise.
`;

export type SlackThreadMessage = { from: string; text: string };

// The Slack thread this run answers in; caregivers messaged on WhatsApp
// during the run are linked to it.
export type SlackThreadRef = {
  channel_id: string;
  thread_ts: string;
  purpose: string;
};

// Runs a channel's dedicated agent for a Slack request and returns the
// text to post back in the thread. Independent of the WhatsApp agent runs.
export async function runSlackChannelAgent({
  agent_key,
  thread,
  slack_thread,
}: {
  agent_key: string;
  thread: SlackThreadMessage[];
  slack_thread: SlackThreadRef;
}) {
  const { mcpClient, anthropicTools } = await connectMcp();

  try {
    const { agent_id, prompt } = await getAgentsPrompt({ key: agent_key });
    const tenant_prompt = await getTenantsSpecificPrompt(1, agent_id);
    const mcp_tools = new Set([
      ...(await getAgentTools({ agent_id })),
      ...(await getTenantsTools({ tenant_id: 1, agent_id })),
      "caregiver_llm_search",
      // ...extra_tools,
    ]);
    const document_tools = await getAgentDocumentTools({ agent_id });
    const skill_tools = await getAgentSkillTools({ agent_id });
    const local_tool_content = new Map([
      ...document_tools.map((d) => [d.tool.name, d.content] as const),
      ...skill_tools.map((s) => [s.tool.name, s.content] as const),
    ]);

    const tools = [
      ...anthropicTools.filter((t) => mcp_tools.has(t.name)),
      ...document_tools.map((d) => d.tool),
      ...skill_tools.map((s) => s.tool),
    ];
    logger.log("slack agent tools ", agent_key, Array.from(mcp_tools));

    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: [prompt, tenant_prompt].filter(Boolean).join("\n\n"),
        cache_control: { type: "ephemeral" },
      },
    ];

    const messages: Anthropic.MessageParam[] = thread.map((m) => ({
      role: m.from === "agent" ? "assistant" : "user",
      content: m.text,
    }));

    //     const messages: Anthropic.MessageParam[] = [
    //       {
    //         role: "user",
    //         content: `SLACK THREAD (oldest first):\n${JSON.stringify(thread)}

    // LATEST REQUEST from ${requested_by}:\n${request}`,
    //       },
    //     ];

    const request_started_at = new Date().toISOString();
    let request_completed_at = request_started_at;
    let input_tokens = 0;
    let output_tokens = 0;
    let answer = "";

    // for (let turn = 0; turn < MAX_TURNS; turn++) {
    while (true) {
      const response = await client.messages.create({
        model: SLACK_AGENT_MODEL,
        max_tokens: 2000,
        tools,
        system,
        messages,
      });
      request_completed_at = new Date().toISOString();
      input_tokens += response.usage.input_tokens;
      output_tokens += response.usage.output_tokens;
      logger.log("Stop Reason ", response.stop_reason);
      logger.log("USAGE ", response.usage);

      messages.push({ role: "assistant", content: response.content });
      const toolCalls = response.content.filter(
        (block) => block.type === "tool_use",
      );

      if (toolCalls.length === 0) {
        answer = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolCall of toolCalls) {
        logger.log(`🤖 Slack agent requested tool [${toolCall.name}]`);

        if (local_tool_content.has(toolCall.name)) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: local_tool_content.get(toolCall.name) ?? "",
          });
          continue;
        }

        try {
          const result = await mcpClient.callTool({
            name: toolCall.name,
            arguments: toolCall.input as Record<string, unknown>,
          });
          const content = result.content as Array<{
            type: string;
            text?: string;
          }>;

          // Link the caregiver just messaged to this Slack thread, so their
          // reply can be reported back here.
          const structuredContent = result.structuredContent as
            | Record<string, unknown>
            | undefined;
          if (
            toolCall.name === "send_whatsapp_message" &&
            !result.isError &&
            structuredContent?.status === "ok"
          ) {
            const input = toolCall.input as Record<string, unknown>;
            const link = (chat_id: string) =>
              linkWhatsappRecipientToSlackThread({
                ...slack_thread,
                chat_id,
                phone: String(input["phone"] ?? ""),
                agent_key,
                message: String(input["message"] ?? ""),
              });

            // Timelines may not have assigned the chat yet: link it once known
            if (structuredContent.chat_id) {
              await link(String(structuredContent.chat_id));
            } else if (structuredContent.message_id) {
              resolveChatIdLater(String(structuredContent.message_id), link);
            }
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: content
              .filter((item) => item.type === "text")
              .map((item) => item.text ?? "")
              .join("\n"),
            is_error: !!result.isError,
          });
        } catch (err: any) {
          logger.error(`[slack agent] tool ${toolCall.name} failed`, err);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Tool failed: ${err.message}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    await recordTenantAgentTokensUsage({
      tenant_id: String(1),
      agent_id: String(agent_id),
      input_tokens,
      output_tokens,
      request_started_at,
      request_completed_at,
    });

    return answer || "Sorry, I couldn't complete that request.";
  } finally {
    await mcpClient.close();
  }
}
