import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Logs land at: seo-agent/logs/malti.log
// __dirname = src/api/malti/utils → go up 4 levels to reach seo-agent/
const LOG_DIR  = join(__dirname, "../../../../logs");
const LOG_FILE = join(LOG_DIR, "malti.log");

try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const COLORS = {
  INFO:  "\x1b[36m",  // cyan
  WARN:  "\x1b[33m",  // yellow
  ERROR: "\x1b[31m",  // red
  DEBUG: "\x1b[90m",  // gray
};
const RESET = "\x1b[0m";

function istTimestamp() {
  return new Date().toLocaleString("en-IN", {
    timeZone:  "Asia/Kolkata",
    year:      "numeric", month:  "2-digit", day:    "2-digit",
    hour:      "2-digit", minute: "2-digit", second: "2-digit",
    hour12:    false,
  });
}

function write(level, module, message, data) {
  const ts       = istTimestamp();
  const dataStr  = data != null
    ? ` | ${typeof data === "object" ? JSON.stringify(data) : data}`
    : "";
  const line     = `[${ts}] [${level.padEnd(5)}] [${module}] ${message}${dataStr}\n`;
  const color    = COLORS[level] ?? "";
  console.log(`${color}${line.trim()}${RESET}`);
  try { appendFileSync(LOG_FILE, line); } catch {}
}

export const maltiLogger = {
  info:  (module, message, data) => write("INFO",  module, message, data),
  warn:  (module, message, data) => write("WARN",  module, message, data),
  error: (module, message, data) => write("ERROR", module, message, data),
  debug: (module, message, data) => write("DEBUG", module, message, data),
};
