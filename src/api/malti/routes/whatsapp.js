import { Router } from "express";
import { send } from "../controllers/whatsappController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/send-template", requireAuth, send);

export default router;
