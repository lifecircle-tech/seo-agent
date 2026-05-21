import { Router } from "express";
import { getBolnaCalls, makeBolnaCall, getVapiCalls, bolnaWebhook } from "../controllers/voiceController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/bolna/calls",    requireAuth, getBolnaCalls);
router.post("/bolna/call",    requireAuth, makeBolnaCall);
router.get("/vapi/calls",     requireAuth, getVapiCalls);
router.post("/bolna/webhook", bolnaWebhook);   // PUBLIC — Bolna callback

export default router;
