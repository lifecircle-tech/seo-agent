import { App, SocketModeReceiver, type webApi } from "@slack/bolt";
import { logger } from "../utils/logger";
import {
  getSlackAgentChannel,
  getSlackChannel,
  type SlackAgentChannelConfig,
} from "../config/slack-channels";
import { runSlackChannelAgent } from "../orchestrators/lc-slack-agent";
import { getCMChatByHpUniqueId } from "../services/lc-cm-conversation.service";
import { saveSlackThreadReply } from "../services/lc-slack-conversation.service";

const DEFAULT_AGENT_KEY = "welfare_manager";

export type SlackReplyHandler = (args: {
  chat_id: string;
  agent_key: string;
}) => void;

// Cache user names so we don't hit users.info repeatedly
const userNameCache = new Map<string, string>();

// Slack may redeliver the same event (retries / reconnects) — handle each
// event_id once. The reply table's unique key is the durable guard.
const seenEvents = new Set<string>();

function isDuplicateEvent(event_id: string) {
  if (seenEvents.has(event_id)) return true;
  seenEvents.add(event_id);
  if (seenEvents.size > 10000)
    seenEvents.delete(seenEvents.values().next().value!);
  return false;
}

async function getUserName(client: webApi.WebClient, user_id?: string) {
  if (!user_id) return null;
  const cached = userNameCache.get(user_id);
  if (cached) return cached;

  try {
    const { user } = await client.users.info({ user: user_id });
    const name = user?.profile?.display_name || user?.real_name || user_id;
    userNameCache.set(user_id, name);
    return name;
  } catch (err) {
    logger.warn(`[slack-bridge] users.info failed for ${user_id}`, err);
    return null;
  }
}

