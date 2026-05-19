import { Router } from "express";
import { processInboundLead, getStats } from "../controllers/inboundController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// All inbound routes are PUBLIC (called by external webhooks/forms)
router.post("/lead",      processInboundLead);
router.post("/web-form",  (req, res) => { req.body.channel = "web_form"; return processInboundLead(req, res); });
router.post("/whatsapp",  (req, res) => { req.body.channel = "whatsapp"; return processInboundLead(req, res); });
router.post("/email",     (req, res) => { req.body.channel = "email";    return processInboundLead(req, res); });
router.get("/stats",      requireAuth, getStats);

export default router;
