import { logger } from "../utils/logger";
import { getSlackChannel } from "../config/slack-channels";
import {
  getCMChatByChatId,
  getCMChatByHpUniqueId,
  upsertCMChat,
} from "./lc-cm-conversation.service";
import { getCaregiverHpUniqueIdByPhone } from "../models/lc-caregivers.model";
import {
  getActiveEscalations,
  getSlackConversationByThread,
  getSlackConversationsByHpUniqueId,
  getSlackRepliesByConversationIds,
  insertSlackConversation,
  insertSlackReply,
  updateSlackConversationStatus,
  updateSlackRepliesRelayed,
  type SlackConversation,
  type SlackConversationStatus,
  type SlackReply,
} from "../models/lc-slack-conversation.model";
import { readSlackThread } from "../../MCPs/services/slack.service";

// How many recent threads per user are loaded into the agent's context.
const CONTEXT_THREAD_LIMIT = 5;
// Pending replies older than this are no longer pushed to the user.
const PENDING_REPLY_MAX_AGE_DAYS = 7;
// Escalations older than this are not followed up, even if never closed.
const ESCALATION_FOLLOW_UP_MAX_AGE_DAYS = 30;

const DEFAULT_AGENT_KEY = "welfare_manager";

export type SlackThreadContext = {
  thread_id: number;
  purpose: string;
  reported_at: string;
  report: string;
  status: string;
  // Every message after the report, read live from Slack (only the stored
  // @mention replies when Slack cannot be read)
  messages: {
    from: string;
    message: string;
    at: string;
  }[];
};

// Agent that handles a thread: the channel's handler, else the agent that
// opened it.
function getThreadAgentKey(conversation: {
  purpose: string;
  agent_key: string | null;
}) {
  return (
    getSlackChannel(conversation.purpose)?.handler_agent_key ??
    conversation.agent_key ??
    DEFAULT_AGENT_KEY
  );
}

// Links a Slack thread the agent just opened to the user it is about.
async function recordSlackThread(args: {
  hp_unique_id: number;
  chat_id?: string | null;
  agent_key: string | null;
  purpose: string;
  channel_id: string;
  thread_ts: string;
  message: string;
}) {
  try {
    const chat_id =
      args.chat_id ??
      (await getCMChatByHpUniqueId(args.hp_unique_id))?.chat_id ??
      null;

    return await insertSlackConversation({ ...args, chat_id });
  } catch (err) {
    logger.error("[recordSlackThread]", err);
    return null;
  }
}

// Links a caregiver the agent just messaged on WhatsApp to the Slack thread
// the request came from, so their reply can be reported back to it. The
// caregiver is resolved from the chat record, else from their phone.
async function linkWhatsappRecipientToSlackThread(args: {
  chat_id: string;
  phone: string;
  agent_key: string;
  purpose: string;
  channel_id: string;
  thread_ts: string;
  message: string;
}) {
  try {
    const cm_chat = await getCMChatByChatId(args.chat_id);
    const hp_unique_id =
      cm_chat?.hp_unique_id ??
      (await getCaregiverHpUniqueIdByPhone(args.phone));

    if (!hp_unique_id) {
      logger.warn(
        `[linkWhatsappRecipientToSlackThread] no caregiver for ${args.phone}, thread not linked`,
      );
      return null;
    }

    // The WhatsApp webhook only handles chats it has a record for
    if (!cm_chat) {
      await upsertCMChat({ cg_id: hp_unique_id, chat_id: args.chat_id });
    }

    return await recordSlackThread({ ...args, hp_unique_id });
  } catch (err) {
    logger.error("[linkWhatsappRecipientToSlackThread]", err);
    return null;
  }
}

// Stores an employee's reply to a tracked thread. Returns null when the
// thread is not one the agent opened.
async function saveSlackThreadReply(args: {
  channel_id: string;
  thread_ts: string;
  slack_user_id: string | null;
  slack_user_name: string | null;
  message: string;
  message_ts: string;
}): Promise<{
  conversation: SlackConversation;
  inserted: boolean;
  relay_to_user: boolean;
} | null> {
  const conversation = await getSlackConversationByThread(
    args.channel_id,
    args.thread_ts,
  );
  if (!conversation) return null;

  const relay_to_user =
    getSlackChannel(conversation.purpose)?.relay_to_user ?? false;

  const inserted = await insertSlackReply({
    slack_conversation_id: conversation.id,
    slack_user_id: args.slack_user_id,
    slack_user_name: args.slack_user_name,
    message: args.message,
    message_ts: args.message_ts,
    relay_status: relay_to_user ? "pending" : "internal",
  });

  return { conversation, inserted, relay_to_user };
}

function storedReplyMessage(reply: SlackReply) {
  return {
    from: reply.slack_user_name ?? "care team",
    message: reply.message,
    at: new Date(reply.created_at).toISOString(),
  };
}

