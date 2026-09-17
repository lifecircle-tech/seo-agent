import { Request, Response } from "express";
import {
  insertTenantAgentToolAccess,
  findTenantAgentToolAccesses,
  findTenantAgentToolAccessById,
  updateTenantAgentToolAccessById,
  deleteTenantAgentToolAccessById,
} from "../models/tenant_agent_tool_access.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createTenantAgentToolAccess(req: Request, res: Response) {
  const { tenant_id, agent_id, tool_id, status } = req.body;

  const access_id = await insertTenantAgentToolAccess({
    tenant_id,
    agent_id,
    tool_id,
    status,
  });
  const toolAccess = await findTenantAgentToolAccessById(access_id);

  res.status(201).json(toolAccess);
}

async function getTenantAgentToolAccesses(req: Request, res: Response) {
  const { tenant_id, agent_id, tool_id, slug, status } = req.query;

  const toolAccesses = await findTenantAgentToolAccesses({
    tenant_id: tenant_id as string | undefined,
    agent_id: agent_id as string | undefined,
    tool_id: tool_id as string | undefined,
    slug: slug as string | undefined,
    status: status as string | undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(toolAccesses);
}

async function getTenantAgentToolAccessById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const toolAccess = await findTenantAgentToolAccessById(id);

  if (!toolAccess) {
    res.status(404).json({ error: "Tenant agent tool access not found" });
    return;
  }

  res.json(toolAccess);
}

async function updateTenantAgentToolAccess(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { status } = req.body;

  const updated = await updateTenantAgentToolAccessById(id, { status });

  if (!updated) {
    res.status(404).json({ error: "Tenant agent tool access not found" });
    return;
  }

  const toolAccess = await findTenantAgentToolAccessById(id);

  res.json(toolAccess);
}

async function deleteTenantAgentToolAccess(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteTenantAgentToolAccessById(id);

  if (!deleted) {
    res.status(404).json({ error: "Tenant agent tool access not found" });
    return;
  }

  res.status(204).send();
}

export {
  createTenantAgentToolAccess,
  getTenantAgentToolAccesses,
  getTenantAgentToolAccessById,
  updateTenantAgentToolAccess,
  deleteTenantAgentToolAccess,
};
