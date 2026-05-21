import { Router } from "express";
import { propose, list, getOne, approve, reject } from "../controllers/dbWritesController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/propose",      requireAuth, propose);
router.get("/",              requireAuth, list);
router.get("/:id",           requireAuth, getOne);
router.post("/:id/approve",  requireAuth, approve);
router.post("/:id/reject",   requireAuth, reject);

export default router;
