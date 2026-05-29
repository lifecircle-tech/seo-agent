import { Router } from "express";
import { getTraining, saveTraining, getTrainingSummary, getTrainingContext } from "../controllers/agentController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/:agentKey",          requireAuth, getTraining);
router.put("/:agentKey",          requireAuth, saveTraining);
router.get("/:agentKey/summary",  requireAuth, getTrainingSummary);
router.get("/:agentKey/context",  requireAuth, getTrainingContext);

export default router;
