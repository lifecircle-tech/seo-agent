import { Router } from "express";
import { postToChannel, postViaWebhook, fetchMessages, listChannels, seedChannels } from "../controllers/slackController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/post",      requireAuth, postToChannel);
router.post("/webhook",   requireAuth, postViaWebhook);
router.get("/messages",   requireAuth, fetchMessages);
router.get("/channels",        requireAuth, listChannels);
router.post("/channels/seed",  requireAuth, seedChannels);

export default router;
