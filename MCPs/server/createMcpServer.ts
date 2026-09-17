import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../tools/index.js";
import { registerResources } from "../resources/index.js";

export function createMcpServer() {
  const server = new McpServer({
    name: "mcp-server-lifecircle",
    version: "0.1.0",
  });

  registerTools(server);
  registerResources(server);

  return server;
}
