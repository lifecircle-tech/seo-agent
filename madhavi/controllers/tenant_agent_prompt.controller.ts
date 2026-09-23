import { Request, Response } from "express";
import {
  insertTenantAgentPrompt,
  findTenantAgentPromptById,
  updateTenantAgentPromptById,
  deleteTenantAgentPromptById,
} from "../models/tenant_agent_prompt.model.js";
import { findTenantAgentAccessByTenantAndAgent } from "../models/tenant_agent_access.model.js";

async function createTenantAgentPrompt(req: Request, res: Response) {
  const { tenant_id, agent_id, section, content } = req.body;
  const resolvedAgentId = agent_id;

  const access = await findTenantAgentAccessByTenantAndAgent(
    tenant_id,
    resolvedAgentId,
  );

  if (!access) {
    res.status(404).json({ error: "Tenant agent access not found" });
    return;
  }
  if (access.status !== "active") {
    res
      .status(403)
      .json({ error: "Agent access is not active for this tenant" });
    return;
  }

  const tenant_prompt_id = await insertTenantAgentPrompt({
    tenant_id,
    agent_id: resolvedAgentId,
    access_id: access.access_id,
    section,
    content,
  });
  const tenantAgentPrompt = await findTenantAgentPromptById(tenant_prompt_id);

  res.status(201).json(tenantAgentPrompt);
}

async function updateTenantAgentPrompt(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { section, content } = req.body;

  const updated = await updateTenantAgentPromptById(id, { section, content });

  if (!updated) {
    res.status(404).json({ error: "Tenant agent prompt not found" });
    return;
  }

  const tenantAgentPrompt = await findTenantAgentPromptById(id);

  res.json(tenantAgentPrompt);
}

async function deleteTenantAgentPrompt(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteTenantAgentPromptById(id);

  if (!deleted) {
    res.status(404).json({ error: "Tenant agent prompt not found" });
    return;
  }

  res.status(204).send();
}

export { createTenantAgentPrompt, updateTenantAgentPrompt, deleteTenantAgentPrompt };
