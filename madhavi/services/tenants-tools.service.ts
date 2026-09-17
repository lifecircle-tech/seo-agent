import { findTenantAgentToolAccesses } from "../models/tenant_agent_tool_access.model";

async function getTenantsTools(tenant_id: number) {
  const tools_list = await findTenantAgentToolAccesses({
    tenant_id,
    status: "active",
  });

  const tools = tools_list.map((tool) => tool.name);

  return tools;
}

export { getTenantsTools };