// The thread's messages after the report, read from Slack. Falls back to
// the stored replies so the agent keeps some context when Slack is down.
async function getThreadMessages(
  conversation: SlackConversation,
  stored_replies: SlackReply[],
): Promise<SlackThreadContext["messages"]> {
  try {
    const messages = await readSlackThread(
      conversation.channel_id,
      conversation.thread_ts,
    );

    return messages
      .filter((m) => m.ts !== conversation.thread_ts && m.text.trim())
      .map((m) => ({
        from: m.from === "agent" ? "agent" : (m.user_name ?? "care team"),
        message: m.text,
        at: new Date(Number(m.ts) * 1000).toISOString(),
      }));
  } catch (err) {
    logger.warn(
      `[getThreadMessages] Slack thread ${conversation.id} could not be read, using stored replies`,
      err,
    );
    return stored_replies.map(storedReplyMessage);
  }
}

async function loadSlackThreads(hp_unique_id: number, limit: number) {
  const conversations = await getSlackConversationsByHpUniqueId(
    hp_unique_id,
    limit,
  );
  const replies = await getSlackRepliesByConversationIds(
    conversations.map((c) => c.id),
  );

  const threads: SlackThreadContext[] = await Promise.all(
    conversations.map(async (c) => ({
      thread_id: c.id,
      purpose: c.purpose,
      reported_at: new Date(c.created_at).toISOString(),
      report: c.message,
      status: c.status,
      messages: await getThreadMessages(
        c,
        replies.filter((r) => r.slack_conversation_id === c.id),
      ),
    })),
  );

  return { conversations, replies, threads };
}

async function getSlackThreadsContext(
  hp_unique_id: number,
  limit = CONTEXT_THREAD_LIMIT,
): Promise<SlackThreadContext[]> {
  return (await loadSlackThreads(hp_unique_id, limit)).threads;
}

// Builds the Slack section of the agent's prompt. `pending_reply_ids` are
// the replies the agent is asked to pass on to the user in this run.
async function getSlackPromptContext(hp_unique_id: number) {
  try {
    const { conversations, replies, threads } = await loadSlackThreads(
      hp_unique_id,
      CONTEXT_THREAD_LIMIT,
    );
    if (threads.length === 0) return { prompt: "", pending_reply_ids: [] };

    // Replies to relay are still tracked in the DB
    const cutoff = Date.now() - PENDING_REPLY_MAX_AGE_DAYS * 86400 * 1000;
    const pending = replies
      .filter(
        (r) =>
          r.relay_status === "pending" &&
          new Date(r.created_at).getTime() >= cutoff,
      )
      .map((r) => ({
        reply_id: r.id,
        ...storedReplyMessage(r),
        in_reply_to: conversations.find((c) => c.id === r.slack_conversation_id)
          ?.message,
      }));

    let prompt = `SLACK THREADS ABOUT THIS PERSON (care team requests and your reports, with every message posted in the thread since; "report" is what you sent, messages "from": "agent" are your own posts):
${JSON.stringify(threads)}

If the person's latest message responds to one of these threads (for example a care team request you messaged them about), after replying on WhatsApp also post a short update to that thread with 'reply_in_slack_thread' (its thread_id): what the person said and what you replied.
When your post marks the case RESOLVED, CLOSED or REOPENED, also pass that as 'case_status'.
Do not post to Slack when the message is unrelated to these threads.
`;

    if (pending.length > 0) {
      prompt += `
PENDING CARE TEAM REPLIES (not yet shared with this person):
${JSON.stringify(pending)}

Share these replies with the person in your WhatsApp message, in your own words and in the language of the conversation.
Do not mention Slack or internal processes.
`;
    }

    return { prompt, pending_reply_ids: pending.map((r) => r.reply_id) };
  } catch (err) {
    logger.error("[getSlackPromptContext]", err);
    return { prompt: "", pending_reply_ids: [] };
  }
}

async function markSlackRepliesRelayed(ids: number[]) {
  try {
    await updateSlackRepliesRelayed(ids);
  } catch (err) {
    logger.error("[markSlackRepliesRelayed]", err);
  }
}

// RESOLVED / CLOSED / REOPENED posted by the agent in a thread. A reopened
// case is open again.
async function setSlackThreadCaseStatus(
  thread_id: number,
  case_status: "resolved" | "closed" | "reopened",
) {
  const status: SlackConversationStatus =
    case_status === "reopened" ? "open" : case_status;

  try {
    await updateSlackConversationStatus(thread_id, status);
  } catch (err) {
    logger.error("[setSlackThreadCaseStatus]", err);
  }
}

// One entry per user with an escalation that is not closed: their chat, and
// the agent handling their latest such thread.
async function getActiveEscalationChats() {
  const escalations = await getActiveEscalations(
    ESCALATION_FOLLOW_UP_MAX_AGE_DAYS,
  );

  const by_user = new Map<
    number,
    { hp_unique_id: number; chat_id: string; agent_key: string }
  >();
  for (const e of escalations) {
    if (by_user.has(e.hp_unique_id)) continue;
    by_user.set(e.hp_unique_id, {
      hp_unique_id: e.hp_unique_id,
      chat_id: e.chat_id,
      agent_key: getThreadAgentKey(e),
    });
  }

  return [...by_user.values()];
}

export {
  getThreadAgentKey,
  recordSlackThread,
  linkWhatsappRecipientToSlackThread,
  saveSlackThreadReply,
  getSlackThreadsContext,
  getSlackPromptContext,
  markSlackRepliesRelayed,
  setSlackThreadCaseStatus,
  getActiveEscalationChats,
};