// Read a full thread (handles pagination), oldest first
async function fetchThread(
  client: webApi.WebClient,
  channel: string,
  thread_ts: string,
) {
  const messages: {
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
  }[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversations.replies({
      channel,
      ts: thread_ts,
      limit: 200,
      cursor,
    });
    messages.push(...(res.messages ?? []));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return messages;
}

// Runs the channel's dedicated agent for a mention and answers in the
// thread. A placeholder is posted first and replaced with the answer.
async function handleAgentChannelMention(
  client: webApi.WebClient,
  agent_channel: SlackAgentChannelConfig,
  mention: {
    channel: string;
    ts: string;
    thread_ts?: string;
    user?: string;
    text: string;
    bot_user_id?: string;
  },
) {
  const { channel, ts } = mention;
  const reply_ts = mention.thread_ts ?? ts; // reply in the thread (creates one if needed)

  const placeholder = await client.chat.postMessage({
    channel,
    thread_ts: reply_ts,
    text: "_Working on it…_",
  });

  let answer: string;
  try {
    // Earlier messages of the thread, excluding the mention itself
    const thread = mention.thread_ts
      ? await Promise.all(
          (await fetchThread(client, channel, mention.thread_ts))
            .filter((m) => m.text && m.ts !== placeholder.ts)
            .map(async (m) => ({
              from:
                m.bot_id || m.user === mention.bot_user_id
                  ? "agent"
                  : ((await getUserName(client, m.user)) ?? "employee"),
              text: (m.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim(),
            })),
        )
      : [];

    logger.log(
      `[slack-bridge] ts ${ts}, ${agent_channel.key}: running ${agent_channel.agent_key}`,
    );

    answer = await runSlackChannelAgent({
      agent_key: agent_channel.agent_key,
      extra_tools: agent_channel.tools ?? [],
      exclude_tools: agent_channel.exclude_tools ?? [],
      thread,
      slack_thread: {
        channel_id: channel,
        thread_ts: reply_ts,
        purpose: agent_channel.key,
      },
    });
  } catch (err) {
    logger.error(`[slack-bridge] ${agent_channel.key} agent failed`, err);
    answer = "Sorry, something went wrong running that request.";
  }

  logger.debug("[slack-bridge] agent answer", answer);

  if (placeholder.ts) {
    await client.chat.update({ channel, ts: placeholder.ts, text: answer });
  } else {
    await client.chat.postMessage({
      channel,
      thread_ts: reply_ts,
      text: answer,
    });
  }
}

// Listens for employees @mentioning the bot inside a Slack thread the
// agent opened, stores the reply, and calls `onReply` for threads whose
// channel relays to the user. Mentions elsewhere are ignored.
export async function startSlackBridge(onReply: SlackReplyHandler) {
  const { SLACK_BOT_TOKEN_MADHAVI, SLACK_APP_TOKEN_MADHAVI, MADHAVI_WEBHOOK } = process.env;
  if (!SLACK_BOT_TOKEN_MADHAVI || !SLACK_APP_TOKEN_MADHAVI || !MADHAVI_WEBHOOK) {
    logger.warn(
      "[slack-bridge] SLACK_BOT_TOKEN_MADHAVI / SLACK_APP_TOKEN_MADHAVI not set, Slack replies will not be handled",
    );
    return null;
  }

  const receiver = new SocketModeReceiver({
    appToken: SLACK_APP_TOKEN_MADHAVI,
    //   logLevel: LogLevel.DEBUG,
  });

  const app = new App({
    token: SLACK_BOT_TOKEN_MADHAVI,
    receiver,
    //   logLevel: LogLevel.DEBUG,
  });
  
  app.event("app_mention", async ({ event, body, client, context }) => {
    // Bolt acks Socket Mode events before this runs — just dedupe
    if (context.retryNum || isDuplicateEvent(body.event_id)) return;

    const { channel, ts, thread_ts, user } = event;

    logger.log(
      `[slack-bridge] app_mention in channel ${channel} ts ${ts} thread_ts ${thread_ts} user ${user}`,
    );

    if (event.bot_id || user === context.botUserId) return;

    const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) return;

    // Agent channels: run the channel's agent directly, no record needed
    const agent_channel = getSlackAgentChannel(channel);
    if (agent_channel) {
      await handleAgentChannelMention(client, agent_channel, {
        channel,
        ts,
        thread_ts,
        user,
        text,
        bot_user_id: context.botUserId,
      });
      return;
    }

    // Only mentions inside a thread
    if (!thread_ts || thread_ts === ts) return;

    try {
      const saved = await saveSlackThreadReply({
        channel_id: channel,
        thread_ts,
        slack_user_id: user ?? null,
        slack_user_name: await getUserName(client, user),
        message: text,
        message_ts: ts,
      });

      // Not a thread the agent opened, or a redelivered event
      if (!saved || !saved.inserted) return;

      const { conversation } = saved;

      if (!saved.relay_to_user) {
        // await client.chat.postMessage({
        //   channel,
        //   thread_ts,
        //   text: "Noted, I'll use this as context for this conversation.",
        // });
        return;
      }

      const chat_id =
        conversation.chat_id ??
        (await getCMChatByHpUniqueId(conversation.hp_unique_id))?.chat_id;

      if (!chat_id) {
        logger.warn(
          `[slack-bridge] no chat for hp_unique_id ${conversation.hp_unique_id}, reply stored but not relayed`,
        );
        // await client.chat.postMessage({
        //   channel,
        //   thread_ts,
        //   text: "Saved, but I couldn't find this person's WhatsApp chat to pass it on.",
        // });
        return;
      }

      const agent_key =
        getSlackChannel(conversation.purpose)?.handler_agent_key ??
        conversation.agent_key ??
        DEFAULT_AGENT_KEY;

      logger.log(
        `[slack-bridge] reply on thread ${conversation.id}, running ${agent_key} for chat ${chat_id}`,
      );
      onReply({ chat_id, agent_key });

      // await client.chat.postMessage({
      //   channel,
      //   thread_ts,
      //   text: "Got it, I'll pass this on to them.",
      // });
    } catch (err) {
      logger.error("[slack-bridge] failed to handle thread reply", err);
    }
  });

  await app.start();
  logger.log("[slack-bridge] listening for app mentions in Slack threads");

  return app;
}
