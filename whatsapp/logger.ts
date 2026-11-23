import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.resolve(process.cwd(), "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, "whatsapp.log");
const ERROR_LOG_FILE = path.join(LOG_DIR, "whatsapp-error.log");

type LogLevel = "LOG" | "INFO" | "WARN" | "ERROR" | "DEBUG";

function formatLogLines(level: LogLevel, ...args: any[]) {
  const ts = new Date().toLocaleString();

  return args
    .map((a) => {
      if (a instanceof Error) return `[${ts}] [${level.padEnd(5)}] ${a.stack ?? a.message}\n`;
      if (typeof a === "object") {
        return `[${ts}] [${level.padEnd(5)}] \n${JSON.stringify(a, null, 2)}\n`;
      }
      return `[${ts}] [${level.padEnd(5)}] ${a}\n`;
    })
    .join("");
}

function write(level: LogLevel, ...args: any[]) {
  console.log(`[${level}]`, ...args);
  const lines = formatLogLines(level, ...args);
  fs.appendFileSync(LOG_FILE, lines);
  if (level === "ERROR") fs.appendFileSync(ERROR_LOG_FILE, lines);
}

export const logger = {
  log: (...args: any[]) => write("LOG", ...args),
  info: (...args: any[]) => write("INFO", ...args),
  debug: (...args: any[]) => write("DEBUG", ...args),
  warn: (...args: any[]) => write("WARN", ...args),
  error: (...args: any[]) => write("ERROR", ...args),
};
