import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  checkCaregiversForBooking,
  closeBookingRecruitment,
  contactCaregiverForBooking,
  getBookingRecruitment,
  messageBookingCaregiver,
  placeCaregiverForBooking,
  updateRecruitmentStatus,
} from "../services/lc-recruitment.service.js";
import { logger } from "../../madhavi/utils/logger.js";

// Recruitment of caregivers for a booking (lead):
// contacted -> on_hold (interested) -> placed, or released / no_response.
// The rules (who may be contacted, which changes are allowed) are enforced
// in lc-recruitment.service, not left to the agent. 'no_response' and the
// caregiver's replies are handled by the madhavi server.

const resultSchema = {
  status: z.enum(["ok", "error"]),
  message: z.string(),
};

const candidateSchema = z.object({
  booking_id: z.number(),
  cg_id: z.number(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.string(),
  release_reason: z.string().nullable(),
  note: z.string().nullable(),
  contacted_at: z.string().nullable(),
  reply_due_at: z.string().nullable(),
  responded_at: z.string().nullable(),
  status_changed_at: z.string().nullable(),
});

function toToolResult<T extends { status: "ok" | "error" }>(result: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: result.status === "error",
  };
}

function toToolError(tool: string, err: any) {
  logger.error(`[${tool}]`, err);
  return toToolResult({
    status: "error" as const,
    message: `Something went wrong: ${err.message}. Nothing was changed.`,
  });
}

