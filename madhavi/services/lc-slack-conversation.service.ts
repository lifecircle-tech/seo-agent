import { logger } from "../utils/logger";
import { getSlackChannel } from "../config/slack-channels";
import {
  getCMChatByChatId,
  getCMChatByHpUniqueId,
  upsertCMChat,
} from "./lc-cm-conversation.service";
import { getCaregiverHpUniqueIdByPhone } from "../models/lc-caregivers.model";
import {
  getSlackConversationByThread,
  getSlackConversationsByHpUniqueId,
  getSlackRepliesByConversationIds,
  insertSlackConversation,
  insertSlackReply,
  updateSlackRepliesRelayed,
  type SlackConversation,
} from "../models/lc-slack-conversation.model";

// How many recent threads per user are loaded into the agent's context.
const CONTEXT_THREAD_LIMIT = 5;
// Pending replies older than this are no longer pushed to the user.
const PENDING_REPLY_MAX_AGE_DAYS = 7;

export type SlackThreadContext = {
  thread_id: number;
  purpose: string;
  reported_at: string;
  report: string;
  status: string;
  replies: {
    reply_id: number;
    from: string;
    message: string;
    at: string;
    relay_status: string;
  }[];
};

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

async function getSlackThreadsContext(
  hp_unique_id: number,
  limit = CONTEXT_THREAD_LIMIT,
): Promise<SlackThreadContext[]> {
  const conversations = await getSlackConversationsByHpUniqueId(
    hp_unique_id,
    limit,
  );
  const replies = await getSlackRepliesByConversationIds(
    conversations.map((c) => c.id),
  );

  return conversations.map((c) => ({
    thread_id: c.id,
    purpose: c.purpose,
    reported_at: new Date(c.created_at).toISOString(),
    report: c.message,
    status: c.status,
    replies: replies
      .filter((r) => r.slack_conversation_id === c.id)
      .map((r) => ({
        reply_id: r.id,
        from: r.slack_user_name ?? "care team",
        message: r.message,
        at: new Date(r.created_at).toISOString(),
        relay_status: r.relay_status,
      })),
  }));
}

// Builds the Slack section of the agent's prompt. `pending_reply_ids` are
// the replies the agent is asked to pass on to the user in this run.
async function getSlackPromptContext(hp_unique_id: number) {
  try {
    const threads = await getSlackThreadsContext(hp_unique_id);
    if (threads.length === 0) return { prompt: "", pending_reply_ids: [] };

    const cutoff = Date.now() - PENDING_REPLY_MAX_AGE_DAYS * 86400 * 1000;
    const pending = threads.flatMap((t) =>
      t.replies
        .filter(
          (r) =>
            r.relay_status === "pending" && new Date(r.at).getTime() >= cutoff,
        )
        .map((r) => ({ ...r, in_reply_to: t.report })),
    );

    let prompt = `SLACK THREADS ABOUT THIS PERSON (care team requests and your reports, with the care team's replies; "report" is what you sent):
${JSON.stringify(threads)}

If the person's latest message responds to one of these threads (for example a care team request you messaged them about), after replying on WhatsApp also post a short update to that thread with 'reply_in_slack_thread' (its thread_id): what the person said and what you replied.
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

export {
  recordSlackThread,
  linkWhatsappRecipientToSlackThread,
  saveSlackThreadReply,
  getSlackThreadsContext,
  getSlackPromptContext,
  markSlackRepliesRelayed,
};
