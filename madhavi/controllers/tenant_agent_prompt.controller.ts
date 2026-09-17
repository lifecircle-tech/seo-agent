import { Request, Response } from "express";
import {
  insertTenantAgentPrompt,
  findTenantAgentPrompts,
  findTenantAgentPromptById,
  updateTenantAgentPromptById,
  deleteTenantAgentPromptById,
} from "../models/tenant_agent_prompt.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createTenantAgentPrompt(req: Request, res: Response) {
  const { tenant_id, agent_id, section, content } = req.body;

  const tenant_prompt_id = await insertTenantAgentPrompt({
    tenant_id,
    agent_id: agent_id || '1',
    section,
    content,
  });
  const tenantAgentPrompt = await findTenantAgentPromptById(tenant_prompt_id);

  res.status(201).json(tenantAgentPrompt);
}

async function getTenantAgentPrompts(req: Request, res: Response) {
  const { tenant_id, agent_id, section } = req.query;

  const tenantAgentPrompts = await findTenantAgentPrompts({
    tenant_id: tenant_id as string | undefined,
    agent_id: agent_id as string | undefined,
    section: section as string | undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(tenantAgentPrompts);
}

async function getTenantAgentPromptById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const tenantAgentPrompt = await findTenantAgentPromptById(id);

  if (!tenantAgentPrompt) {
    res.status(404).json({ error: "Tenant agent prompt not found" });
    return;
  }

  res.json(tenantAgentPrompt);
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

export {
  createTenantAgentPrompt,
  getTenantAgentPrompts,
  getTenantAgentPromptById,
  updateTenantAgentPrompt,
  deleteTenantAgentPrompt,
};
