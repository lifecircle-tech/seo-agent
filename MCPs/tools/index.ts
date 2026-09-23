import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerWhatsappMessage,
  registerSlackMessage,
} from "./messages.tool.js";
import {
  registerCaregiversPayment,
  registerCareManager,
  registerClients,
  registerSupportTicket,
} from "./lifecircle.tool.js";

// Add new tool registrations here as the server grows.
export function registerTools(server: McpServer) {
  registerWhatsappMessage(server);
  registerSlackMessage(server);
  registerCareManager(server);
  registerClients(server);
  registerCaregiversPayment(server);
  registerSupportTicket(server);
}