export function registerRecruitment(server: McpServer) {
  server.registerTool(
    "get_booking_recruitment",
    {
      title: "Get Booking Recruitment",
      description:
        "Get the recruitment state of a booking (lead): every caregiver approached for it with their status (contacted, on_hold = interested, no_response, placed, released), release reason and latest note. recruitment_status is open, filled or closed, or null when nobody was contacted yet",
      inputSchema: {
        booking_id: z.number(),
      },
      outputSchema: z.object({
        status: z.enum(["ok", "error"]),
        message: z.string().optional(),
        booking_id: z.number().optional(),
        recruitment_status: z.string().nullable().optional(),
        close_reason: z.string().nullable().optional(),
        opened_at: z.string().nullable().optional(),
        counts: z.record(z.string(), z.number()).optional(),
        candidates: z.array(candidateSchema).optional(),
      }),
    },
    async ({ booking_id }) => {
      try {
        const recruitment = await getBookingRecruitment(booking_id);
        return toToolResult({ status: "ok" as const, ...recruitment });
      } catch (err) {
        return toToolError("get_booking_recruitment", err);
      }
    },
  );

  server.registerTool(
    "check_caregivers_for_booking",
    {
      title: "Check Caregivers For Booking",
      description:
        "Check which caregivers (by cg_id) may be contacted for a booking. Use on search results before messaging: caregivers already contacted or released for this booking, or on hold for another booking, must not be contacted",
      inputSchema: {
        booking_id: z.number(),
        cg_ids: z.array(z.number()).min(1).max(50),
      },
      outputSchema: z.object({
        status: z.enum(["ok", "error"]),
        message: z.string().optional(),
        caregivers: z
          .array(
            z.object({
              cg_id: z.number(),
              can_contact: z.boolean(),
              reason: z.string().optional(),
            }),
          )
          .optional(),
      }),
    },
    async ({ booking_id, cg_ids }) => {
      try {
        const caregivers = await checkCaregiversForBooking(booking_id, cg_ids);
        return toToolResult({ status: "ok" as const, caregivers });
      } catch (err) {
        return toToolError("check_caregivers_for_booking", err);
      }
    },
  );

  server.registerTool(
    "contact_caregiver_for_booking",
    {
      title: "Contact Caregiver For Booking",
      description:
        "Send a caregiver their FIRST WhatsApp job offer for a booking and record them as contacted. For caregivers already contacted, use 'message_booking_caregiver'. Refuses caregivers who must not be contacted (already contacted or released for this booking, on hold for another booking, booking filled or closed). One caregiver per call",
      inputSchema: {
        booking_id: z.number(),
        cg_id: z.number(),
        message: z.string().min(1).max(1000),
      },
      outputSchema: z.object({
        ...resultSchema,
        phone: z.string().optional(),
        chat_id: z.string().optional(),
        message_id: z.string().optional(),
      }),
    },
    async ({ booking_id, cg_id, message }) => {
      try {
        const result = await contactCaregiverForBooking({
          booking_id,
          hp_unique_id: cg_id,
          message,
        });
        return toToolResult(result);
      } catch (err) {
        return toToolError("contact_caregiver_for_booking", err);
      }
    },
  );

  server.registerTool(
    "message_booking_caregiver",
    {
      title: "Message Booking Caregiver",
      description:
        "Send a WhatsApp message to a caregiver already contacted for a booking, whatever their status: selection confirmation to the placed caregiver, case filled/closed to the others, follow-ups and answers. Uses the caregiver's number on record. Does not change their status. One caregiver per call",
      inputSchema: {
        booking_id: z.number(),
        cg_id: z.number(),
        message: z.string().min(1).max(1000),
      },
      outputSchema: z.object({
        ...resultSchema,
        phone: z.string().optional(),
        chat_id: z.string().optional(),
        message_id: z.string().optional(),
      }),
    },
    async ({ booking_id, cg_id, message }) => {
      try {
        const result = await messageBookingCaregiver({
          booking_id,
          hp_unique_id: cg_id,
          message,
        });
        return toToolResult(result);
      } catch (err) {
        return toToolError("message_booking_caregiver", err);
      }
    },
  );

  server.registerTool(
    "update_recruitment_status",
    {
      title: "Update Recruitment Status",
      description:
        "Record a contacted caregiver's answer for a booking: 'on_hold' when they are interested, 'released' when they decline (release_reason 'declined'), are rejected by the care team ('not_selected'), or a placed caregiver leaves the booking ('left_booking'). A released caregiver is never contacted again for that booking",
      inputSchema: {
        booking_id: z.number(),
        cg_id: z.number(),
        status: z.enum(["on_hold", "released"]),
        release_reason: z
          .enum(["declined", "not_selected", "left_booking"])
          .optional()
          .describe("Required when status is 'released'"),
        note: z
          .string()
          .max(500)
          .optional()
          .describe("What the caregiver said or why: conditions, expected pay, joining date"),
      },
      outputSchema: z.object(resultSchema),
    },
    async ({ booking_id, cg_id, status, release_reason, note }) => {
      try {
        const result = await updateRecruitmentStatus({
          booking_id,
          hp_unique_id: cg_id,
          status,
          release_reason,
          note,
        });
        return toToolResult(result);
      } catch (err) {
        return toToolError("update_recruitment_status", err);
      }
    },
  );

  server.registerTool(
    "place_caregiver_for_booking",
    {
      title: "Place Caregiver For Booking",
      description:
        "Place an interested (on_hold) caregiver on a booking once the care team confirms the selection. Marks the booking filled and releases every other caregiver still in the running for it. Does not message anyone",
      inputSchema: {
        booking_id: z.number(),
        cg_id: z.number(),
        note: z.string().max(500).optional(),
      },
      outputSchema: z.object({
        ...resultSchema,
        released: z
          .array(
            z.object({
              cg_id: z.number(),
              name: z.string().nullable(),
              previous_status: z.string(),
            }),
          )
          .optional(),
      }),
    },
    async ({ booking_id, cg_id, note }) => {
      try {
        const result = await placeCaregiverForBooking({
          booking_id,
          hp_unique_id: cg_id,
          note,
        });
        return toToolResult(result);
      } catch (err) {
        return toToolError("place_caregiver_for_booking", err);
      }
    },
  );

  server.registerTool(
    "close_booking_recruitment",
    {
      title: "Close Booking Recruitment",
      description:
        "Stop recruitment for a booking (cancelled, lost, or filled outside this process) and release every caregiver on it, including a placed one. No more caregivers can be contacted for it. Does not message anyone",
      inputSchema: {
        booking_id: z.number(),
        reason: z.string().min(1).max(500),
      },
      outputSchema: z.object({
        ...resultSchema,
        released: z.number().optional(),
      }),
    },
    async ({ booking_id, reason }) => {
      try {
        const result = await closeBookingRecruitment({ booking_id, reason });
        return toToolResult(result);
      } catch (err) {
        return toToolError("close_booking_recruitment", err);
      }
    },
  );
}
