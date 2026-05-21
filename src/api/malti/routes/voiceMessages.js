import { Router } from "express";
import { synthesize, prepare } from "../controllers/voiceMessagesController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/synthesize", requireAuth, synthesize);
router.post("/prepare",    requireAuth, prepare);

export default router;
