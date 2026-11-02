import type { Express } from "express";
import { isCaregiverPhoneNumber } from "./services/lc-caregivers.service";
import { isLCMemberPhoneNumber } from "./services/lc-caremanager.service";
import {
  startAgent as tenantAgent,
  startAgentConversation as tenantAgentConversation,
} from "./orchestrators/tenant-orchestrator";
import {
  startAgent as lcAgent,
  startAgentConversation as lcAgentConversation,
  multiAgentRouter,
  runRegistrationFollowups,
} from "./orchestrators/lc-orchestrator";

import cron from "node-cron";
import { logger } from "./utils/logger.js";
import { getDigitalCMChatByChatId } from "./models/lc-cm-conversation.model";
import { startSlackBridge } from "./slack/slack-bridge";
import {
  generateDailyReport,
  todayReportDate,
} from "./services/lc-daily-report.service";
import { handleInboundOptOut } from "./services/lc-opt-out.service";
import {
  markOverdueNoResponse,
  recordCaregiverReply,
} from "./services/lc-recruitment.service";
import {
  getWeeklyFollowUpChats,
  type FollowUpChat,
} from "./services/lc-follow-up.service";
import { getActiveEscalationChats } from "./services/lc-slack-conversation.service";
import type { AgentRunTrigger } from "./models/lc-agent-audit.model";

// Debounce window: if more messages arrive for the same chat within this
// window, they collapse into a single agent run after the last one.
const AGENT_RUN_DEBOUNCE_MS = 4000;

type AgentRunner = (chat_id: string) => Promise<any>;

type ChatRunState = {
  timer?: NodeJS.Timeout;
  running: boolean;
  // Latest run requested while one was in flight, run after it
  pendingAgent?: AgentRunner;
};

const chatRunStates = new Map<string, ChatRunState>();

function getChatRunState(chat_id: string): ChatRunState {
  let state = chatRunStates.get(chat_id);
  if (!state) {
    state = { running: false };
    chatRunStates.set(chat_id, state);
  }
  return state;
}

function finishAgentRun(chat_id: string, state: ChatRunState) {
  state.running = false;
  const next = state.pendingAgent;
  if (next) {
    state.pendingAgent = undefined;
    triggerAgentRun(chat_id, state, next);
  }
}

// Runs the agent for a chat, ensuring only one run is ever in flight per
// chat_id. If a message arrives while a run is already in progress, it
// queues a rerun instead of starting a second concurrent run.
function triggerAgentRun(
  chat_id: string,
  state: ChatRunState,
  agent: AgentRunner,
) {
  if (state.running) {
    state.pendingAgent = agent;
    return;
  }

  state.running = true;
  agent(chat_id)
    .catch((err) => {
      logger.error(`Agent run failed for chat ${chat_id}:`, err);
    })
    .finally(() => finishAgentRun(chat_id, state));
}

// Runs a scheduled agent run for a chat in the same per-chat queue, and
// resolves when it is done. Skipped when a run for the chat is already
// waiting or in flight, as that run sees the same conversation.
async function runScheduledAgent(chat_id: string, agent: AgentRunner) {
  const state = getChatRunState(chat_id);
  if (state.running || state.timer) return false;

  state.running = true;
  try {
    await agent(chat_id);
    return true;
  } catch (err) {
    logger.error(`Scheduled agent run failed for chat ${chat_id}:`, err);
    return false;
  } finally {
    finishAgentRun(chat_id, state);
  }
}

// One caregiver at a time, so a scheduled cycle does not flood the model
// API or WhatsApp.
async function runFollowUps(
  name: string,
  chats: FollowUpChat[],
  trigger_source: AgentRunTrigger,
) {
  let ran = 0;
  for (const { chat_id, agent_key } of chats) {
    const done = await runScheduledAgent(chat_id, (id) =>
      lcAgent(id, agent_key, trigger_source),
    );
    if (done) ran++;
  }

  logger.log(`${name}: ran ${ran} of ${chats.length} caregivers`);
}

// Debounces agent runs per chat_id so that a burst of incoming messages
// results in exactly one agent run, triggered after the last message.
function scheduleAgentRun(
  chat_id: string,
  agent: (chat_id: string) => Promise<any>,
) {
  const state = getChatRunState(chat_id);

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = undefined;
    triggerAgentRun(chat_id, state, agent);
  }, AGENT_RUN_DEBOUNCE_MS);
}

// Hourly during the day (9 AM - 4 PM IST): run the agent conversation for the
// next batch of caregivers with an active booking. noOverlap skips a tick if
// the previous cycle is still running.
// cron.schedule(
//   "0 10-16 * * *",
//   () =>
//     lcAgentConversation().catch((err) => {
//       logger.error("Hourly agent conversation failed:", err);
//     }),
//   {
//     timezone: "Asia/Kolkata",
//     name: "Hourly Caregiver Agent Conversation",
//     noOverlap: true,
//   },
// );

