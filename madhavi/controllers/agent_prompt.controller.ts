import { Request, Response } from "express";
import {
  findAgentPromptByAgentId,
  updateAgentPromptByAgentId,
} from "../models/agent_prompt.model.js";

async function updateAgentPromptByAgent(req: Request, res: Response) {
  const { agent_id } = req.params as { agent_id: string };
  const { content } = req.body;

  const updated = await updateAgentPromptByAgentId(agent_id, {
    content,
  });

  if (!updated) {
    res.status(404).json({ error: "Agent prompt not found" });
    return;
  }

  const agentPrompt = await findAgentPromptByAgentId(agent_id);

  res.json(agentPrompt);
}

export { updateAgentPromptByAgent };
