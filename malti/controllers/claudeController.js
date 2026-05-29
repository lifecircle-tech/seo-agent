import Anthropic from "@anthropic-ai/sdk";
import { maltiLogger } from "../utils/maltiLogger.js";

const LOG = "LLM";

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEFAULT_MODEL   = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5";

const USE_LOCAL       = process.env.USE_LOCAL_LLM === "true";
const LOCAL_MODEL     = process.env.LOCAL_MODEL || "deepseek-r1:7b";
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/v1$/, "");

async function callOllama(system, user, maxTokens) {
  const url = `${OLLAMA_BASE_URL}/v1/chat/completions`;
  maltiLogger.info(LOG, `Calling Ollama`, { model: LOCAL_MODEL, url, max_tokens: maxTokens });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LOCAL_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user   },
      ],
      max_tokens: maxTokens,
      stream:     false,
    })
  });
  if (!res.ok) {
    const body = await res.text();
    maltiLogger.error(LOG, `Ollama HTTP error`, { status: res.status, body: body.slice(0, 200) });
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }
  const data = await res.json();
  maltiLogger.info(LOG, `Ollama response`, { usage: data.usage });
  // Strip reasoning tags from deepseek-r1
  const text = (data.choices?.[0]?.message?.content || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  maltiLogger.debug(LOG, `Ollama clean text length: ${text.length}`);
  return { text, usage: data.usage };
}

export async function complete(req, res) {
  const { system, user, max_tokens = 4096 } = req.body;
  if (!system || !user) {
    return res.status(400).json({ success: false, error: "system and user are required" });
  }
  const backend = USE_LOCAL ? `Ollama (${LOCAL_MODEL})` : `Claude (${DEFAULT_MODEL})`;
  maltiLogger.info(LOG, `API completion request`, { backend, max_tokens });
  try {
    if (USE_LOCAL) {
      const { text, usage } = await callOllama(system, user, max_tokens);
      return res.json({ success: true, text, usage });
    }
    maltiLogger.info(LOG, `Calling Anthropic Claude`, { model: DEFAULT_MODEL });
    const message = await anthropicClient.messages.create({
      model: DEFAULT_MODEL,
      max_tokens,
      messages: [{ role: "user", content: user }],
      system,
    });
    const text = message.content[0]?.type === "text" ? message.content[0].text : "";
    maltiLogger.info(LOG, `Claude response`, { usage: message.usage });
    return res.json({ success: true, text, usage: message.usage });
  } catch (err) {
    maltiLogger.error(LOG, `Completion failed`, { error: String(err.message ?? err) });
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

// Internal helper used by other controllers
export async function callClaude(system, user, maxTokens = 4096) {
  if (USE_LOCAL) {
    maltiLogger.debug(LOG, `callClaude → Ollama`, { model: LOCAL_MODEL });
    const { text } = await callOllama(system, user, maxTokens);
    return text;
  }
  maltiLogger.debug(LOG, `callClaude → Anthropic`, { model: DEFAULT_MODEL });
  const message = await anthropicClient.messages.create({
    model:      DEFAULT_MODEL,
    max_tokens: maxTokens,
    messages:   [{ role: "user", content: user }],
    system,
  });
  return message.content[0]?.type === "text" ? message.content[0].text : "";
}
