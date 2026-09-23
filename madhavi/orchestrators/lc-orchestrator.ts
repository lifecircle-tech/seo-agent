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
  getAgentsPrompt,
  getTenantsSpecificPrompt,
} from "../services/prompts.service";
import { getTenantsTools } from "../services/tenants-tools.service";
import {
  getAgentTools,
  getTenantsAccessedAgent,
} from "../services/agent.service";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30 * 1000,
  maxRetries: 1,
});

const mcp_url = process.env.MCP_TOOL_URL || "http://localhost:3002/mcp";

const CREATE_SUPPORT_PROMPT = `
## Data for creating support ticket
Assign and pass the following properties before calling tools to create support
ticket based on different support type.
{
  cg_id,
  support_id,
  title: same as support type name,
  description: reason why person is requested to raise support (in first person)
}

### support_id = 7
{
  amount: advance amount needed by caregiver in INR
}

### support_id = 8
{
  from_date: date in dd-MM-YYYY
  to_date: date in dd-MM-YYYY
}

### support_id = 9
{
  from_date: date in dd-MM-YYYY
}

For rest of the support type, no extra information is required.
`;

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
  agentKey = "welfare_manager",
  chat_messages = [],
  caregiver = null,
  booking_detail = null,
}: {
  mcpClient: Client;
  anthropicTools: Anthropic.Tool[];
  agentKey: string;
  chat_messages: any[];
  caregiver: { caregiver: Record<string, string | number> } | null;
  booking_detail?: Record<string, string | number> | null;
}) {
  const local_chat_messages = [...chat_messages];
  const { agent_id, prompt: system_prompt } = await getAgentsPrompt({
    key: agentKey,
  });
  let tenant_prompt = await getTenantsSpecificPrompt(1, agent_id);
  let agent_tools = await getAgentTools({ agent_id });
  let tenant_tools = await getTenantsTools({ tenant_id: 1, agent_id });
  let mcp_tools = new Set([...agent_tools, ...tenant_tools]);

  if (mcp_tools.has("create_support_ticket")) {
    mcp_tools.add("get_support_types");
  }
  logger.log("tools ", agentKey, mcp_tools);

  const anthropic_tools = anthropicTools.filter((tool) =>
    Array.from(mcp_tools).includes(tool.name),
  );

  const system_blocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: `You work for LifeCircle.\n` + system_prompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  tenant_prompt &&
    system_blocks.push({
      type: "text",
      text: tenant_prompt,
      cache_control: { type: "ephemeral" },
    });

  mcp_tools.has("create_support_ticket") &&
    system_blocks.push({
      type: "text",
      text: CREATE_SUPPORT_PROMPT,
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
  });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `CAREGIVER INFO:\n${JSON.stringify(caregiver)}
  ${
    booking_detail
      ? `ACTIVE BOOKING DETAILS:\n${booking_detail}
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
      model: "claude-sonnet-5",
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

export async function startAgent(chat_id: string, agent_key: string) {
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
      agentKey: agent_key,
      caregiver,
      booking_detail,
    });
  } finally {
    await mcpClient.close();
  }
}

export async function multiAgentRouter(chat_id: string) {
  const agents = await getTenantsAccessedAgent({ tenant_id: 1 });

  const agent_tools = agents.map((a) => ({
    name: a.key,
    description: a.description,
    input_schema: { type: "object" } as Anthropic.Tool.InputSchema,
  }));

  const chat_history = await getChatMessages(chat_id);
  const messages = chat_history
    .slice(0, 6)
    .map((message: any) => {
      return message.sender === "madhavi"
        ? { role: "assistant", content: message.message }
        : { role: "user", content: message.message };
    })
    .reverse();
  // messages.push({ role: "user", content: message });

  const ROUTER_SYSTEM_PROMPT = `You are a routing orchestrator for a multi-agent system. Your only job is to
analyze the incoming input and dispatch it to the correct department agent(s).
You do not answer the user's input yourself, and you do not perform the
work — you only decide who should handle it.

## How to decide

1. Read the past conversation carefully. Identify the underlying intent of
   recent message, not just keywords — e.g. "why was I charged twice" is
   account, not operation, even though "why" sounds like a how-to question.
2. If the request clearly maps to exactly one agent, call that agent's tool.
3. If the request is ambiguous between two departments, pick the department
   that would need to act first in a real support workflow, not the one that
   merely mentions the topic.
4. If the request does not clearly match any department (e.g. small talk,
   out-of-scope topics, or missing information needed to route), call tool
   that handles general query.
5. If there is only one agent in tool list, default call to that agent

## Rules

- Never attempt to resolve the user's issue yourself.
- Never guess at facts (account details, prices, booking status) — that
  belongs to the department agent, not you.
- If unsure between two plausible departments, prefer most relevant tool as the
  default only when the ambiguity is about "something isn't working"`;

  logger.log("Running agent router orchestrator...");
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 300,
    system: [
      {
        type: "text",
        text: ROUTER_SYSTEM_PROMPT, // the prompt above
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: agent_tools,
    tool_choice: { type: "any" },
    messages: messages,
  });

  logger.debug("Stop Reason", response.stop_reason);
  logger.debug("USAGE", response.usage);

  const toolCalls = response.content.filter(
    (block) => block.type === "tool_use",
  );

  if (toolCalls.length === 0) {
    // call welfare manager
    startAgent(chat_id, "welfare_manager");
  }

  let toolCall = toolCalls[0];
  logger.log(`🤖 Claude requested tool [${toolCall.name}]`);

  startAgent(chat_id, toolCall.name);
}
