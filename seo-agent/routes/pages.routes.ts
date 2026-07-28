import { Router, Request, Response } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import {
  getPageById,
  getPageByUrl,
  getPagesByIds,
  getPageWithKeywords,
  listPages,
  listPagesWithKeywords,
  upsertPage,
  linkKeywordToPage,
  unlinkKeywordFromPage,
  getKeywordsForPage,
  getKeywordWithPages,
} from "../controllers/page.controller.js";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

const router = Router();

// GET /pages?site_id=1&type=page&limit=20&offset=0&sort_by=impressions&sort_dir=desc
// Accepts ?with_keywords=true to include joined keyword data
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const { site_id, type, limit, offset, sort_by, sort_dir, with_keywords } =
    req.query as Record<string, string>;

  const filters = {
    site_id: site_id ? Number(site_id) : undefined,
    type: type || undefined,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
    sort_by: sort_by || undefined,
    sort_dir: sort_dir === "asc" ? ("asc" as const) : ("desc" as const),
  };

  try {
    if (with_keywords === "true") {
      const result = await listPagesWithKeywords(filters);
      res.json({ success: true, ...result });
    } else {
      const result = await listPages(filters);
      res.json({ success: true, ...result });
    }
  } catch (err) {
    logger.error("[pages] list error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// GET /pages/by-url?url=https://example.com/some-page
router.get("/by-url", requireAuth, async (req: Request, res: Response) => {
  const { url } = req.query as { url?: string };
  if (!url) {
    res.status(400).json({ success: false, error: "url query param required" });
    return;
  }
  try {
    const page = await getPageByUrl(url);
    if (!page) {
      res.status(404).json({ success: false, error: "Page not found" });
      return;
    }
    res.json({ success: true, page });
  } catch (err) {
    logger.error("[pages] by-url error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// POST /pages/batch — fetch pages by a list of IDs
// Body: { ids: string[] }
router.post("/batch", requireAuth, async (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ success: false, error: "ids must be a non-empty array" });
    return;
  }
  const pageIds = ids.filter((id) => typeof id === "string") as string[];
  try {
    const pages = await getPagesByIds(pageIds);
    res.json({ success: true, pages, count: pages.length });
  } catch (err) {
    logger.error("[pages] batch error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// GET /pages/:id
// Accepts ?with_keywords=true to include joined keyword data
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const { with_keywords } = req.query as { with_keywords?: string };
  try {
    if (with_keywords === "true") {
      const page = await getPageWithKeywords(req.params.id);
      if (!page) {
        res.status(404).json({ success: false, error: "Page not found" });
        return;
      }
      res.json({ success: true, page });
    } else {
      const page = await getPageById(req.params.id);
      if (!page) {
        res.status(404).json({ success: false, error: "Page not found" });
        return;
      }
      res.json({ success: true, page });
    }
  } catch (err) {
    logger.error("[pages] get error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// GET /pages/:id/keywords — all keywords linked to a page
router.get("/:id/keywords", requireAuth, async (req: Request, res: Response) => {
  try {
    const keywords = await getKeywordsForPage(req.params.id);
    res.json({ success: true, keywords, count: keywords.length });
  } catch (err) {
    logger.error("[pages] get keywords error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// POST /pages — create / upsert a page by URL
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { site_id, url, wp_id, title, meta_description, type, clicks, impressions, ctr, position, last_modified } =
    req.body as Record<string, any>;

  if (!site_id || !url) {
    res.status(400).json({ success: false, error: "site_id and url are required" });
    return;
  }
  try {
    const page = await upsertPage({
      id: randomUUID(),
      site_id: Number(site_id),
      url: String(url),
      wp_id: wp_id != null ? Number(wp_id) : null,
      title: title ?? null,
      meta_description: meta_description ?? null,
      type: type ?? null,
      last_modified: last_modified ?? null,
    });
    res.status(201).json({ success: true, page });
  } catch (err) {
    logger.error("[pages] upsert error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// POST /pages/:id/keywords/:keywordId — link a keyword to a page
router.post("/:id/keywords/:keywordId", requireAuth, async (req: Request, res: Response) => {
  const { site_id } = req.body as { site_id?: number };
  if (!site_id) {
    res.status(400).json({ success: false, error: "site_id required in body" });
    return;
  }
  try {
    const link = await linkKeywordToPage(req.params.id, req.params.keywordId, Number(site_id));
    res.status(201).json({ success: true, link });
  } catch (err) {
    logger.error("[pages] link keyword error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// DELETE /pages/:id/keywords/:keywordId — unlink a keyword from a page
router.delete("/:id/keywords/:keywordId", requireAuth, async (req: Request, res: Response) => {
  try {
    const removed = await unlinkKeywordFromPage(req.params.id, req.params.keywordId);
    if (!removed) {
      res.status(404).json({ success: false, error: "Link not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error("[pages] unlink keyword error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// GET /pages/keywords/:keywordId/pages — all pages linked to a keyword (joined)
router.get("/keywords/:keywordId/pages", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await getKeywordWithPages(req.params.keywordId);
    if (!result) {
      res.status(404).json({ success: false, error: "Keyword not found" });
      return;
    }
    res.json({ success: true, keyword: result });
  } catch (err) {
    logger.error("[pages] keyword with pages error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

export { router as pagesRouter };
