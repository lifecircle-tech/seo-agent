import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import { logger } from "../utils/logger";
import { getChatMessages } from "../services/timelines.service";
import {
  getCareGiverActiveBookingDetails,
  getCareGiverDetails,
  getCareGiverWithActiveBooking,
} from "../services/lc-caregivers.service";
import {
  getCMChatByChatId,
  getCMChatHistory,
  upsertCMChat,
} from "../services/lc-cm-conversation.service";
import { recordTenantAgentTokensUsage } from "../services/tenant-token-usage.service";
import {
  getMadhavisPrompt,
  getTenantsSpecificPrompt,
} from "../services/prompts.service";
import { getTenantsTools } from "../services/tenants-tools.service";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30 * 1000,
  maxRetries: 1,
});

const systemBlocks: Anthropic.TextBlockParam[] = [
  {
    type: "text",
    text: `You are Madhavi (Female), a Welfare Manager for LifeCircle. You communicate directly with 
  caregivers to check in on them, support their wellbeing, gather feedback, act on issues, 
  and handle their requests. You also communicate with human care manager to aware them of 
  caregivers condition.

  You are not a generic chatbot. You are their manager: warm, attentive, dependable, and 
  accountable for following through.

  Responsibilities
  - Initiate contact — Reach out proactively to start conversations rather than waiting passively.
  Open with a warm, brief, human greeting.
  - Check on wellbeing — Ask how the caregiver is doing, physically and mentally. Listen actively; 
  don't rush past the answer.
  - Collect feedback on living conditions — Ask about their own living situation (accommodation, 
  safety, comfort, any hardships) if relevant to their role.
  - Collect feedback on client/patient — Ask about the clients/patient they care for: how things are going, 
  any concerns, changes in condition, or friction.
  - Collect feedback on work — Ask if they are able to do their work, facing any challenges, made 
  any mistakes with patient while caretaking them.
  - Take action on conditions raised — When an issue is reported (about the caregiver, patient or client), 
  determine the right next step and act on it, or clearly state what action will be taken and by when.
  - Identify and escalate emergencies — Recognize signs of emergency, risk, abuse, self-harm, or 
  immediate threat (to the team member, patient or client) and escalate immediately to the appropriate human 
  contact, without waiting for confirmation.
  - Approve or reject requests — Evaluate requests (leave, resources, schedule changes, reimbursements, 
  etc.) against defined policy/criteria and give a clear decision.
  - Deliver final outcomes — For every request or issue raised, always circle back with a clear final 
  answer or resolution — never leave a thread open-ended without telling the caregiver what happens next.
  - Know your limits — When a query is outside what you can resolve, say so plainly and provide the 
  contact details of the appropriate human manager.

  CONVERSATION RULES:
  - Start the first conversation with a greeting. E.g. "Hi, my name is Madhvi."
  - Warm but professional tone — like a manager who genuinely cares, not a script-reader. Avoid 
  corporate stiffness and avoid being overly casual.
  - Always be respectful and kind, regardless of how the person communicates with you.
  - One question at a time — don't overwhelm the caregiver with a checklist of questions in one message.
  - Listen before advising — acknowledge what they've said before moving to the next topic or offering 
  a solution.
  - Be honest about limitations — never pretend to take an action you can't actually take.
  - No false reassurance — don't promise outcomes you can't guarantee (e.g., "your request will 
  definitely be approved").
  - Close the loop — every conversation should end with the person knowing what happens next, even if 
  the next step is "I'll follow up with you by [time/date]."
  - No need to reply if person is acknowledging your last message. (e.g., 'ok', 'thik hai')

  EMERGENCY CATEGORIZATION:
  After every message from the caregivers, classify the latest/most recent message into one of three tiers. 
  Re-evaluate the tier continuously as the conversation progresses — a conversation can move up a tier 
  at any point, even mid-conversation.
  - Tier 1 — All Clear
    Definition: Everything is fine on the caregivers's end. No action needed.
    Examples: Routine check-ins with a positive/neutral response, general updates, small talk, 
    confirmations, no complaints or concerns raised.
  - Tier 2 — Minor Inconvenience or Request
    Definition: A non-urgent issue, complaint, inconvenience, or request that doesn't require 
    immediate human intervention but a care manager should be made aware of.
    Examples: Minor scheduling conflicts, small complaints about patient, client or living condition, routine 
    requests (leave, resources), minor emergencies, recurring but non-critical friction.
  - Tier 3 — Critical or Uncertain
    Definition: A critical condition, emergency, safety threat, or a situation that is ambiguous/uncertain 
    enough that it cannot be confidently resolved or ruled out as safe.
    Examples: Signs of harm, abuse, neglect, self-harm, medical emergency, serious client/patient incident, 
    safety threats, distress signals, or any message where intent/severity is unclear and risk cannot be ruled out.

  EMERGENCY & RISK PROTOCOL:
  Treat the following as immediate priority, overriding all other tasks in the conversation:
  - Signs of physical harm, injury, or medical emergency
  - Signs of abuse, neglect, or exploitation (of the caregiver, patient or client)
  - Expressions of self-harm, suicidal ideation, or crisis
  - Safety threats from a client, employer, or third party
  - Any situation involving immediate danger

  LANGUAGE RULES:
  - Start with language person knows other than English, else default to English, but if person responds in 
  another language, respond in that language.
  - Use language script same as what person knows. E.g. if person knows Hindi, use Hindi script from first message itself.
  - Use transliteration, if first conversation started in english, if person responds in transliteration.
  E.g. if person responds in Hindi transliteration, respond in Hindi transliteration.
  - If person responds in different language script, continue responding in that language script. 
  E.g. if person responds in Hindi script, respond in Hindi script.

  When You Can't Help
  If a query falls outside your scope (policy exceptions, legal/HR matters, anything requiring human judgment or authority you don't have):
  - Be upfront that this is beyond what you can resolve.
  - Don't guess or provide made-up answers.
  - Provide the contact details of the appropriate human manager and encourage the person to reach out.
    
  TIER ACTION:
  - Tier 1 — No action need, continue the conversation.
  - Tier 2 — Raise support ticket, send awareness message to care manager, acknowledge and continue conversation. Do not ask for approval from care manager, just share information.
  - Tier 3 — Instant message to care manager, take any immediate supportive action available, assure them care manager will contact them soon.

  NOTES:
  - patient — person whom caregiver is taking care
  - client — person who is relative to patient

  TOOL AND ACTION NOTES:
  - while sending message, ensure country code in phone number
  - all caregives and caremanager are location in india, use '+91' for country code
  - in case of emergency or critical situation, prefer messaging to care manager first, then acknowledge caregiver
  - do not message to care manager with incomplete information, first gather necessary details first then share with care manager
  - for tier 2 emergency, send soft message on slack
  - for tier 3 emergency, send high alert message on both slack
  `,
    cache_control: { type: "ephemeral" },
  },
  {
    type: "text",
    text: `
    TOOL USES:
    - Don't call all tools on every run
    - Call tools only when needed.

    "send message tools":
    - call whatsapp message tool to send message to caregivers
    - for emergency, call only slack message tool to send message to care manager
    `,
    cache_control: { type: "ephemeral" },
  },
];

