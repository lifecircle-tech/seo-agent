import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  getAgentsList,
  createCustomAgent,
  updateCustomAgent,
  deleteCustomAgent,
  runAgentReport,
  savePersonality,
  saveChannelOverride,
} from "../controllers/agentReportsController.js";

const router = Router();

router.get("/",                       requireAuth, getAgentsList);
router.post("/",                      requireAuth, createCustomAgent);
router.patch("/:key",                 requireAuth, updateCustomAgent);
router.delete("/:key",                requireAuth, deleteCustomAgent);
router.post("/:key/run",              requireAuth, runAgentReport);
router.patch("/:key/personality",     requireAuth, savePersonality);
router.patch("/:key/channel",         requireAuth, saveChannelOverride);

export default router;
