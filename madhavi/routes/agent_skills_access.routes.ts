import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAgentSkillsAccess,
  getAgentSkillsAccessesByAgentId,
  deleteAgentSkillsAccess,
} from "../controllers/agent_skills_access.controller.js";

const router = Router();

// base path - '/madhavi/agent-skills-access'

router.post("/", asyncHandler(createAgentSkillsAccess));
router.get("/agent/:agent_id", asyncHandler(getAgentSkillsAccessesByAgentId));
router.delete("/:id", asyncHandler(deleteAgentSkillsAccess));

export default router;