// End of day (11:55 PM IST): build the day's agent conversation report,
// store it and post it to Slack.
cron.schedule(
  "0 18 * * *",
  () =>
    generateDailyReport(todayReportDate(), { notify: true }).catch((err) => {
      logger.error("Daily agent report failed:", err);
    }),
  {
    timezone: "Asia/Kolkata",
    name: "Daily Caregiver Agent Report",
    noOverlap: true,
  },
);

// Daily at 10 AM IST: the registration agent follows up with caregivers
// still in registration who have not been contacted for 3 days.
cron.schedule(
  "30 10 * * *",
  () =>
    runRegistrationFollowups().catch((err) => {
      logger.error("Registration follow-up failed:", err);
    }),
  {
    timezone: "Asia/Kolkata",
    name: "Daily Caregiver Registration Follow-up",
    noOverlap: true,
  },
);

// Monday 9:30 AM IST: welfare check-in with caregivers whose last
// conversation was over a week ago. Caregivers who have not replied for 3
// weeks are left alone.
cron.schedule(
  "30 9 * * 1",
  async () => {
    try {
      const chats = await getWeeklyFollowUpChats();
      await runFollowUps("Weekly follow-up", chats, "weekly_follow_up");
    } catch (err) {
      logger.error("Weekly follow-up failed:", err);
    }
  },
  {
    timezone: "Asia/Kolkata",
    name: "Weekly agent reach out",
    noOverlap: true,
  },
);

// 10 AM and 4 PM IST: run the handling agent for caregivers with an open
// escalation, so care team updates in the Slack thread reach them.
cron.schedule(
  "0 10,16 * * *",
  async () => {
    try {
      const chats = await getActiveEscalationChats();
      await runFollowUps("Escalation follow-up", chats, "escalation_follow_up");
    } catch (err) {
      logger.error("Escalation follow-up failed:", err);
    }
  },
  {
    timezone: "Asia/Kolkata",
    name: "Escalation follow-up",
    noOverlap: true,
  },
);

// Every 15 minutes: caregivers contacted for a booking who have not
// replied within the reply window are marked 'no_response'. DB only, no
// messages are sent.
cron.schedule("*/15 9-17 * * *", () => markOverdueNoResponse(), {
  timezone: "Asia/Kolkata",
  name: "Recruitment No Response",
  noOverlap: true,
});

export function madhavi_server(app: Express) {
  // lcAgentConversation().catch((err) => {
  //   console.error("startAgentConversation failed:", err);
  // });

  // An employee replied in a Slack thread the agent opened: run the agent
  // for that user's chat through the same per-chat queue as WhatsApp
  // messages, so the two never run concurrently.
  startSlackBridge(({ chat_id, agent_key }) =>
    scheduleAgentRun(chat_id, (id) => lcAgent(id, agent_key, "slack_reply")),
  ).catch((err) => {
    logger.error("Slack bridge failed to start:", err);
  });

  app.get("/digital-manager", async (req, res) => {
    // Process the request body as needed
    // For example, you can send a response back to the client
    res.sendStatus(200);
    return;
  });

  app.post("/digital-manager", async (req, res) => {
    const body = req.body;

    if (
      body.event_type === "message:received:new" &&
      body.chat &&
      !body.chat.is_group &&
      body.chat.phone
    ) {
      const chat_id = body.chat.chat_id;
      const is_chat_exists = await getDigitalCMChatByChatId(chat_id);

      if (!!is_chat_exists) {
        logger.debug("Received request body:", body);
        // const is_LC_member = await isLCMemberPhoneNumber(body.chat.phone);
        const is_LC_caregiver = await isCaregiverPhoneNumber(body.chat.phone);

        // if (is_LC_member) {
        if (is_LC_caregiver) {
          const hp_unique_id = is_chat_exists.hp_unique_id;
          const phone = String(body.chat.phone);

          // A reply to a job offer stops it from going 'no_response';
          // recorded before the agent run so its context is current.
          await recordCaregiverReply(hp_unique_id);

          // Opt-out keywords and opted-out people are handled before any
          // agent runs.
          scheduleAgentRun(chat_id, async (id) => {
            if (await handleInboundOptOut({ chat_id: id, hp_unique_id, phone }))
              return;
            return multiAgentRouter(id);
          });
        }
        // } else {
        // scheduleAgentRun(chat_id, tenantAgent);
        // }
      }
    }

    // Process the request body as needed
    // For example, you can send a response back to the client
    res.sendStatus(200);
    return;
  });
}
