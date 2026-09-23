import { Request, Response } from "express";
import {
  insertAgentToolAccess,
  findAgentToolAccesses,
  findAgentToolAccessById,
  deleteAgentToolAccessById,
} from "../models/agent_tool_access.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createAgentToolAccess(req: Request, res: Response) {
  const { agent_id, tool_id, status } = req.body;

  const access_id = await insertAgentToolAccess({ agent_id, tool_id, status });
  const toolAccess = await findAgentToolAccessById(access_id);

  res.status(201).json(toolAccess);
}

async function getAgentToolAccessesByAgentId(req: Request, res: Response) {
  const { agent_id } = req.params as { agent_id: string };

  const toolAccesses = await findAgentToolAccesses({
    agent_id,
    ...parsePaginationQuery(req.query),
  });

  res.json(toolAccesses);
}

async function deleteAgentToolAccess(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteAgentToolAccessById(id);

  if (!deleted) {
    res.status(404).json({ error: "Agent tool access not found" });
    return;
  }

  res.status(204).send();
}

export {
  createAgentToolAccess,
  getAgentToolAccessesByAgentId,
  deleteAgentToolAccess,
};
