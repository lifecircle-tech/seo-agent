import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAgentPrompt,
  getAgentPrompts,
  getAgentPromptById,
  updateAgentPrompt,
  deleteAgentPrompt,
} from "../controllers/agent_prompt.controller.js";

const router = Router();

// base path - '/madhavi/agent-prompts'

router.post("/", asyncHandler(createAgentPrompt));
router.get("/", asyncHandler(getAgentPrompts));
router.get("/:id", asyncHandler(getAgentPromptById));
router.put("/:id", asyncHandler(updateAgentPrompt));
router.delete("/:id", asyncHandler(deleteAgentPrompt));

export default router;
