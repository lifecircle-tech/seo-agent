import { findAgentPrompts } from "../models/agent_prompt.model";
import { findTenantAgentPrompts } from "../models/tenant_agent_prompt.model";

async function getMadhavisPrompt() {
  const prompts = await findAgentPrompts({ agent_id: 1 });
  const prompt_text = prompts.map((p) => p.content).join("\n\n");
  return prompt_text;
}

async function getTenantsSpecificPrompt(tenant_id: number) {
  const prompts = await findTenantAgentPrompts({ tenant_id, agent_id: 1 });
  const prompt_text = prompts.map((p) => p.content).join("\n\n");
  return prompt_text;
}

export { getMadhavisPrompt, getTenantsSpecificPrompt };
