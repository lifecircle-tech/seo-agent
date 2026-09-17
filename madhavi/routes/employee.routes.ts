import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
} from "../controllers/employee.controller.js";

const router = Router();

// base path - '/madhavi/employees'

router.post("/", asyncHandler(createEmployee));
router.get("/", asyncHandler(getEmployees));
router.get("/:id", asyncHandler(getEmployeeById));
router.put("/:id", asyncHandler(updateEmployee));
router.delete("/:id", asyncHandler(deleteEmployee));

export default router;
