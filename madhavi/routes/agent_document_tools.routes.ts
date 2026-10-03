import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAgentDocumentTool,
  getAgentDocumentTools,
  getAgentDocumentToolById,
  updateAgentDocumentTool,
  updateAgentDocumentToolActive,
  deleteAgentDocumentTool,
} from "../controllers/agent_document_tools.controller.js";

const router = Router();

// base path - '/madhavi/agent-document-tools'

router.post("/", asyncHandler(createAgentDocumentTool));
router.get("/", asyncHandler(getAgentDocumentTools));
router.get("/:id", asyncHandler(getAgentDocumentToolById));
router.put("/:id", asyncHandler(updateAgentDocumentTool));
router.put("/:id/active", asyncHandler(updateAgentDocumentToolActive));
router.delete("/:id", asyncHandler(deleteAgentDocumentTool));

export default router;
