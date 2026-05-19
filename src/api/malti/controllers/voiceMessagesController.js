import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { callClaude } from "./claudeController.js";

const TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

async function translateText(text, targetLang) {
  if (targetLang === "en") return text;
  const result = await callClaude(
    `Translate the following text to language code "${targetLang}". Return ONLY the translated text, no explanation.`,
    text,
    1024
  );
  return result.trim();
}

async function synthesizeAudio(text, langCode = "en") {
  const apiKey = process.env.GCLOUD_TTS_API_KEY;
  if (!apiKey) throw new Error("GCLOUD_TTS_API_KEY not set");

  const cacheKey = createHash("md5").update(`${langCode}:${text}`).digest("hex");
  const cachePath = join(tmpdir(), `tts_${cacheKey}.mp3`);

  try {
    await readFile(cachePath);
    return { cache_hit: true, path: cachePath, cache_key: cacheKey };
  } catch {
    // Not cached, synthesize
  }

  const response = await fetch(`${TTS_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: langCode, ssmlGender: "NEUTRAL" },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });

  if (!response.ok) throw new Error(`TTS API error: ${response.status}`);
  const data = await response.json();
  const audioBuffer = Buffer.from(data.audioContent, "base64");
  await writeFile(cachePath, audioBuffer);

  return { cache_hit: false, path: cachePath, cache_key: cacheKey };
}

export async function synthesize(req, res) {
  const { text, lang_code = "en" } = req.body;
  if (!text) return res.status(400).json({ success: false, error: "text required" });
  try {
    const result = await synthesizeAudio(text, lang_code);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function prepare(req, res) {
  const { text, contact_meta = {}, agent_key } = req.body;
  if (!text) return res.status(400).json({ success: false, error: "text required" });
  try {
    const targetLang = contact_meta.preferred_language ?? "en";
    const translated = await translateText(text, targetLang);
    const audio = await synthesizeAudio(translated, targetLang);
    return res.json({ success: true, original: text, translated, lang: targetLang, audio });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}