const mcp_url = process.env.MCP_TOOL_URL || "http://localhost:3002/mcp"

async function connectMcp() {
  const serverUrl = new URL(mcp_url);
  const transport = new StreamableHTTPClientTransport(serverUrl);

  const mcpClient = new Client(
    { name: "mcp-server-template", version: "0.1.0" },
    { capabilities: {} },
  );

  logger.log(`🔌 Connecting to running MCP server at: ${serverUrl.href}`);
  await mcpClient.connect(transport);

  logger.log("📋 Fetching registered tools...");
  const { tools: registeredTools } = await mcpClient.listTools();
  const tools = registeredTools.filter((tool) => tool.name);
  logger.log(
    `Found ${tools.length} tool(s):`,
    tools.map((t) => t.name),
  );

  const anthropicTools: Anthropic.Tool[] = tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    // Add the cache target to the very last tool in the array.
    // This caches the entire tools context block up to this point.
    ...(index === tools.length - 1
      ? { cache_control: { type: "ephemeral" as const } }
      : {}),
  }));

  return { mcpClient, anthropicTools };
}

async function runLoop({
  mcpClient,
  anthropicTools,
  chat_messages = [],
  caregiver = null,
  booking_detail = null,
}: {
  mcpClient: Client;
  anthropicTools: Anthropic.Tool[];
  chat_messages: any[];
  caregiver: { caregiver: Record<string, string | number> } | null;
  booking_detail?: Record<string, string | number> | null;
}) {
  const local_chat_messages = [...chat_messages];
  const system_prompt = await getMadhavisPrompt();

  let tenant_prompt = await getTenantsSpecificPrompt(1);
  let mcp_tools = await getTenantsTools(1);

  const anthropic_tools = anthropicTools.filter((tool) =>
    mcp_tools.includes(tool.name),
  );
  console.log("system prompt ", system_prompt);

  const system_blocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text:  `You work for LifeCircle.\n` + system_prompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  tenant_prompt &&
    system_blocks.push({
      type: "text",
      text: system_prompt,
      cache_control: { type: "ephemeral" },
    });

  system_blocks.push({
    type: "text",
    text: `
    TOOL USES:
    - Don't call all tools on every run
    - Call tools only when needed.

    "send message tools":
    - call whatsapp message tool to send message to caregivers
    - for emergency, call only slack message tool to send message to care manager
    `,
    cache_control: { type: "ephemeral" },
  });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `CAREGIVER INFO:
  ${JSON.stringify(caregiver)}

  ${
    booking_detail
      ? `ACTIVE BOOKING DETAILS:
    ${booking_detail}
    `
      : ""
  }

  CONVERSATION HISTORY:
  ${JSON.stringify(local_chat_messages)}

  Using above conversation history, write message what to reply.
  Communicate with person and send message using 'send_whatsapp_message' tool.

  Stop this prompt once message is sent.
      `,
    },
  ];

  logger.log("Starting agent loop...");
  const request_started_at = new Date().toISOString();
  let input_tokens = 0;
  let output_tokens = 0;
  let request_completed_at = request_started_at;
  let finalResponseText = "";

  while (true) {
    logger.log("Inside loop...");
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 5000,
      tools: anthropic_tools,
      system: system_blocks,
      messages,
    });
    request_completed_at = new Date().toISOString();

    messages.push({ role: "assistant", content: response.content });
    const toolCalls = response.content.filter(
      (block) => block.type === "tool_use",
    );

    logger.log("Stop Reason ", response.stop_reason);
    logger.log("USAGE ", response.usage);

    input_tokens += response.usage.input_tokens;
    output_tokens += response.usage.output_tokens;

    if (toolCalls.length === 0) {
      const finalResponse = response.content.find(
        (block) => block.type === "text",
      );
      finalResponseText = finalResponse?.text ?? "";
      break;
      // return finalResponseText;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolCall of toolCalls) {
      logger.log(`🤖 Claude requested tool [${toolCall.name}]`);

      const result = await mcpClient.callTool({
        name: toolCall.name,
        arguments: toolCall.input as Record<string, unknown>,
      });

      // The SDK's inferred content type is a deeply nested union that TS
      // collapses to `unknown` at this depth; narrow to what we use here.
      const content = result.content as Array<{
        type: string;
        text?: string;
      }>;
      const toolOutputText = content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");

      if (toolCall.name == "send_whatsapp_message" && !result.isError) {
        const structuredContent = result.structuredContent as
          | Record<string, unknown>
          | undefined;
        const chat_id = structuredContent?.["chat_id"] as string | undefined;
        logger.log("chat ID ", chat_id);

        if (structuredContent?.status == "ok" && chat_id) {
          upsertCMChat({
            cg_id: caregiver?.caregiver["cg_id"] as number,
            chat_id,
          });
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: toolOutputText,
      });
    }

    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  await recordTenantAgentTokensUsage({
    tenant_id: String(1),
    agent_id: "1",
    input_tokens,
    output_tokens,
    request_started_at,
    request_completed_at,
  });

  return finalResponseText;
}

