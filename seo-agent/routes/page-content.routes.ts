import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";

import {
  createPageContent,
  listPageContents,
  updatePageContentBody,
  acknowledgePageContent,
  updatePageContentError,
} from "../controllers/page-content.controller.js";
import { AuthRequest, requireAuth } from "../../middleware/auth.middleware.js";

export function pageContentRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /content
  router.post("/", async (req: Request, res: Response) => {
    try {
      const data = req.body;
      if (!data.site_id || !data.url) {
        return res
          .status(400)
          .json({ success: false, error: "Missing required fields" });
      }
      const record = await createPageContent({
        id: randomUUID(),
        ...data,
      });
      io.emit("content:created", record);
      res.status(201).json({ success: true, record });
    } catch (err) {
      console.error("[page-content] create error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /content
  router.get("/", requireAuth, async (req: Request, res: Response) => {
    try {
      const { site_id, limit, offset } = req.query;
      const result = await listPageContents({
        site_id: site_id ? Number(site_id) : undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      console.error("[page-content] list error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // PATCH /content/:id/content
  router.patch(
    "/:id/content",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { content, reasoning } = req.body;
        if (!content)
          return res
            .status(400)
            .json({ success: false, error: "Content is required" });

        const record = await updatePageContentBody(
          req.params.id,
          content,
          reasoning,
        );
        if (!record)
          return res
            .status(404)
            .json({ success: false, error: "Record not found" });

        io.emit("content:updated", record);
        res.json({ success: true, record });
      } catch (err) {
        console.error("[page-content] update content error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /content/:id/acknowledge
  router.post(
    "/:id/acknowledge",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const { remark } = req.body;

        const record = await acknowledgePageContent(
          req.params.id,
          String(userId),
          remark,
        );
        if (!record)
          return res
            .status(404)
            .json({ success: false, error: "Record not found" });

        io.emit("content:updated", record);
        res.json({ success: true, record });
      } catch (err) {
        console.error("[page-content] acknowledge error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /content/:id/error
  router.post(
    "/:id/error",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const record = await updatePageContentError(req.params.id);
        if (!record)
          return res
            .status(404)
            .json({ success: false, error: "Record not found" });

        io.emit("content:updated", record);
        res.json({ success: true, record });
      } catch (err) {
        console.error("[page-content] error error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  return router;
}
