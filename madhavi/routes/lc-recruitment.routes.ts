import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getCaregiver,
  getLead,
  getLeads,
  getSummary,
} from "../controllers/lc-recruitment.controller.js";

const router = Router();

// base path - '/madhavi/recruitment'

router.get("/summary", asyncHandler(getSummary));
router.get("/leads", asyncHandler(getLeads));
router.get("/leads/:booking_id", asyncHandler(getLead));
router.get("/caregivers/:cg_id", asyncHandler(getCaregiver));

export default router;
