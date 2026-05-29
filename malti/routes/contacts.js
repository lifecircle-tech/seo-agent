import { Router } from "express";
import {
  register, list, getOne, manageOwnership,
  requestHandoff, completeHandoff, getPendingHandoffs,
  getTimeline, addTimelineEvent
} from "../controllers/contactsController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/",                                    requireAuth, register);
router.get("/",                                     requireAuth, list);
router.get("/handoffs/pending",                     requireAuth, getPendingHandoffs);
router.get("/:contactId",                           requireAuth, getOne);
router.patch("/:contactId/ownership",               requireAuth, manageOwnership);
router.post("/:contactId/handoff/request",          requireAuth, requestHandoff);
router.post("/:contactId/handoff/complete",         requireAuth, completeHandoff);
router.get("/:contactId/timeline",                  requireAuth, getTimeline);
router.post("/:contactId/timeline",                 requireAuth, addTimelineEvent);

export default router;
