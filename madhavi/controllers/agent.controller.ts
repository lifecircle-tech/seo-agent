import { Request, Response } from "express";
import {
  insertAgent,
  findAgents,
  findAgentById,
  findAgentByKey,
  updateAgentById,
  deleteAgentById,
} from "../models/agent.model.js";
import { parsePaginationQuery } from "../utils/common.js";
import {
  findAgentPrompts,
  insertAgentPrompt,
} from "../models/agent_prompt.model.js";

const AGENT_KEY_PATTERN = /^[A-Za-z0-9_]+$/;

async function createAgent(req: Request, res: Response) {
  const { name, key, description, prompt, is_active } = req.body;

  if (!key || !AGENT_KEY_PATTERN.test(key)) {
    res.status(400).json({
      error:
        "'key' is required and must contain only letters, numbers, and underscores",
    });
    return;
  }

  if (!prompt) {
    res.status(400).json({
      error: "'prompt' is required",
    });
    return;
  }

  const agent_id = await insertAgent({ name, key, description, is_active });
  const agent_prompt = await insertAgentPrompt({
    agent_id,
    section: "prompt",
    content: prompt,
    version: 1,
  });
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

async function getAgentByKey(req: Request, res: Response) {
  const { key } = req.params as { key: string };

  const agent = await findAgentByKey(key);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.json(agent);
}

async function checkAgentKeyAvailability(req: Request, res: Response) {
  const { key } = req.params as { key: string };

  if (!key || !AGENT_KEY_PATTERN.test(key)) {
    res.status(400).json({
      error:
        "'key' is required and must contain only letters, numbers, and underscores",
    });
    return;
  }

  const agent = await findAgentByKey(key);
  const available = !agent;

  res.json({ key, available });
}

async function updateAgent(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { name, description, is_active } = req.body;

  const updated = await updateAgentById(id, { name, description, is_active });

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

export {
  createAgent,
  getAgents,
  getAgentByKey,
  checkAgentKeyAvailability,
  updateAgent,
  deleteAgent,
  getMadhaviAndPrompt,
};
