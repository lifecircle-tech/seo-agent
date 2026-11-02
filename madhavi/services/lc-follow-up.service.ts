import { logger } from "../utils/logger";
import { getChatMessages } from "./timelines.service";
import { getDigitalCMChatsInactiveFor } from "../models/lc-cm-conversation.model";
import { getActiveEscalationChats } from "./lc-slack-conversation.service";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// A week without conversation, less 12 hours so the follow-up sent by last
// Monday's run is due again this Monday.
const WEEKLY_INACTIVE_HOURS = 7 * 24 - 12;
// Not followed up anymore once the caregiver has not replied for this long.
const UNRESPONSIVE_DAYS = 21;

export type FollowUpChat = {
  hp_unique_id: number;
  chat_id: string;
  agent_key: string;
};

// Timelines timestamps may be ISO strings or unix seconds / milliseconds.
function toTime(value: unknown) {
  if (value == null || value === "") return NaN;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  return new Date(String(value)).getTime();
}

// Caregivers whose last conversation was over a week ago and who replied in
// the last 3 weeks. Caregivers who never replied count from the first
// message sent to them. Those with an open escalation are left to the
// escalation follow-up.
async function getWeeklyFollowUpChats(): Promise<FollowUpChat[]> {
  const [chats, escalations] = await Promise.all([
    getDigitalCMChatsInactiveFor(WEEKLY_INACTIVE_HOURS),
    getActiveEscalationChats(),
  ]);
  const escalated = new Set(escalations.map((e) => e.hp_unique_id));

  const now = Date.now();
  const inactive_since = now - WEEKLY_INACTIVE_HOURS * HOUR_MS;
  const responsive_since = now - UNRESPONSIVE_DAYS * DAY_MS;
  const due: FollowUpChat[] = [];

  for (const chat of chats) {
    if (!chat.chat_id || escalated.has(chat.hp_unique_id)) continue;

    try {
      // Newest first
      const history = await getChatMessages(chat.chat_id);

      // A caregiver message the agent did not answer is not in the DB
      const last_message_at = toTime(history[0]?.timestamp);
      if (last_message_at >= inactive_since) continue;

      const last_reply = history.find((m: any) => m.sender === "caregiver");
      const reply_at = last_reply ? toTime(last_reply.timestamp) : NaN;
      const responded_at = Number.isFinite(reply_at)
        ? reply_at
        : new Date(chat.started_at_timestamp).getTime();
      if (responded_at < responsive_since) continue;

      due.push({
        hp_unique_id: chat.hp_unique_id,
        chat_id: chat.chat_id,
        agent_key: "welfare_manager",
      });
    } catch (err) {
      logger.error(
        `[getWeeklyFollowUpChats] chat ${chat.chat_id} could not be checked`,
        err,
      );
    }
  }

  return due;
}

export { getWeeklyFollowUpChats };
