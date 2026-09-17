import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAgent,
  getAgentById,
  updateAgent,
  deleteAgent,
  getMadhaviAndPrompt,
} from "../controllers/agent.controller.js";

const router = Router();

// base path - '/madhavi/agents'

router.post("/", asyncHandler(createAgent));
router.get("/", asyncHandler(getMadhaviAndPrompt));
router.get("/:id", asyncHandler(getAgentById));
router.put("/:id", asyncHandler(updateAgent));
router.delete("/:id", asyncHandler(deleteAgent));

export default router;
