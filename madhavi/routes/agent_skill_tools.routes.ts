import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAgentSkillTool,
  getAgentSkillTools,
  getAgentSkillToolById,
  updateAgentSkillTool,
  updateAgentSkillToolActive,
  deleteAgentSkillTool,
} from "../controllers/agent_skill_tools.controller.js";

const router = Router();

// base path - '/madhavi/agent-skill-tools'

router.post("/", asyncHandler(createAgentSkillTool));
router.get("/", asyncHandler(getAgentSkillTools));
router.get("/:id", asyncHandler(getAgentSkillToolById));
router.put("/:id", asyncHandler(updateAgentSkillTool));
router.put("/:id/active", asyncHandler(updateAgentSkillToolActive));
router.delete("/:id", asyncHandler(deleteAgentSkillTool));

export default router;
