import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../../middleware/auth.middleware.js";
import {
  createPaaQuestion,
  bulkUpsertPaaQuestions,
  listPaaQuestions,
  getPaaQuestionById,
  getPaaQuestionsForKeyword,
  markPaaQuestionsAsUsed,
  deletePaaQuestion,
} from "../controllers/paa.controller.js";

const router = Router();

// GET /paa?site_id=1&keyword_id=&category=faq&used_in_content=false&limit=20&offset=0
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const { site_id, keyword_id, category, used_in_content, limit, offset } =
    req.query as Record<string, string>;
  try {
    const result = await listPaaQuestions({
      site_id: site_id ? Number(site_id) : undefined,
      keyword_id: keyword_id || undefined,
      category: category || undefined,
      used_in_content:
        used_in_content !== undefined ? used_in_content === "true" : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[paa] list error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// GET /paa/keyword/:keywordId — all PAA questions for a keyword
// Accepts ?unused_only=true to return only questions not yet used in content
router.get(
  "/keyword/:keywordId",
  requireAuth,
  async (req: Request, res: Response) => {
    const { unused_only } = req.query as { unused_only?: string };
    try {
      const questions = await getPaaQuestionsForKeyword(
        req.params.keywordId,
        unused_only === "true",
      );
      res.json({ success: true, questions, count: questions.length });
    } catch (err) {
      console.error("[paa] keyword questions error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  },
);

// GET /paa/:id
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const question = await getPaaQuestionById(req.params.id);
    if (!question) {
      res.status(404).json({ success: false, error: "PAA question not found" });
      return;
    }
    res.json({ success: true, question });
  } catch (err) {
    console.error("[paa] get error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// POST /paa — create a single PAA question
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { site_id, keyword_id, question, answer, source_url, category } =
    req.body as Record<string, string>;

  if (!site_id || !keyword_id || !question) {
    res.status(400).json({
      success: false,
      error: "site_id, keyword_id and question are required",
    });
    return;
  }
  try {
    const record = await createPaaQuestion({
      id: randomUUID(),
      site_id: Number(site_id),
      keyword_id,
      question,
      answer: answer ?? null,
      source_url: source_url ?? null,
      category: category ?? null,
    });
    res.status(201).json({ success: true, question: record });
  } catch (err) {
    console.error("[paa] create error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// POST /paa/bulk — upsert many PAA questions at once (from orchestrator / scraper)
// Body: { items: [{ keyword_id, question, answer?, source_url?, category? }] }
router.post("/bulk", requireAuth, async (req: Request, res: Response) => {
  const { site_id, items } = req.body as {
    site_id?: number;
    items?: unknown[];
  };

  if (!site_id || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({
      success: false,
      error: "site_id and a non-empty items array are required",
    });
    return;
  }
  try {
    const records = (items as any[]).map((i) => ({
      id: randomUUID(),
      site_id: Number(site_id),
      keyword_id: String(i.keyword_id),
      question: String(i.question),
      answer: i.answer ?? null,
      source_url: i.source_url ?? null,
      category: i.category ?? null,
    }));
    const affected = await bulkUpsertPaaQuestions(records);
    res.status(201).json({ success: true, affected });
  } catch (err) {
    console.error("[paa] bulk upsert error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// POST /paa/mark-used — mark a list of question IDs as used in content
// Body: { ids: string[] }
router.post("/mark-used", requireAuth, async (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    res
      .status(400)
      .json({ success: false, error: "ids must be a non-empty array" });
    return;
  }
  try {
    const updated = await markPaaQuestionsAsUsed(
      ids.filter((id) => typeof id === "string") as string[],
    );
    res.json({ success: true, updated });
  } catch (err) {
    console.error("[paa] mark-used error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// DELETE /paa/:id
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deletePaaQuestion(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: "PAA question not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[paa] delete error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

export { router as paaRouter };
