import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = "LOG" | "INFO" | "WARN" | "ERROR" | "DEBUG";

function getLogFilePath(): string {
  return path.join(LOG_DIR, `mcp-tools.log`);
}
function getErrorLogFilePath(): string {
  return path.join(LOG_DIR, `mcp-tools-error.log`);
}
function getDebugLogFilePath(): string {
  return path.join(LOG_DIR, `mcp-tools-debug.log`);
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

function write(level: LogLevel, ...arg: any[]) {
  console.log(`[${level}]`, ...arg);
  fs.appendFileSync(getLogFilePath(), formatLogLines(level, ...arg));

  if (level === "ERROR") {
    fs.appendFileSync(getErrorLogFilePath(), formatLogLines(level, ...arg));
  }

  if (level === "DEBUG") {
    fs.appendFileSync(getDebugLogFilePath(), formatLogLines(level, ...arg));
  }
}

export const logger = {
  log: (...args: any[]) => write("LOG", ...args),
  info: (...args: any[]) => write("INFO", ...args),
  debug: (...args: any[]) => write("DEBUG", ...args),
  warn: (...args: any[]) => write("WARN", ...args),
  error: (...args: any[]) => write("ERROR", ...args),
};
