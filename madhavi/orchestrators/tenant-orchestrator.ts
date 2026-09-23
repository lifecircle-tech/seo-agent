import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import { logger } from "../utils/logger";
import { getChatMessages } from "../services/timelines.service";
import { recordTenantAgentTokensUsage } from "../services/tenant-token-usage.service";
import { getAllTenants } from "../services/tenant.service";
import {
  getTenantDetailsOfCaregiver,
  getTenantsCareGiverDetails,
  getTenantsCaregivers,
} from "../services/tenants-caregiver.service";
import {
  getAgentsPrompt,
  getTenantsSpecificPrompt,
} from "../services/prompts.service";
import { getTenantsTools } from "../services/tenants-tools.service";
import {
  getTenantsCMChatByChatId,
  getTenantsCMChatHistory,
  upsertTenantsCMChat,
} from "../services/tenants-cm-conversation.service";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30 * 1000,
  maxRetries: 1,
});

const mcp_url = process.env.MCP_TOOL_URL || "http://localhost:3002/mcp";

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
  tenant,
}: {
  mcpClient: Client;
  anthropicTools: Anthropic.Tool[];
  chat_messages: any[];
  caregiver: { caregiver: Record<string, string | number> } | null;
  tenant?: { id: number; name: string };
}) {
  const local_chat_messages = [...chat_messages];
  const { prompt: system_prompt } = await getAgentsPrompt({
    key: "welfare_manager",
  });

  let tenant_prompt = "";
  let mcp_tools = [];

  if (tenant) {
    mcp_tools = await getTenantsTools({ tenant_id: tenant.id, agent_id: 1 });
    tenant_prompt = await getTenantsSpecificPrompt(tenant.id, 1);
  }

  const anthropic_tools = anthropicTools.filter((tool) =>
    mcp_tools.includes(tool.name),
  );

  const system_blocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: `You work for ${tenant?.name}.\n` + system_prompt,
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

  // TODO: uncomment while loop when message to supervisor feature is implemented
  // while (true) {
  //   logger.log("Inside loop...");
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
    // break;
    return finalResponseText;
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
        upsertTenantsCMChat({
          caregiver_id: caregiver?.caregiver["cg_id"] as number,
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

  //   messages.push({
  //     role: "user",
  //     content: toolResults,
  //   });
  // }

  await recordTenantAgentTokensUsage({
    tenant_id: String(tenant?.id),
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
    const tenants = await getAllTenants();

    for (let tenant of tenants.filter((t) => t.id != 1)) {
      const caregivers = await getTenantsCaregivers(tenant?.id);
      await Promise.all(
        (caregivers ?? []).map(async (cg) => {
          const caregiver = { caregiver: cg };
          const chat_history = await getTenantsCMChatHistory(cg.cg_id);

          return await runLoop({
            mcpClient,
            anthropicTools,
            chat_messages: chat_history,
            caregiver,
            tenant: tenant,
          });
        }),
      );
    }
  } finally {
    await mcpClient.close();
  }
}

export async function startAgent(chat_id: string) {
  const { mcpClient, anthropicTools } = await connectMcp();

  try {
    const chat_history = await getChatMessages(chat_id);

    const cm_chat_record = await getTenantsCMChatByChatId(chat_id);
    const caregiver = await getTenantsCareGiverDetails(
      cm_chat_record?.caregiver_id as number,
    );

    const tenant = await getTenantDetailsOfCaregiver(caregiver.caregiver.cg_id);

    return await runLoop({
      mcpClient,
      anthropicTools,
      chat_messages: chat_history,
      caregiver,
      tenant,
    });
  } finally {
    await mcpClient.close();
  }
}
