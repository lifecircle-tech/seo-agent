import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./createMcpServer.js";
import { logToolCall } from "./toolCallLogger.js";
import { logger } from "../../madhavi/utils/logger.js";

function logToolCallsInRequest(
  body: unknown,
  sessionId: string | undefined,
  ip: string,
) {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (
      message &&
      typeof message === "object" &&
      "method" in message &&
      message.method === "tools/call" &&
      "params" in message
    ) {
      const params = message.params as { name?: string; arguments?: unknown };
      logToolCall({
        tool: params?.name ?? "unknown",
        params: params?.arguments,
        sessionId,
        ip,
      });
    }
  }
}

// Mounts the MCP Streamable HTTP endpoint on the given Express app, handling
// per-session transport creation/lookup/cleanup. Reusable across projects —
// only createMcpServer() needs to change to add your own tools/resources.
export function mountMcpRoutes(app: Express, path = "/mcp") {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  logger.log("Lifecircle MCP Server started...");

  app.post(path, async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "No valid session; expected an initialize request.",
          },
          id: null,
        });
        return;
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });

      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };

      const server = createMcpServer();
      await server.connect(transport);
    }

    logToolCallsInRequest(req.body, transport.sessionId, req.ip ?? "");

    await transport.handleRequest(req, res, req.body);
  });

  async function handleSessionRequest(req: Request, res: Response) {
    const sessionId = req.header("mcp-session-id");
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transport.handleRequest(req, res);
  }

  app.get(path, handleSessionRequest);
  app.delete(path, handleSessionRequest);
}
