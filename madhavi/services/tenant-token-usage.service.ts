import { insertTenantAgentTokensUsage } from "../models/tenant_agent_tokens_usage.model.js";

async function recordTenantAgentTokensUsage({
  tenant_id,
  agent_id,
  input_tokens,
  output_tokens,
  request_started_at,
  request_completed_at,
}: {
  tenant_id: string;
  agent_id: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  request_started_at: string;
  request_completed_at?: string | null;
}) {
  try {
    const usage_id = await insertTenantAgentTokensUsage({
      tenant_id,
      agent_id,
      input_tokens,
      output_tokens,
      request_started_at,
      request_completed_at,
    });

    return usage_id;
  } catch (err) {
    console.log("[recordTenantAgentTokensUsage]", err);
    return null;
  }
}

export { recordTenantAgentTokensUsage };