// Connects to the MCP server and runs a single agent turn, closing the
// connection when done. Intended to be triggered per webhook call.
export async function startAgentConversation() {
  const { mcpClient, anthropicTools } = await connectMcp();

  try {
    const caregivers = await getCareGiverWithActiveBooking({});

    return await Promise.all(
      (caregivers ?? []).map(async (cg) => {
        const caregiver = await getCareGiverDetails(cg.cg_id);
        const booking_detail = await getCareGiverActiveBookingDetails(cg.cg_id);
        const chat_history = await getCMChatHistory(cg.cg_id);

        // return await runLoop({
        //   mcpClient,
        //   anthropicTools,
        //   chat_messages: chat_history,
        //   caregiver,
        //   booking_detail,
        // });
      }),
    );
  } finally {
    await mcpClient.close();
  }
}

export async function startAgent(chat_id: string) {
  const { mcpClient, anthropicTools } = await connectMcp();

  try {
    const chat_history = await getChatMessages(chat_id);

    const cm_chat_record = await getCMChatByChatId(chat_id);
    const caregiver = await getCareGiverDetails(
      cm_chat_record?.hp_unique_id as number,
    );
    const booking_detail = await getCareGiverActiveBookingDetails(
      caregiver?.caregiver.cg_id as number,
    );

    console.log("Caregiver", caregiver);
    console.log("booking", booking_detail);

    return await runLoop({
      mcpClient,
      anthropicTools,
      chat_messages: chat_history,
      caregiver,
      booking_detail,
    });
  } finally {
    await mcpClient.close();
  }
}
