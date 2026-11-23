import express, { Router } from "express";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import { asyncHandler, requireInternalToken } from "../middleware.js";
import { getMediaFile, uploadMedia } from "../services/media.service.js";
import {
  getChatHistory,
  getChatOrThrow,
  listChats,
  markAsRead,
  parseChatId,
  parseOutboundMessage,
  sendMessage,
} from "../services/messages.service.js";
import { listTemplates } from "../services/templates.service.js";

const router = Router();
router.use(requireInternalToken);

function intParam(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, "invalid_query", `Expected an integer between ${min} and ${max}`);
  }
  return n;
}

// ── Messages ──────────────────────────────────────────────────────────

// Body: { to: "+91...", type: "text", text } |
//       { to, type: "image"|"video"|"audio"|"document"|"sticker", media_id | link, caption?, filename? } |
//       { to, type: "template", template: { name, language?, components? } }
// plus an optional reply_to (wamid of the message being replied to).
router.post(
  "/messages",
  express.json({ limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const { to, reply_to, ...rest } = req.body ?? {};
    if (reply_to !== undefined && typeof reply_to !== "string") {
      throw new HttpError(400, "invalid_message", "reply_to must be a message id");
    }

    const result = await sendMessage(to, parseOutboundMessage(rest), { reply_to });
    res.status(201).json({ success: true, data: result });
  }),
);

// Body: { typing?: boolean }
router.post(
  "/messages/:wamid/read",
  express.json(),
  asyncHandler(async (req, res) => {
    await markAsRead(req.params.wamid, req.body?.typing === true);
    res.json({ success: true });
  }),
);

// ── Templates ─────────────────────────────────────────────────────────

// Message templates of every status, cached for 10 minutes; ?refresh=true
// reads them from WhatsApp again.
router.get(
  "/templates",
  asyncHandler(async (req, res) => {
    const templates = await listTemplates({ refresh: req.query.refresh === "true" });
    res.json({ success: true, data: templates });
  }),
);

// ── Chats ─────────────────────────────────────────────────────────────

router.get(
  "/chats",
  asyncHandler(async (req, res) => {
    const limit = intParam(req.query.limit, 50, 1, 200);
    const offset = intParam(req.query.offset, 0, 0, 1_000_000);
    res.json({ success: true, data: await listChats(limit, offset) });
  }),
);

// :chat_id is the person's WhatsApp number, with or without '+'
router.get(
  "/chats/:chat_id",
  asyncHandler(async (req, res) => {
    const chat = await getChatOrThrow(parseChatId(req.params.chat_id));
    res.json({ success: true, data: chat });
  }),
);

// Newest first. ?limit=20&before=<next_cursor>
router.get(
  "/chats/:chat_id/messages",
  asyncHandler(async (req, res) => {
    const limit = intParam(req.query.limit, 20, 1, 100);
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    const page = await getChatHistory(parseChatId(req.params.chat_id), limit, before);
    res.json({ success: true, data: page });
  }),
);

// ── Media ─────────────────────────────────────────────────────────────

// The body is the file itself, with Content-Type set to its MIME type and
// an optional ?filename=. Returns a media_id to send with POST /messages.
router.post(
  "/media",
  express.raw({ type: () => true, limit: config.maxUploadBytes }),
  asyncHandler(async (req, res) => {
    const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const filename =
      typeof req.query.filename === "string" && req.query.filename
        ? req.query.filename.slice(0, 255)
        : null;

    const media = await uploadMedia(file, req.get("content-type"), filename);
    res.status(201).json({ success: true, data: media });
  }),
);

// The file of a received or sent media item
router.get(
  "/media/:media_id",
  asyncHandler(async (req, res) => {
    const file = await getMediaFile(req.params.media_id);
    if (file.filename) res.attachment(file.filename);
    if (file.mime_type) res.type(file.mime_type);
    res.sendFile(file.path);
  }),
);

export { router as apiRouter };
