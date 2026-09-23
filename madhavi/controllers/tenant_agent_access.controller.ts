import { Request, Response } from "express";
import {
  insertTenantAgentAccess,
  findTenantAgentAccessById,
  findTenantAgentAccessByAgentKey,
  deleteTenantAgentAccessById,
} from "../models/tenant_agent_access.model.js";
import { findAgentToolAccesses } from "../models/agent_tool_access.model.js";
import { updateTenantAgentPromptAccessId } from "../models/tenant_agent_prompt.model.js";

async function createTenantAgentAccess(req: Request, res: Response) {
  const { tenant_id, agent_id, status } = req.body;

  const access_id = await insertTenantAgentAccess({
    tenant_id,
    agent_id,
    status,
  });
  await updateTenantAgentPromptAccessId(tenant_id, agent_id, access_id);
  const tenantAgentAccess = await findTenantAgentAccessById(access_id);

  res.status(201).json(tenantAgentAccess);
}

async function getTenantAgentAccessByAgentKey(req: Request, res: Response) {
  const { tenant_id, key } = req.params as { tenant_id: string; key: string };

  const agentAccess = await findTenantAgentAccessByAgentKey(tenant_id, key);

  if (!agentAccess) {
    res.status(404).json({ error: "Tenant agent access not found" });
    return;
  }

  const agentToolAccess = await findAgentToolAccesses({
    agent_id: agentAccess.agent_id,
  });

  res.json({ ...agentAccess, agent_tools: agentToolAccess });
}

async function deleteTenantAgentAccess(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const access = await findTenantAgentAccessById(id);

  if (!access) {
    res.status(404).json({ error: "Tenant agent access not found" });
    return;
  }

  await deleteTenantAgentAccessById(id);
  await updateTenantAgentPromptAccessId(access.tenant_id, access.agent_id, null);

  res.status(204).send();
}

export {
  createTenantAgentAccess,
  getTenantAgentAccessByAgentKey,
  deleteTenantAgentAccess,
};
