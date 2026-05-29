import { Router } from "express";
import {
  create, list, getOne, updateStatus, addStage,
  addTasks, importCSV, listTasks, executeTask, handleReply, getMetrics
} from "../controllers/campaignsController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/",                               requireAuth, create);
router.get("/",                                requireAuth, list);
router.post("/reply",                          handleReply);           // PUBLIC — inbound webhook
router.get("/:id",                             requireAuth, getOne);
router.patch("/:id/status",                    requireAuth, updateStatus);
router.post("/:id/stages",                     requireAuth, addStage);
router.post("/:id/tasks",                      requireAuth, addTasks);
router.post("/:id/tasks/import",               requireAuth, importCSV);
router.get("/:id/tasks",                       requireAuth, listTasks);
router.post("/:id/tasks/:taskId/execute",      requireAuth, executeTask);
router.get("/:id/metrics",                     requireAuth, getMetrics);

export default router;
