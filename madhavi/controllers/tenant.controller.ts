import { Request, Response } from "express";
import {
  findTenants,
  findTenantById,
  updateTenantById,
  deleteTenantById,
  findTenantsAgents,
  findTenantBySlug,
} from "../models/tenant.model.js";
import { createTenant as createTenantService } from "../services/tenant.service.js";
import { parsePaginationQuery } from "../utils/common.js";
import { findAllTenantsAgentPrompt } from "../models/tenant_agent_prompt.model.js";

async function createTenant(req: Request, res: Response) {
  const { company_name, industry, address, contact_email } = req.body;

  const tenant = await createTenantService({
    company_name,
    industry,
    address,
    contact_email,
  });

  res.status(201).json(tenant);
}

async function getTenants(req: Request, res: Response) {
  const { company_name, industry, contact_email, search } = req.query;

  const tenants = await findTenants({
    company_name: (search as string) || (company_name as string | undefined),
    contact_email: (search as string) || (contact_email as string | undefined),
    ...parsePaginationQuery(req.query),
  });

  res.json(tenants);
}

async function getTenantById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const tenant = await findTenantById(id);
  const prompts = await findAllTenantsAgentPrompt(id);

  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  res.json({ ...tenant, prompts });
}

async function getTenantBySlug(req: Request, res: Response) {
  const { slug } = req.params as { slug: string };

  const tenant = await findTenantBySlug(slug);
  const prompts = await findAllTenantsAgentPrompt(tenant.tenant_id);

  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  res.json({ ...tenant, prompts });
}

async function getTenantAgents(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const agents = await findTenantsAgents(id);

  res.json(
    agents.map((agent) => ({
      ...agent,
      agent_name: agent.name,
      promptSectionCount: agent.prompt_count,
      activeToolCount: agent.tool_count,
    })),
  );
}

async function updateTenant(req: Request, res: Response) {
  const { slug } = req.params as { slug: string };
  const { company_name, industry, address, contact_email } = req.body;

  const updated = await updateTenantById(slug, {
    company_name,
    industry,
    address,
    contact_email,
  });

  if (!updated) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  const tenant = await findTenantBySlug(slug);

  res.json(tenant);
}

async function deleteTenant(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteTenantById(id);

  if (!deleted) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  res.status(204).send();
}

export {
  createTenant,
  getTenants,
  getTenantById,
  getTenantBySlug,
  getTenantAgents,
  updateTenant,
  deleteTenant,
};
