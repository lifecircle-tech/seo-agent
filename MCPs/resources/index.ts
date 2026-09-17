import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStatusResource } from "./status.resource.js";

// Add new resource registrations here as the server grows.
export function registerResources(server: McpServer) {
  registerStatusResource(server);
}
