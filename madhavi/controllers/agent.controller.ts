import { Request, Response } from "express";
import {
  insertAgent,
  findAgents,
  findAgentById,
  updateAgentById,
  deleteAgentById,
} from "../models/agent.model.js";
import { parsePaginationQuery } from "../utils/common.js";
import { findAgentPrompts } from "../models/agent_prompt.model.js";

async function createAgent(req: Request, res: Response) {
  const { name, is_active } = req.body;

  const agent_id = await insertAgent({ name, is_active });
  const agent = await findAgentById(agent_id);

  res.status(201).json(agent);
}

async function getAgents(req: Request, res: Response) {
  const { name, is_active } = req.query;

  const agents = await findAgents({
    name: name as string | undefined,
    is_active: is_active !== undefined ? is_active === "true" : undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(agents);
}

async function getAgentById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const agent = await findAgentById(id);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.json(agent);
}

async function updateAgent(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { name, is_active } = req.body;

  const updated = await updateAgentById(id, { name, is_active });

  if (!updated) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const agent = await findAgentById(id);

  res.json(agent);
}

async function deleteAgent(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteAgentById(id);

  if (!deleted) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.status(204).send();
}

async function getMadhaviAndPrompt(req: Request, res: Response) {
  const [madhavi] = await findAgents({ name: "Madhavi" });
  const prompts = await findAgentPrompts({ agent_id: madhavi.agent_id });

  const response = {
    ...madhavi,
    prompts,
  };

  res.json(response);
}

export { createAgent, getAgents, getAgentById, updateAgent, deleteAgent, getMadhaviAndPrompt };
