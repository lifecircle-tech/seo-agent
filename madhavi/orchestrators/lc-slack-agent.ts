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

// Kept in code, not in the editable agent prompt, and placed after it: the
// recruitment rules themselves are enforced by the tools
// (MCPs lc-recruitment.service).
const RECRUITMENT_PROMPT = `
RECRUITMENT TOOLS (these rules override any other tool instructions above):
The booking_id comes from the lead. Every caregiver approached for it is tracked with a status:
contacted -> on_hold (interested) -> placed; released (declined, not selected, or recruitment completed); no_response (no reply within 4 hours, set automatically).
Message caregivers ONLY with these tools. 'send_whatsapp_message' and 'search_state' are not available here, and you never need a caregiver's phone number:
- First offer for a booking: 'contact_caregiver_for_booking', one call per caregiver; it records them as contacted. Filter search results with 'check_caregivers_for_booking' first and never contact one it refuses.
- Any later message to a caregiver already contacted for the booking (updates, answers from staff, selection confirmation, case filled or closed): 'message_booking_caregiver'.
- Caregiver interested, declined, or rejected by staff: 'update_recruitment_status'. 'on_hold' here means the caregiver is interested; it is not the "hold" described above.
- Staff confirm a caregiver: 'place_caregiver_for_booking' (it releases everyone else on the booking), then in the same run 'message_booking_caregiver' to the placed caregiver and to every released caregiver who was interested or awaiting a reply.
- Lead closed or client not going ahead: 'close_booking_recruitment', then 'message_booking_caregiver' to every caregiver who was interested or awaiting a reply.
- Status questions: answer from 'get_booking_recruitment'.

ACTING:
- Your earlier replies in this thread are only text and prove nothing. What was really done is in the recruitment records and in the "Done in this run" lines under earlier replies.
- Start every run by reading the current records for the booking.
- When staff ask for something you can do, do it now with tools in this run, then report. Never write that something is done, sent, placed, released, closed, started or in progress unless a tool in this run returned ok for it.
- If you still need something from staff, ask for it; do not announce work you have not done.
- If a tool refuses or fails, tell staff plainly, with its reason.
`;

const RECRUITMENT_TOOLS = new Set([
  "get_booking_recruitment",
  "contact_caregiver_for_booking",
]);

// Tools whose successful call messaged a caregiver on WhatsApp.
const WHATSAPP_SEND_TOOLS = new Set([
  "send_whatsapp_message",
  "contact_caregiver_for_booking",
  "message_booking_caregiver",
]);

// Tools that change something: their results are listed under the reply.
const ACTION_TOOLS = new Set([
  "contact_caregiver_for_booking",
  "message_booking_caregiver",
  "update_recruitment_status",
  "place_caregiver_for_booking",
  "close_booking_recruitment",
]);

