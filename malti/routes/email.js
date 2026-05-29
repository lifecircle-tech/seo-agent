import { Router } from "express";
import { send, inboundWebhook, pollImap } from "../controllers/emailController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/send",             requireAuth, send);
router.post("/inbound-webhook",  inboundWebhook);   // PUBLIC — called by SES/SNS
router.get("/poll",              requireAuth, pollImap);

export default router;
