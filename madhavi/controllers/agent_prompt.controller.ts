import { Request, Response } from "express";
import {
  insertAgentPrompt,
  findAgentPrompts,
  findAgentPromptById,
  updateAgentPromptById,
  deleteAgentPromptById,
} from "../models/agent_prompt.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createAgentPrompt(req: Request, res: Response) {
  const { agent_id, section, content, version } = req.body;

  const prompt_id = await insertAgentPrompt({
    agent_id,
    section,
    content,
    version,
  });
  const agentPrompt = await findAgentPromptById(prompt_id);

  res.status(201).json(agentPrompt);
}

async function getAgentPrompts(req: Request, res: Response) {
  const { agent_id, section } = req.query;

  const agentPrompts = await findAgentPrompts({
    agent_id: agent_id as number | undefined,
    section: section as string | undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(agentPrompts);
}

async function getAgentPromptById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const agentPrompt = await findAgentPromptById(id);

  if (!agentPrompt) {
    res.status(404).json({ error: "Agent prompt not found" });
    return;
  }

  res.json(agentPrompt);
}

async function updateAgentPrompt(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { section, content, version } = req.body;

  const updated = await updateAgentPromptById(id, {
    section,
    content,
    version,
  });

  if (!updated) {
    res.status(404).json({ error: "Agent prompt not found" });
    return;
  }

  const agentPrompt = await findAgentPromptById(id);

  res.json(agentPrompt);
}

async function deleteAgentPrompt(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteAgentPromptById(id);

  if (!deleted) {
    res.status(404).json({ error: "Agent prompt not found" });
    return;
  }

  res.status(204).send();
}

export {
  createAgentPrompt,
  getAgentPrompts,
  getAgentPromptById,
  updateAgentPrompt,
  deleteAgentPrompt,
};
