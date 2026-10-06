import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getCaregiverProfileStatus,
  getCaregiverWorkingStatus,
  getCaregiverWorkingHistory,
  getCaregiverPaymentInfo,
} from "../services/lc-caregivers.service.js";
import { searchCaregiverLLM } from "../services/LLM2.service.js";
import { getCareManagerDetails } from "../services/lc-caremanager.service.js";
import {
  getPatientDetail,
  getPatientCarePlan,
} from "../services/lc-client.service.js";
import {
  createSupportTicket,
  getSupportTypes,
} from "../services/lc-support.service.js";

// Caregiver tools
export function registerCaregiver(server: McpServer) {
  server.registerTool(
    "caregiver_profile_status",
    {
      title: "Caregiver Profile Status",
      description:
        "Get caregiver's profile status like completed/incompleted, missing information, preferences and qualification",
      inputSchema: {
        cg_id: z.number(),
      },
      outputSchema: z.object({
        caregiver_profile: z.union([
          z.object({
            profile_status: z.string(),
            cg_id: z.number(),
            hp_unique_id: z.number(),
            reason: z.string(),
            onboarding_status: z.string(),
            missing_data: z.array(z.string()).optional(),
            missing_documents: z.array(z.string()).optional(),
          }),
          z.object({
            profile_status: z.string(),
            cg_id: z.number(),
            hp_unique_id: z.number(),
            name: z.string(),
            gender: z.string(),
            age: z.number(),
            dob: z.string(),
            address: z.string(),
            languages: z.string().optional(),
            marital_status: z.string().optional(),
            preferred_locations: z.array(
              z.object({
                city: z.string(),
                area: z.string(),
                preference_order: z.number(),
              }),
            ),
            preferred_shift: z.array(
              z.object({ name: z.string(), preference_order: z.number() }),
            ),
            qualifications: z.array(z.string()).optional(),
            references: z.array(
              z.object({ name: z.string(), relation: z.string() }),
            ),
            created_on: z.string(),
          }),
          z.null(),
        ]),
      }),
    },
    async ({ cg_id }) => {
      const profile = await getCaregiverProfileStatus(cg_id);

      return {
        content: [{ type: "text", text: JSON.stringify({ result: profile }) }],
        structuredContent: { caregiver_profile: profile },
      };
    },
  );

  server.registerTool(
    "caregiver_working_status",
    {
      title: "Caregiver Working Status",
      description:
        "Get caregiver's current working status like working, on leave, terminated or on bench (ready to work), with related booking/leave/termination details",
      inputSchema: {
        cg_id: z.number(),
      },
      outputSchema: z.object({
        working_status: z
          .object({
            status: z.string(),
            from_date: z.string().optional(),
            reason: z.string().optional(),
            expected_return: z.string().optional(),
            cg_id: z.number().optional(),
            hp_unique_id: z.number().optional(),
            client_id: z.number().optional(),
            patient_id: z.number().optional(),
            booking_id: z.number().optional(),
            client_name: z.string().optional(),
            patient_name: z.string().optional(),
            patient_health_condition: z.string().optional(),
          })
          .or(z.null()),
      }),
    },
    async ({ cg_id }) => {
      const status = await getCaregiverWorkingStatus(cg_id);
      // Round-trip so DB Date values serialize to ISO strings for schema validation
      const working_status = status;

      return {
        content: [{ type: "text", text: JSON.stringify({ working_status }) }],
        structuredContent: { working_status },
      };
    },
  );

  server.registerTool(
    "caregiver_working_history",
    {
      title: "Caregiver Working History",
      description:
        "Get caregiver's working history: past and current assignments with client name, patient name, patient condition and from/to dates (no to_date means currently working)",
      inputSchema: {
        cg_id: z.number(),
      },
      outputSchema: z.object({
        working_history: z
          .array(
            z.object({
              cg_id: z.number(),
              hp_unique_id: z.number(),
              client_name: z.string().optional(),
              patient_name: z.string().optional(),
              patient_condition: z.string().optional(),
              from_date: z.string(),
              to_date: z.string().optional(),
            }),
          )
          .or(z.null()),
      }),
    },
    async ({ cg_id }) => {
      const working_history = await getCaregiverWorkingHistory(cg_id);

      return {
        content: [{ type: "text", text: JSON.stringify({ working_history }) }],
        structuredContent: { working_history },
      };
    },
  );

  server.registerTool(
    "caregiver_llm_search",
    {
      title: "Caregiver LLM Search",
      description:
        "Answer a natural-language question about caregivers by generating a read-only SQL query and running it. Returns the matching rows, or an error if the question can't be answered",
      inputSchema: {
        query: z.string(),
      },
      outputSchema: z.object({
        rows: z.array(z.record(z.string(), z.any())).optional(),
        error: z.string().optional(),
      }),
    },
    async ({ query }) => {
      const result = await searchCaregiverLLM(query);
      // The service returns rows on success and an error message string on failure
      const structuredContent = Array.isArray(result)
        ? { rows: result }
        : { error: result || "Query could not be answered from the schema" };

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        isError: !Array.isArray(result),
      };
    },
  );
}

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
        patient_id: z.number(),
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
    async ({ patient_id }) => {
      const patient_data = await getPatientDetail(patient_id);
      const structuredContent = patient_data ?? {};

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "patient_care_plan",
    {
      title: "Patient Care Plan",
      description:
        "Get patient's active care plan: list of care activities with how to perform them and their category",
      inputSchema: {
        patient_id: z.number(),
      },
      outputSchema: z.object({
        care_plan: z.object({
          care_remark: z.string(),
          notes: z.string(),
          medicines: z.array(
            z.object({
              med_name: z.string(),
              dose: z.string(),
              frequency: z.string(),
              instruction: z.string(),
            }),
          ),
          care_schedule: z.array(
            z.object({
              frequency: z.string(),
              activity_name: z.string(),
              how_to: z.string(),
              category_name: z.string(),
            }),
          ),
        }),
      }),
    },
    async ({ patient_id }) => {
      const care_plan = await getPatientCarePlan(patient_id);

      return {
        content: [{ type: "text", text: JSON.stringify({ care_plan }) }],
        structuredContent: { care_plan },
      };
    },
  );
}

// Tools related to caregiver's payment
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
      const result = await getCaregiverPaymentInfo(cg_id);

      const payment_info = {
        payment_info: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payment_info) }],
        structuredContent: payment_info,
      };
    },
  );
}

// Tools for support ticket
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
