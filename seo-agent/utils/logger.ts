import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = "LOG" | "INFO" | "WARN" | "ERROR" | "DEBUG";

function getLogFilePath(): string {
  return path.join(LOG_DIR, `seo-agent.log`);
}
function getErrorLogFilePath(): string {
  return path.join(LOG_DIR, `seo-agent-error.log`);
}
function getDebugLogFilePath(): string {
  return path.join(LOG_DIR, `seo-agent-debug.log`);
}

function formatLogLines(level: LogLevel, ...arg: any[]) {
  const ts = new Date().toLocaleString();
  let lines = "";

  arg.forEach((a) => {
    if (typeof a == "object") {
      lines =
        lines +
        `[${ts}] [${level.padEnd(5)}] \n${JSON.stringify(a, null, 2)}\n`;
    } else {
      lines = lines + `[${ts}] [${level.padEnd(5)}] ${a}\n`;
    }
  });

  return lines;
}

function log(level: LogLevel, ...arg: any[]) {
  console.log(`[${level}]`, ...arg);
  const lines = formatLogLines(level, ...arg);
  fs.appendFileSync(getLogFilePath(), lines);

  if (level === "ERROR") {
    fs.appendFileSync(getErrorLogFilePath(), lines);
  }

  if (level === "DEBUG") {
    fs.appendFileSync(getDebugLogFilePath(), lines);
  }
}

export const logger = {
  log: (...args: any[]) => log("LOG", ...args),
  info: (...args: any[]) => log("INFO", ...args),
  warn: (...args: any[]) => log("WARN", ...args),
  error: (...args: any[]) => log("ERROR", ...args),
  debug: (...args: any[]) => log("DEBUG", ...args),
};
