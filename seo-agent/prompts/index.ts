/**
 * Prompt files for the SEO agent.
 *
 * Every prompt sent to Claude lives in this folder as `<name>.md`, so prompt
 * changes are reviewed and versioned like code. Placeholders are `{{name}}` and
 * are filled by renderPrompt() with the same semantics as a template literal
 * (`${value}` → String(value)), so moving a prompt here does not change its text.
 *
 * Files are loaded once at startup; a missing folder or file fails fast.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

/**
 * Claude model for the SEO agent's generators. Separate from CLAUDE_MODEL, which
 * Malti uses with a different default — sharing it would silently switch models.
 */
export function seoAgentModel(): string {
  return process.env.SEO_AGENT_MODEL || "claude-sonnet-5";
}

function findPromptDir(): string {
  const candidates = [
    // running from source (tsx): this file's folder
    path.dirname(fileURLToPath(import.meta.url)),
    // running from a compiled build with the project root as cwd
    path.resolve(process.cwd(), "seo-agent", "prompts"),
  ];
  const dir = candidates.find((d) => {
    try {
      return fs.readdirSync(d).some((f) => f.endsWith(".md"));
    } catch {
      return false;
    }
  });
  if (!dir) {
    throw new Error(
      `[prompts] prompt folder not found (looked in: ${candidates.join(", ")})`,
    );
  }
  return dir;
}

const PROMPT_DIR = findPromptDir();

const prompts = new Map<string, string>(
  fs
    .readdirSync(PROMPT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f.slice(0, -3), fs.readFileSync(path.join(PROMPT_DIR, f), "utf8")]),
);

/** Fills `{{placeholders}}` in prompts/<name>.md. Throws on an unknown prompt or a missing value. */
export function renderPrompt(
  name: string,
  vars: Record<string, unknown> = {},
): string {
  const template = prompts.get(name);
  if (template === undefined) {
    throw new Error(`[prompts] unknown prompt "${name}" (no ${name}.md in ${PROMPT_DIR})`);
  }
  // One pass with a function replacer: values are inserted verbatim and never
  // re-scanned, so page content containing "{{x}}" or "$&" is safe.
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`[prompts] "${name}" needs a value for {{${key}}}`);
    }
    return String(vars[key]);
  });
}
