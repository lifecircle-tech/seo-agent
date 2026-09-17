import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Example resource: replace with your own logic.
export function registerStatusResource(server: McpServer) {
  server.registerResource(
    "status",
    "status://server",
    {
      title: "Server status",
      description: "Reports that the server is running.",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: "ok" }],
    }),
  );
}
