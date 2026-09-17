import { logger } from "../../seo-agent/utils/logger";

interface ToolCallLogEntry {
  tool: string;
  params: unknown;
  sessionId?: string;
  ip?: string;
}

// Logs every MCP tool invocation. There's no auth layer yet, so "who" is
// approximated by session id + remote IP — swap in a real identity once
// auth is added.
export function logToolCall({ tool, params, sessionId, ip }: ToolCallLogEntry) {
  logger.log("mcp-tool call", {
    event: "tool_call",
    timestamp: new Date().toISOString(),
    tool,
    sessionId: sessionId ?? null,
    ip: ip ?? null,
    params,
  });
}
