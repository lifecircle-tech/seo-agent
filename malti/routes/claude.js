import { Router } from "express";
import { complete } from "../controllers/claudeController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/complete", requireAuth, complete);

export default router;
