import {
  findAgentPromptByAgentKey,
} from "../models/agent_prompt.model";
import { findTenantAgentPrompts } from "../models/tenant_agent_prompt.model";

async function getTenantsSpecificPrompt(tenant_id: number, agent_id: number) {
  const prompts = await findTenantAgentPrompts({ tenant_id, agent_id });
  const prompt_text = prompts.map((p) => p.content).join("\n\n");
  return prompt_text;
}

async function getAgentsPrompt({ key }: { key: string }) {
  const agent = await findAgentPromptByAgentKey(key);
  return { agent_id: agent.agent_id, prompt: agent.content };
}

export { getTenantsSpecificPrompt, getAgentsPrompt };
