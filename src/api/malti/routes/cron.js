import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { runCron, getCronStatus, getSchedules, saveSchedule, toggleSchedule } from "../controllers/agentController.js";

const router = Router();

router.post("/run",                     requireAuth, runCron);
router.get("/status",                   requireAuth, getCronStatus);
router.get("/schedules",                requireAuth, getSchedules);
router.patch("/schedules/:key",         requireAuth, saveSchedule);
router.post("/schedules/:key/toggle",   requireAuth, toggleSchedule);

export default router;
