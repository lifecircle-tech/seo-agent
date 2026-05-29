import { Router } from "express";
import { send }                                      from "../controllers/whatsappController.js";
import { sendOutboundTemplate }                      from "../controllers/whatsappAgentController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/send-template",          requireAuth, send);
router.post("/agent/send-template",    requireAuth, sendOutboundTemplate);

export default router;
