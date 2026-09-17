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
} from "./orchestrators/lc-orchestrator";

import cron from "node-cron";
import { logger } from "./utils/logger.js";

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
      lcAgent(chat_id);
      //   }
      // } else {
      //   tenantAgent(chat_id);
      // }
    }

    // Process the request body as needed
    // For example, you can send a response back to the client
    res.sendStatus(200);
    return;
  });
}
