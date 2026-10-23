import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { logger } from "../utils/logger";
import { SLACK_TOOL_PURPOSE } from "../config/slack-channels";
import {
  insertAgentAction,
  insertAgentRun,
  updateAgentRunCompleted,
  type AgentRunTrigger,
} from "../models/lc-agent-audit.model";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 60 * 1000,
  maxRetries: 1,
});

// Same model as the agents themselves; classification is a short, cheap call.
const AUDIT_MODEL = "claude-haiku-4-5";
// Tool output kept in the audit trail, per action.
const ACTION_OUTPUT_MAX_CHARS = 2000;
// Most recent chat messages given to the classifier.
const CLASSIFY_MESSAGE_LIMIT = 10;

export const CONVERSATION_TOPICS = [
  "salary_payment",
  "advance_request",
  "leave_request",
  "duty_booking",
  "patient_care",
  "health_safety",
  "complaint",
  "documents_info",
  "app_support",
  "general_checkin",
  "other",
] as const;

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;

const ConversationAssessment = z.object({
  topic: z.enum(CONVERSATION_TOPICS),
  summary: z.string(),
  severity: z.enum(SEVERITIES),
  severity_reason: z.string(),
});

type ConversationAssessment = z.infer<typeof ConversationAssessment>;

const CLASSIFY_PROMPT = `You audit conversations between LifeCircle's care-management agent and caregivers (home nurses / attendants placed with patients).
Given the recent WhatsApp messages and the actions the agent took in this run, classify the conversation.

topic - the main subject of the caregiver's latest concern:
- salary_payment: salary, payment delays, deductions
- advance_request: asking for a salary advance
- leave_request: leave, time off, going home
- duty_booking: shifts, duty hours, replacement, booking or placement issues
- patient_care: the patient's condition, care tasks, medicines, routines
- health_safety: the caregiver's own health, injury, harassment, abuse or safety
- complaint: complaint about the client family, staff or service
- documents_info: ID, documents, personal details, policy questions
- app_support: problems with the app or technical issues
- general_checkin: greetings, well-being check-ins, small talk
- other: anything else

severity:
- critical: immediate risk to the caregiver's or patient's safety or wellbeing (medical emergency, abuse, harassment, threat of violence, caregiver abandoning duty or patient left unattended). Needs the care team today.
- high: needs care-team follow-up soon (unpaid salary, serious conflict with the family, caregiver wants to leave the job, repeated unresolved complaint).
- medium: a routine request that needs someone to act (leave, advance, document, duty change).
- low: informational, greetings, or fully handled by the agent.

summary - one or two sentences in English: what the caregiver needed and what the agent did.
severity_reason - one short sentence on why that severity.`;

export type AuditedAction = {
  tool_name: string;
  action_type: string;
  input: unknown;
  is_error: boolean;
};

// Document and skill tools are local, the orchestrator records them as
// "reference" itself.
export function getActionType(tool_name: string) {
  if (tool_name === "send_whatsapp_message") return "whatsapp_message";
  if (tool_name === "create_support_ticket") return "support_ticket";
  if (tool_name === "reply_in_slack_thread") return "slack_thread_update";
  if (tool_name === "update_recruitment_status") return "recruitment_update";

  const slack_purpose = SLACK_TOOL_PURPOSE[tool_name];
  if (slack_purpose === "report") return "escalation";
  if (slack_purpose === "suggestion") return "suggestion";

  return "lookup";
}

// Opens the audit record for an agent run. Never throws: auditing must not
// stop the agent from replying.
async function startAgentRunAudit(args: {
  caregiver: Record<string, string | number> | null | undefined;
  chat_id: string | null;
  agent_key: string;
  trigger_source: AgentRunTrigger;
  chat_messages: { sender?: string; message?: string }[];
}) {
  try {
    const last_caregiver_message =
      args.chat_messages.find((m) => m.sender === "caregiver")?.message ??
      null;

    return await insertAgentRun({
      hp_unique_id: (args.caregiver?.["cg_id"] as number | undefined) ?? null,
      caregiver_name: (args.caregiver?.["name"] as string | undefined) ?? null,
      caregiver_phone:
        (args.caregiver?.["phone"] as string | undefined) ?? null,
      chat_id: args.chat_id,
      agent_key: args.agent_key,
      trigger_source: args.trigger_source,
      last_caregiver_message,
    });
  } catch (err) {
    logger.error("[startAgentRunAudit]", err);
    return null;
  }
}

