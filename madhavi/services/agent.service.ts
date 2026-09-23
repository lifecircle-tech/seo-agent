import { findAgentToolAccesses } from "../models/agent_tool_access.model";
import { findTenantsAgents } from "../models/tenant.model";

async function getTenantsAccessedAgent({ tenant_id }: { tenant_id: number }) {
  const agents_list = await findTenantsAgents(String(tenant_id));

  const agents = agents_list.map((agent) => ({
    name: agent.name,
    key: agent.key,
    description: agent.description,
  }));

  return agents;
}

async function getAgentTools({ agent_id }: { agent_id: number }) {
  const tool_list = await findAgentToolAccesses({ agent_id });
  const tools = tool_list.map((t) => t.name);

  return tools;
}

export { getTenantsAccessedAgent, getAgentTools };
