import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";

import {
  createPageContent,
  listPageContents,
  updatePageContentBody,
  acknowledgePageContent,
  updatePageContentError,
  updateRemark,
  rejectPageContent,
  createdPageContent,
  updatedPageContent,
} from "../controllers/page-content.controller.js";
import { AuthRequest, requireAuth } from "../../middleware/auth.middleware.js";
import { logger } from "../utils/logger.js";
import { recordChange } from "../services/change-impact.service.js";
import { verifyPageUpdate } from "../services/page-content.service.js";

/** Minimum % of the suggested content that must be on the live page before it can be marked created/updated. */
const PAGE_MATCH_MIN = Number(process.env.PAGE_MATCH_MIN) || 80;

/**
 * Returns an error payload when the live page doesn't (yet) contain the suggested
 * content, or null when it does. If the live page can't be checked (WordPress
 * unreachable), the action is allowed — the 18:00 check still records the match.
 */
async function liveMatchProblem(id: string): Promise<{ error: string; matchPercentage: number } | null> {
  try {
    const { matchPercentage } = await verifyPageUpdate(id);
    if (matchPercentage >= PAGE_MATCH_MIN) return null;
    return {
      matchPercentage,
      error:
        `The live page matches only ${matchPercentage}% of the suggested content (needs ${PAGE_MATCH_MIN}%). ` +
        `Publish the content on the website first, then mark it again.`,
    };
  } catch (err: any) {
    logger.warn(`[page-content] live match check skipped for ${id}: ${err.message}`);
    return null;
  }
}

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
      logger.error("[page-content] create error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /content
  router.get("/", requireAuth, async (req: Request, res: Response) => {
    try {
      const { site_id, limit, offset, status, sort_by, sort_dir } = req.query;
      let is_new = undefined;

      let temp_status;

      if (status == "new_page") {
        temp_status = 11;
        is_new = true;
      } else if (status == "existing") {
        temp_status = 11;
        is_new = false;
      } else if (status == "created") {
        temp_status = 21;
      } else if (status == "updated") {
        temp_status = 22;
      } else if (status == "rejected") {
        temp_status = 31;
      } else {
        temp_status = status;
      }

      const result = await listPageContents({
        site_id: site_id ? Number(site_id) : undefined,
        status: temp_status as string | number | undefined,
        is_new,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
        sort_by: sort_by as string | undefined,
        sort_dir:
          sort_dir === "asc" ? "asc" : sort_dir === "desc" ? "desc" : undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error("[page-content] list error:", err);
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
        logger.error("[page-content] update content error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  /**
   * @deprecated
   */
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
        logger.error("[page-content] acknowledge error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /content/:id/created
  router.post(
    "/:id/created",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const { remark } = req.body;

        const notLive = await liveMatchProblem(req.params.id);
        if (notLive) return res.status(409).json({ success: false, ...notLive });

        const record = await createdPageContent(
          req.params.id,
          String(userId),
          remark,
        );
        if (!record)
          return res
            .status(404)
            .json({ success: false, error: "Record not found" });

        await recordChange({
          site_id: record.site_id,
          source_type: "page_content",
          source_id: record.id,
          change_type: "page_created",
          urls: [record.url],
        });

        io.emit("content:updated", record);
        res.json({ success: true, record });
      } catch (err) {
        logger.error("[page-content] created error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /content/:id/updated
  router.post(
    "/:id/updated",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const { remark } = req.body;

        const notLive = await liveMatchProblem(req.params.id);
        if (notLive) return res.status(409).json({ success: false, ...notLive });

        const record = await updatedPageContent(
          req.params.id,
          String(userId),
          remark,
        );
        if (!record)
          return res
            .status(404)
            .json({ success: false, error: "Record not found" });

        await recordChange({
          site_id: record.site_id,
          source_type: "page_content",
          source_id: record.id,
          change_type: "page_updated",
          urls: [record.url],
        });

        io.emit("content:updated", record);
        res.json({ success: true, record });
      } catch (err) {
        logger.error("[page-content] updated error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /content/:id/reject
  router.post(
    "/:id/reject",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const { remark } = req.body;

        const record = await rejectPageContent(
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
        logger.error("[page-content] acknowledge error:", err);
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
        logger.error("[page-content] error error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /content/:id/error
  router.post(
    "/:id/add-remark",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { remark } = req.body;

        const record = await updateRemark(req.params.id, remark);
        if (!record)
          return res
            .status(404)
            .json({ success: false, error: "Record not found" });

        io.emit("content:updated", record);
        res.json({ success: true, record });
      } catch (err) {
        logger.error("[page-content] error error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  return router;
}
