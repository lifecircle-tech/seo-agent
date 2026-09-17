import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCareManagerDetails } from "../services/lc-caremanager.service.js";
import { getPatientDetail } from "../services/lc-client.service.js";

// Get care manager details
export function registerCareManager(server: McpServer) {
  server.registerTool(
    "get_care_manager",
    {
      title: "Care Manager details",
      description: "Get Care Manager details by care manager id",
      inputSchema: {
        cm_id: z.number(),
      },
      outputSchema: z.object({
        care_manager: z
          .object({
            cm_id: z.number(),
            name: z.string(),
            phone: z.string(),
          })
          .optional(),
      }),
    },
    async ({ cm_id }) => {
      const cm_data = await getCareManagerDetails(cm_id);
      const structuredContent = cm_data ?? {};

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );
}

// Get clients details
export function registerClients(server: McpServer) {
  server.registerTool(
    "get_patient",
    {
      title: "Care Patient details",
      description: "Get Caregiver's patient details",
      inputSchema: {
        client_id: z.number(),
      },
      outputSchema: z.object({
        patient: z
          .object({
            name: z.string(),
            age: z.number(),
            gender: z.string(),
            relation_with_client: z.string(),
            health_conditions: z.string(),
          })
          .optional(),
      }),
    },
    async ({ client_id }) => {
      const patient_data = await getPatientDetail(client_id);
      const structuredContent = patient_data ?? {};

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );
}
