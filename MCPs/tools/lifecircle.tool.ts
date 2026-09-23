import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCareManagerDetails } from "../services/lc-caremanager.service.js";
import { getPatientDetail } from "../services/lc-client.service.js";
import {
  createSupportTicket,
  getSupportTypes,
} from "../services/lc-support.service.js";

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

export function registerCaregiversPayment(server: McpServer) {
  server.registerTool(
    "get_caregiver_payment_info",
    {
      title: "Caregivers Payment Info",
      description:
        "Get Caregiver's payment info, salary, base salary, payable amount, deduction, processing status",
      inputSchema: {
        cg_id: z.number(),
      },
      outputSchema: z.object({
        payment_info: z
          .object({
            cg_id: z.number(),
            time_period: z.string(),
            base_salary: z.number(),
            total_payable: z.number(),
            due_date: z.string(),
            deduction: z.object({
              unpaid_leaves: z.number(),
            }),
          })
          .optional(),
      }),
    },
    async ({ cg_id }) => {
      const payment_info = {
        payment_info: {
          cg_id: cg_id,
          time_period: "per_month",
          base_salary: 20000,
          total_payable: 18000,
          due_date: "2026-09-30",
          deduction: {
            unpaid_leaves: 2000,
          },
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payment_info) }],
        structuredContent: payment_info,
      };
    },
  );
}

export function registerSupportTicket(server: McpServer) {
  server.registerTool(
    "get_support_types",
    {
      title: "Support types option",
      description: "Get list of support types options",
      outputSchema: z.object({
        supportTypes: z
          .array(
            z.object({
              support_id: z.number(),
              name: z.string(),
            }),
          )
          .optional(),
      }),
    },
    async () => {
      const support_types = await getSupportTypes();
      const structured = {
        supportTypes: support_types,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  server.registerTool(
    "create_support_ticket",
    {
      title: "Create Support ticket",
      description:
        "Create Support ticket for caregiver like leave request, payment",
      inputSchema: {
        cg_id: z.number(),
        support_id: z.number(),
        title: z.string(),
        description: z.string(),
        from_date: z.string().optional(),
        to_date: z.string().optional(),
        amount: z.number().optional(),
      },
      outputSchema: z.object({
        status: z.string(),
      }),
    },
    async ({
      cg_id,
      support_id,
      title,
      description,
      from_date,
      to_date,
      amount,
    }) => {
      const result = await createSupportTicket({
        user_id: cg_id,
        support_id,
        title,
        description,
        from_date,
        to_date,
        amount,
      });

      const structured = { status: result };

      return {
        content: [{ type: "text", text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );
}
