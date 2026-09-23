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
} from "./orchestrators/lc-orchestrator";

import cron from "node-cron";
import { logger } from "./utils/logger.js";

// Debounce window: if more messages arrive for the same chat within this
// window, they collapse into a single agent run after the last one.
const AGENT_RUN_DEBOUNCE_MS = 4000;

type ChatRunState = {
  timer?: NodeJS.Timeout;
  running: boolean;
  pendingRerun: boolean;
};

const chatRunStates = new Map<string, ChatRunState>();

function getChatRunState(chat_id: string): ChatRunState {
  let state = chatRunStates.get(chat_id);
  if (!state) {
    state = { running: false, pendingRerun: false };
    chatRunStates.set(chat_id, state);
  }
  return state;
}

// Runs the agent for a chat, ensuring only one run is ever in flight per
// chat_id. If a message arrives while a run is already in progress, it
// marks a rerun instead of starting a second concurrent run.
function triggerAgentRun(
  chat_id: string,
  state: ChatRunState,
  agent: (chat_id: string) => Promise<any>,
) {
  if (state.running) {
    state.pendingRerun = true;
    return;
  }

  state.running = true;
  agent(chat_id)
    .catch((err) => {
      logger.error(`Agent run failed for chat ${chat_id}:`, err);
    })
    .finally(() => {
      state.running = false;
      if (state.pendingRerun) {
        state.pendingRerun = false;
        triggerAgentRun(chat_id, state, agent);
      }
    });
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

export function madhavi_server(app: Express) {
  // lcAgentConversation().catch((err) => {
  //   console.error("startAgentConversation failed:", err);
  // });
  // tenantAgentConversation().catch((err) => {
  //   console.error("startAgentConversation failed:", err);
  // });

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
      ["916361479764", "918105938170"].includes(body.chat.phone)
    ) {
      console.log("Received request body:", body);
      const chat_id = body.chat.chat_id;

      const is_LC_member = await isLCMemberPhoneNumber(body.chat.phone);
      const is_LC_caregiver = await isCaregiverPhoneNumber(body.chat.phone);

      // if (is_LC_member) {
      //   if (is_LC_caregiver) {
      scheduleAgentRun(chat_id, multiAgentRouter);
      //   }
      // } else {
      // scheduleAgentRun(chat_id, tenantAgent);
      // }
    }

    // Process the request body as needed
    // For example, you can send a response back to the client
    res.sendStatus(200);
    return;
  });
}
