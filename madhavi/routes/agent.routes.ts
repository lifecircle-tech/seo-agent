import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAgent,
  getAgentByKey,
  checkAgentKeyAvailability,
  updateAgent,
  deleteAgent,
  getAgents,
} from "../controllers/agent.controller.js";

const router = Router();

// base path - '/madhavi/agent'

router.post("/", asyncHandler(createAgent));
router.get("/", asyncHandler(getAgents));
router.get("/key/:key/availability", asyncHandler(checkAgentKeyAvailability));
router.get("/:key", asyncHandler(getAgentByKey));
router.put("/:id", asyncHandler(updateAgent));
router.delete("/:id", asyncHandler(deleteAgent));

export default router;
