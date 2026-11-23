import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { setTimeout } from "node:timers/promises";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import * as graph from "../graph-api.js";
import { GraphApiError } from "../graph-api.js";
import { logger } from "../logger.js";
import {
  getMedia,
  insertMedia,
  markMediaFailed,
  markMediaStored,
  type WaMedia,
} from "../models/media.model.js";
import type { UploadedMedia } from "../types.js";

// Types WhatsApp accepts, for naming stored files
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "text/plain": "txt",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

// WhatsApp may retry media downloads for a while, but its download URLs
// expire, so each attempt asks for a fresh one.
const DOWNLOAD_RETRY_DELAYS_MS = [0, 5_000, 30_000];

const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// "audio/ogg; codecs=opus" → "audio/ogg"
function baseMime(mime_type: string | null | undefined) {
  return (mime_type ?? "").split(";")[0].trim().toLowerCase();
}

function extensionFor(mime_type: string | null, filename: string | null) {
  const fromName = filename ? path.extname(filename).slice(1).toLowerCase() : "";
  if (/^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return EXTENSIONS[baseMime(mime_type)] ?? "bin";
}

// Stored as "<yyyy-mm>/<media id>.<ext>" under WHATSAPP_MEDIA_DIR
function relativePathFor(media_id: string, mime_type: string | null, filename: string | null) {
  const month = new Date().toISOString().slice(0, 7);
  return `${month}/${media_id}.${extensionFor(mime_type, filename)}`;
}

function absolutePath(relative: string) {
  const absolute = path.resolve(config.mediaDir, relative);
  if (!absolute.startsWith(config.mediaDir + path.sep)) {
    throw new Error(`media path ${relative} is outside the media directory`);
  }
  return absolute;
}

function parseMediaId(media_id: string) {
  if (!MEDIA_ID_PATTERN.test(media_id)) {
    throw new HttpError(400, "invalid_media_id", "Invalid media id");
  }
  return media_id;
}

async function fileExists(file: string) {
  return access(file).then(
    () => true,
    () => false,
  );
}

// ── Inbound: download from WhatsApp ───────────────────────────────────

async function fetchAndStore(media_id: string): Promise<WaMedia> {
  const media = await getMedia(media_id);
  if (!media) throw new Error(`media ${media_id} is not known`);

  const relative = relativePathFor(media_id, media.mime_type, media.filename);
  const target = absolutePath(relative);
  const partial = `${target}.part`;

  try {
    const info = await graph.getMediaInfo(media_id);
    const res = await graph.downloadMedia(info.url);
    await mkdir(path.dirname(target), { recursive: true });

    const hash = createHash("sha256");
    let size = 0;
    await pipeline(
      Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          size += chunk.length;
          callback(null, chunk);
        },
      }),
      createWriteStream(partial),
    );
    await rename(partial, target);

    const digest = hash.digest();
    const expected = info.sha256 ?? media.sha256;
    if (
      expected &&
      expected !== digest.toString("hex") &&
      expected !== digest.toString("base64")
    ) {
      logger.warn(`[whatsapp] sha256 of media ${media_id} does not match WhatsApp's`);
    }

    await markMediaStored({
      media_id,
      mime_type: media.mime_type ?? info.mime_type ?? null,
      file_path: relative,
      file_size: size,
      sha256: digest.toString("hex"),
    });
  } catch (err: any) {
    await rm(partial, { force: true }).catch(() => {});
    await markMediaFailed(media_id, String(err?.message ?? err)).catch(() => {});
    throw err;
  }

  logger.log(`[whatsapp] stored media ${media_id} at ${relative}`);
  return (await getMedia(media_id)) as WaMedia;
}

// One download per media id at a time
const inFlight = new Map<string, Promise<WaMedia>>();

function downloadMedia(media_id: string) {
  let download = inFlight.get(media_id);
  if (!download) {
    download = fetchAndStore(media_id).finally(() => inFlight.delete(media_id));
    inFlight.set(media_id, download);
  }
  return download;
}

// Called for each received message with media. Does not block the webhook;
// GET /media/:id downloads on demand if this has not finished or failed.
function downloadInBackground(media_id: string) {
  (async () => {
    let lastError: unknown;
    for (const delay of DOWNLOAD_RETRY_DELAYS_MS) {
      if (delay) await setTimeout(delay);
      try {
        await downloadMedia(media_id);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    logger.error(`[whatsapp] could not download media ${media_id}`, lastError);
  })();
}

// The stored file for a media id, downloading received media if needed
async function getMediaFile(media_id: string) {
  let media = await getMedia(parseMediaId(media_id));
  if (!media) throw new HttpError(404, "media_not_found", `No media with id ${media_id}`);

  const stored =
    media.status === "stored" &&
    media.file_path &&
    (await fileExists(absolutePath(media.file_path)));

  if (!stored) {
    if (media.direction !== "inbound") {
      throw new HttpError(404, "media_not_stored", `Media ${media_id} has no stored file`);
    }
    try {
      media = await downloadMedia(media_id);
    } catch (err: any) {
      throw new HttpError(
        502,
        "media_download_failed",
        `Could not download media ${media_id} from WhatsApp: ${err?.message ?? err}`,
      );
    }
  }

  return {
    path: absolutePath(media.file_path as string),
    mime_type: media.mime_type,
    filename: media.filename,
  };
}

// ── Outbound: upload to WhatsApp ──────────────────────────────────────

async function uploadMedia(
  file: Buffer,
  mime_type: string | undefined,
  filename: string | null,
): Promise<UploadedMedia> {
  const mime = baseMime(mime_type);
  if (!file.length) throw new HttpError(400, "invalid_media", "The file is empty");
  if (!mime || mime === "application/octet-stream") {
    throw new HttpError(
      400,
      "invalid_media",
      "Set Content-Type to the file's MIME type, e.g. application/pdf",
    );
  }

  let media_id: string;
  try {
    media_id = (await graph.uploadMedia(file, mime, filename ?? `upload.${extensionFor(mime, null)}`)).id;
  } catch (err) {
    if (!(err instanceof GraphApiError)) throw err;
    throw new HttpError(502, "whatsapp_api_error", err.message, {
      graph_code: err.code ?? null,
      graph_details: err.details ?? null,
    });
  }

  // Keep a copy, so the history can serve what was sent
  const relative = relativePathFor(media_id, mime, filename);
  let stored = true;
  try {
    const target = absolutePath(relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file);
  } catch (err) {
    stored = false;
    logger.error(`[whatsapp] uploaded media ${media_id} but could not keep a copy`, err);
  }

  await insertMedia({
    media_id,
    direction: "outbound",
    mime_type: mime,
    filename,
    sha256: createHash("sha256").update(file).digest("hex"),
    file_size: file.length,
    file_path: stored ? relative : null,
    status: stored ? "stored" : "failed",
  });

  logger.log(`[whatsapp] uploaded media ${media_id} (${mime}, ${file.length} bytes)`);
  return { media_id, mime_type: mime, filename, file_size: file.length };
}

export { downloadInBackground, getMediaFile, uploadMedia };