function recordAgentAction(
  run_id: number | null,
  action: AuditedAction & { output: string },
) {
  if (!run_id) return;

  insertAgentAction({
    run_id,
    tool_name: action.tool_name,
    action_type: action.action_type,
    input: action.input,
    output: action.output.slice(0, ACTION_OUTPUT_MAX_CHARS),
    is_error: action.is_error,
  }).catch((err) => logger.error("[recordAgentAction]", err));
}

async function classifyConversation(args: {
  caregiver_name: string | null;
  chat_messages: { sender?: string; message?: string; timestamp?: unknown }[];
  actions: AuditedAction[];
  final_response: string;
}) {
  // Timelines returns the newest message first
  const recent_messages = args.chat_messages
    .slice(0, CLASSIFY_MESSAGE_LIMIT)
    .reverse()
    .map((m) => ({ from: m.sender, message: m.message, at: m.timestamp }));

  const actions = args.actions
    .filter((a) => a.action_type !== "lookup" && a.action_type !== "reference")
    .map((a) => ({ type: a.action_type, input: a.input, failed: a.is_error }));

  const response = await client.messages.parse({
    model: AUDIT_MODEL,
    max_tokens: 600,
    system: CLASSIFY_PROMPT,
    messages: [
      {
        role: "user",
        content: `CAREGIVER: ${args.caregiver_name ?? "unknown"}

RECENT WHATSAPP MESSAGES (oldest first):
${JSON.stringify(recent_messages)}

ACTIONS THE AGENT TOOK IN THIS RUN:
${JSON.stringify(actions)}

AGENT'S CLOSING NOTE:
${args.final_response || "(none)"}`,
      },
    ],
    output_config: { format: zodOutputFormat(ConversationAssessment) },
  });

  return { assessment: response.parsed_output, usage: response.usage };
}

// Closes the audit record: classifies the conversation and stores what the
// agent did. Returns the classifier's token usage so the caller can bill it.
async function completeAgentRunAudit(args: {
  run_id: number | null;
  caregiver: Record<string, string | number> | null | undefined;
  chat_id: string | null;
  chat_messages: { sender?: string; message?: string; timestamp?: unknown }[];
  actions: AuditedAction[];
  final_response: string;
  input_tokens: number;
  output_tokens: number;
}) {
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (!args.run_id) return usage;

  let assessment: ConversationAssessment | null = null;
  try {
    const result = await classifyConversation({
      caregiver_name: (args.caregiver?.["name"] as string | undefined) ?? null,
      chat_messages: args.chat_messages,
      actions: args.actions,
      final_response: args.final_response,
    });
    assessment = result.assessment;
    usage.input_tokens = result.usage.input_tokens;
    usage.output_tokens = result.usage.output_tokens;
  } catch (err) {
    logger.error("[completeAgentRunAudit] classification failed", err);
  }

  const sent_messages = args.actions.filter(
    (a) => a.action_type === "whatsapp_message" && !a.is_error,
  );
  const last_sent = sent_messages[sent_messages.length - 1]?.input as
    | Record<string, unknown>
    | undefined;

  try {
    await updateAgentRunCompleted(args.run_id, {
      status: "completed",
      chat_id: args.chat_id,
      reply_message: last_sent ? String(last_sent["message"] ?? "") : null,
      topic: assessment?.topic ?? null,
      summary: assessment?.summary ?? null,
      severity: assessment?.severity ?? null,
      severity_reason: assessment?.severity_reason ?? null,
      escalated: args.actions.some(
        (a) => a.action_type === "escalation" && !a.is_error,
      ),
      error: null,
      input_tokens: args.input_tokens + usage.input_tokens,
      output_tokens: args.output_tokens + usage.output_tokens,
    });
  } catch (err) {
    logger.error("[completeAgentRunAudit]", err);
  }

  return usage;
}

async function failAgentRunAudit(args: {
  run_id: number | null;
  chat_id: string | null;
  actions: AuditedAction[];
  error: unknown;
  input_tokens: number;
  output_tokens: number;
}) {
  if (!args.run_id) return;

  try {
    await updateAgentRunCompleted(args.run_id, {
      status: "failed",
      chat_id: args.chat_id,
      reply_message: null,
      topic: null,
      summary: null,
      severity: null,
      severity_reason: null,
      escalated: args.actions.some(
        (a) => a.action_type === "escalation" && !a.is_error,
      ),
      error:
        args.error instanceof Error ? args.error.message : String(args.error),
      input_tokens: args.input_tokens,
      output_tokens: args.output_tokens,
    });
  } catch (err) {
    logger.error("[failAgentRunAudit]", err);
  }
}

export {
  startAgentRunAudit,
  recordAgentAction,
  completeAgentRunAudit,
  failAgentRunAudit,
};
