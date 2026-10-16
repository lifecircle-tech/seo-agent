import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerWhatsappMessage,
  registerSlackMessage,
} from "./messages.tool.js";
import {
  registerCaregiver,
  registerCaregiversPayment,
  registerCareManager,
  registerClients,
  registerSupportTicket,
  registerBookings,
} from "./lifecircle.tool.js";
import { registerSlackContext } from "./slack-context.tool.js";
import { registerMessagingOptOut } from "./opt-out.tool.js";

// Add new tool registrations here as the server grows.
export function registerTools(server: McpServer) {
  registerWhatsappMessage(server);
  registerSlackMessage(server);
  registerCaregiver(server);
  registerCareManager(server);
  registerClients(server);
  registerCaregiversPayment(server);
  registerSupportTicket(server);
  registerBookings(server);
  registerSlackContext(server);
  registerMessagingOptOut(server);
}
