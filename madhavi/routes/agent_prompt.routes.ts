import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { updateAgentPromptByAgent } from "../controllers/agent_prompt.controller.js";

const router = Router();

// base path - '/madhavi/agent-prompt'

router.put("/agent/:agent_id", asyncHandler(updateAgentPromptByAgent));

export default router;
