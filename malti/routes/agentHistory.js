import { Router } from "express";
import { logRunHistory, getHistory, getStats } from "../controllers/agentController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/log",   requireAuth, logRunHistory);
router.get("/",       requireAuth, getHistory);
router.get("/stats",  requireAuth, getStats);

export default router;
