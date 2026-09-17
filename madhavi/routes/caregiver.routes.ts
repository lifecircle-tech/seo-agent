import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createCaregiver,
  getCaregivers,
  getCaregiverById,
  updateCaregiver,
  deleteCaregiver,
} from "../controllers/caregiver.controller.js";

const router = Router();

// base path - '/madhavi/caregivers'

router.post("/", asyncHandler(createCaregiver));
router.get("/", asyncHandler(getCaregivers));
router.get("/:id", asyncHandler(getCaregiverById));
router.put("/:id", asyncHandler(updateCaregiver));
router.delete("/:id", asyncHandler(deleteCaregiver));

export default router;
