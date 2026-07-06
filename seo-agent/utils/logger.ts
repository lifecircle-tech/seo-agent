import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function getLogFilePath(): string {
  return path.join(LOG_DIR, `seo-agent.log`);
}
function getErrorLogFilePath(): string {
  return path.join(LOG_DIR, `seo-agent-error.log`);
}

function formatLine(level: LogLevel, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const metaPart = meta !== undefined ? ` | ${JSON.stringify(meta)}` : "";
  return `[${ts}] [${level.padEnd(5)}] ${message} ${metaPart}\n`;
}

function write(level: LogLevel, message: string, meta?: unknown): void {
  const line = formatLine(level, message, meta);
  console.log(line.trim());
  fs.appendFileSync(getLogFilePath(), line);
  if(level === "ERROR") {
    fs.appendFileSync(getErrorLogFilePath(), line);
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => write("INFO", message, meta),
  warn: (message: string, meta?: unknown) => write("WARN", message, meta),
  error: (message: string, meta?: unknown) => write("ERROR", message, meta),
  debug: (message: string, meta?: unknown) => write("DEBUG", message, meta),
};
