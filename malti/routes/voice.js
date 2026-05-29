import { Router } from "express";
import {
  getBolnaCalls, makeBolnaCall, getVapiCalls, bolnaWebhook,
  getBolnaAgentsList, getBolnaAgent, updateBolnaAgent,
  getBolnaHistory, getBolnaErrors, getBolnaTimeline,
} from "../controllers/voiceController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/bolna/calls",    requireAuth, getBolnaCalls);
router.post("/bolna/call",    requireAuth, makeBolnaCall);
router.get("/vapi/calls",     requireAuth, getVapiCalls);
router.post("/bolna/webhook", bolnaWebhook);   // PUBLIC — Bolna callback

router.get("/bolna/agents",              requireAuth, getBolnaAgentsList);
router.get("/bolna/agents/:agentId",    requireAuth, getBolnaAgent);
router.patch("/bolna/agents/:agentId",  requireAuth, updateBolnaAgent);
router.get("/bolna/history",  requireAuth, getBolnaHistory);
router.get("/bolna/errors",   requireAuth, getBolnaErrors);
router.get("/bolna/timeline", requireAuth, getBolnaTimeline);

export default router;