// What a reply may claim, and the tools of which one must have succeeded
// in the same run for the claim to be true. The model sometimes reports
// work it never did, or announces work and stops.
const ACTION_CLAIMS: { claim: RegExp; tools: string[] }[] = [
  {
    claim:
      /\b(i(?:'ve| have)? (?:sent|messaged|notified|informed|contacted)|sent (?:the |a |an )?(?:confirmation|message|offer|notice|closure|update)|(?:messages?|offers?|confirmations?|notices?) (?:has |have )?(?:been )?sent|i(?:'ll| will| am going to) (?:now )?(?:contact|message|send|notify|inform))/i,
    tools: ["contact_caregiver_for_booking", "message_booking_caregiver"],
  },
  {
    claim:
      /\b(search (?:has )?started|started (?:the )?search(?:ing)?|i(?:'m| am) (?:now )?(?:searching|contacting)|i(?:'ll| will) (?:now )?(?:search|start searching|start contacting))/i,
    tools: ["caregiver_llm_search"],
  },
  {
    claim:
      /\b(has been placed|i(?:'ve| have)? placed|caregiver placed|placement (?:is )?(?:recorded|confirmed|done))/i,
    tools: ["place_caregiver_for_booking"],
  },
  {
    claim:
      /\b(i(?:'ve| have)? (?:released|closed)|(?:has|have) been (?:released|closed)|(?:booking|lead|recruitment)[^.\n]{0,20} (?:is )?(?:now )?closed)/i,
    tools: [
      "place_caregiver_for_booking",
      "close_booking_recruitment",
      "update_recruitment_status",
    ],
  },
  {
    claim:
      /\b((?:marked|recorded|updated) (?:as |to )?(?:on hold|interested|declined|released|not selected)|i(?:'ve| have)(?: already)? recorded)/i,
    tools: ["update_recruitment_status", "place_caregiver_for_booking"],
  },
];

const UNVERIFIED_ACTION_NUDGE = `Your reply says something was done or is being done, but no tool did it in this run. Earlier replies in the thread are not proof of action.
- If staff asked for it and you have what you need, call the tools now.
- If you still need something from staff, ask for it without announcing the work.
- If you are only reporting records you read in this run, send your reply again without saying you did it.`;

// "Once you confirm the pay, I'll contact caregivers" is a plan, not a claim.
const CONDITIONAL_SENTENCE = /\b(once|as soon as|after|when|if|until|before)\b/i;

// Claims in the reply that no successful tool call of this run backs.
export function getUnverifiedClaims(answer: string, succeeded: Set<string>) {
  const sentences = answer.split(/(?<=[.!?:])\s+|\n+/);

  return ACTION_CLAIMS.filter(({ tools }) => !tools.some((t) => succeeded.has(t)))
    .flatMap(({ claim }) =>
      sentences.filter((s) => claim.test(s) && !CONDITIONAL_SENTENCE.test(s)),
    )
    .map((s) => s.trim());
}

function describeAction(
  name: string,
  input: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
) {
  const cg = `cg ${input["cg_id"]}`;
  switch (name) {
    case "contact_caregiver_for_booking":
      return `offer sent to ${cg}`;
    case "message_booking_caregiver":
      return `message sent to ${cg}`;
    case "update_recruitment_status":
      return `${cg} ${input["status"]}`;
    case "place_caregiver_for_booking": {
      const released = Array.isArray(result?.["released"])
        ? result["released"].length
        : 0;
      return `${cg} placed${released ? `, ${released} released` : ""}`;
    }
    case "close_booking_recruitment":
      return `recruitment closed, ${result?.["released"] ?? 0} released`;
    default:
      return name;
  }
}

// Code-generated record of what the run really changed, posted under the
// reply: staff can trust it, and later runs see it in the thread.
function formatActionsFooter(done: string[], not_done: string[]) {
  const lines = [];
  if (done.length > 0) lines.push(`_Done in this run: ${done.join(" · ")}_`);
  if (not_done.length > 0) {
    lines.push(`_Not done: ${not_done.join(" · ")}_`);
  }
  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}

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
  extra_tools = [],
  exclude_tools = [],
  thread,
  slack_thread,
}: {
  agent_key: string;
  // MCP tools the channel adds on top of the agent's granted tools
  extra_tools?: string[];
  // Granted tools the channel's agent must not use
  exclude_tools?: string[];
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
      ...extra_tools,
    ]);
    for (const tool of exclude_tools) mcp_tools.delete(tool);
    const has_recruitment_tools = [...RECRUITMENT_TOOLS].some((t) =>
      mcp_tools.has(t),
    );
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
        text: [
          prompt,
          tenant_prompt,
          has_recruitment_tools && RECRUITMENT_PROMPT,
        ]
          .filter(Boolean)
          .join("\n\n"),
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
    let turn = 0;
    let nudged = false;
    // Tools that returned ok in this run, and what the run changed
    const succeeded = new Set<string>();
    const done: string[] = [];
    const not_done: string[] = [];

    // for (let turn = 0; turn < MAX_TURNS; turn++) {
    while (true) {
      const response = await client.messages.create({
        model: SLACK_AGENT_MODEL,
        max_tokens: 2000,
        tools,
        system,
        messages,
        // The first step of a recruitment run is always a tool call, so the
        // reply is grounded in the records rather than in earlier replies.
        ...(turn === 0 &&
          has_recruitment_tools && { tool_choice: { type: "any" as const } }),
      });
      turn++;
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

        // Sent back once when it reports or announces work no tool did
        const unverified = getUnverifiedClaims(answer, succeeded);
        if (has_recruitment_tools && unverified.length > 0 && !nudged) {
          nudged = true;
          logger.warn("[slack agent] reply claims unperformed actions", unverified);
          messages.push({ role: "user", content: UNVERIFIED_ACTION_NUDGE });
          continue;
        }
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
          const input = toolCall.input as Record<string, unknown>;
          const ok = !result.isError && structuredContent?.status !== "error";

          if (ok) succeeded.add(toolCall.name);
          if (ACTION_TOOLS.has(toolCall.name)) {
            if (ok) {
              done.push(describeAction(toolCall.name, input, structuredContent));
            } else {
              const reason = String(structuredContent?.["message"] ?? "failed");
              not_done.push(
                `${toolCall.name} (cg ${input["cg_id"] ?? "-"}): ${reason.slice(0, 120)}`,
              );
            }
          }

          if (
            WHATSAPP_SEND_TOOLS.has(toolCall.name) &&
            !result.isError &&
            structuredContent?.status === "ok"
          ) {
            const link = (chat_id: string) =>
              linkWhatsappRecipientToSlackThread({
                ...slack_thread,
                chat_id,
                phone: String(structuredContent.phone ?? input["phone"] ?? ""),
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

    logger.log("[slack agent] actions", { done, not_done });

    return (
      (answer || "Sorry, I couldn't complete that request.") +
      formatActionsFooter(done, not_done)
    );
  } finally {
    await mcpClient.close();
  }
}
