import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import { logger } from "../utils/logger";
import { App, LogLevel, type webApi, SocketModeReceiver } from "@slack/bolt";
import { getAgentsPrompt } from "../services/prompts.service";

type WebClient = webApi.WebClient;

// Minimal shape shared by conversations.replies / conversations.history messages
interface SlackMessage {
  user?: string;
  text?: string;
  ts?: string;
}

interface HistoryEntry {
  role: "assistant" | "user";
  author: string;
  text: string;
  ts?: string;
}

interface AgentInput {
  prompt: string;
  history: HistoryEntry[];
  channel: string;
  threadTs: string;
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30 * 1000,
  maxRetries: 1,
});

// >>> replace with YOUR agent <
async function runAgent(input: AgentInput): Promise<string> {
  //   console.log("input", input);
  const messages: Anthropic.MessageParam[] = input.history.map((m) => ({
    role: m.role,
    content: m.text,
  }));
  const { agent_id, prompt: system_prompt } = await getAgentsPrompt({
    key: "Search_placement_manager",
  });

  const system_blocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: `You work for LifeCircle.\n` + system_prompt + "\n ",
      cache_control: { type: "ephemeral" },
    },
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 5000,
    // tools: anthropic_tools,
    system: system_blocks,
    messages,
  });
  //   request_completed_at = new Date().toISOString();

  messages.push({ role: "assistant", content: response.content });
  const toolCalls = response.content.filter(
    (block) => block.type === "tool_use",
  );

  logger.log("Stop Reason ", response.stop_reason);
  logger.log("USAGE ", response.usage);
  return "Message from agent";
  //   throw new Error(`runAgent not implemented (prompt: ${input.prompt})`);
}

const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN } = process.env;
if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  throw new Error(
    "SLACK_BOT_TOKEN (xoxb-...) and SLACK_APP_TOKEN (xapp-...) must be set in .env",
  );
}

const receiver = new SocketModeReceiver({
  appToken: SLACK_APP_TOKEN,
  //   logLevel: LogLevel.DEBUG,
});

const app = new App({
  token: SLACK_BOT_TOKEN,
  receiver,
  //   logLevel: LogLevel.DEBUG,
});

// Cache user names so we don't hit users.info repeatedly
const userCache = new Map<string, string>();

// Slack may redeliver the same event (retries / reconnects) — handle each event_id once
const seenEvents = new Set<string>();
async function getUserName(
  client: WebClient,
  userId?: string,
): Promise<string> {
  if (!userId) return "unknown";
  const cached = userCache.get(userId);
  if (cached) return cached;
  const { user } = await client.users.info({ user: userId });
  const name = user?.profile?.display_name || user?.real_name || userId;
  userCache.set(userId, name);
  return name;
}

// Read a full thread (handles pagination)
async function fetchThread(
  client: WebClient,
  channel: string,
  threadTs: string,
): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 200,
      cursor,
    });
    messages.push(...(res.messages ?? []));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return messages;
}

// Read recent channel messages (top-level only)
async function fetchChannelHistory(
  client: WebClient,
  channel: string,
  limit = 30,
): Promise<SlackMessage[]> {
  const res = await client.conversations.history({ channel, limit });
  return (res.messages ?? []).reverse(); // oldest → newest
}

// Convert Slack messages into LLM-friendly context
async function formatMessages(
  client: WebClient,
  messages: SlackMessage[],
  botUserId?: string,
): Promise<HistoryEntry[]> {
  return Promise.all(
    messages.map(
      async (m): Promise<HistoryEntry> => ({
        role: m.user === botUserId ? "assistant" : "user",
        author:
          m.user === botUserId ? "agent" : await getUserName(client, m.user),
        text: (m.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim(), // strip mention tokens
        ts: m.ts,
      }),
    ),
  );
}

app.event("app_mention", async ({ event, body, client, context }) => {
  // Bolt acks Events API requests before this runs, so there's no ack() here — just dedupe
  if (context.retryNum) {
    console.warn(
      `skip retry #${context.retryNum} (${context.retryReason}) for ${body.event_id}`,
    );
    return;
  }
  if (seenEvents.has(body.event_id)) return;
  seenEvents.add(body.event_id);
  if (seenEvents.size > 10000)
    seenEvents.delete(seenEvents.values().next().value!);

  const { channel, ts, thread_ts, text } = event;
  const replyTs = thread_ts ?? ts; // reply in the thread (creates one if needed)
  //   console.log("\ntext", channel, ts, thread_ts, '\n');

  try {
    // Context: thread if mention is inside one, otherwise recent channel history
    const raw = await fetchThread(client, channel, replyTs);

    const history = await formatMessages(client, raw, context.botUserId);
    const prompt = text.replace(/<@[A-Z0-9]+>/g, "").trim();

    console.log("\n history", history, "\n");

    // Optional: immediate feedback while the agent works
    // await client.reactions.add({ channel, timestamp: ts, name: "eyes" });

    // >>> call YOUR agent here <
    const answer = await runAgent({
      prompt,
      history,
      channel,
      threadTs: replyTs,
    });

    await client.chat.postMessage({
      channel,
      thread_ts: replyTs,
      text: answer,
    });
  } catch (err) {
    console.error(err);
    await client.chat.postMessage({
      channel,
      thread_ts: replyTs,
      text: "Sorry, something went wrong running that request.",
    });
  }
});

const auth = await app.client.auth.test({ token: SLACK_BOT_TOKEN });
console.log(
  "Bot:",
  auth.user,
  "| user_id:",
  auth.user_id,
  "| workspace:",
  auth.team,
);

await app.start().then(() => {
  console.log("Slack bridge running");
});
