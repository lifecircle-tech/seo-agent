import { Request, Response } from "express";
import {
  insertAgentSkillsAccess,
  findAgentSkillsAccesses,
  findAgentSkillsAccessById,
  deleteAgentSkillsAccessById,
} from "../models/agent_skills_access.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createAgentSkillsAccess(req: Request, res: Response) {
  const { agent_id, skill_id } = req.body;

  const access_id = await insertAgentSkillsAccess({ agent_id, skill_id });
  const skillsAccess = await findAgentSkillsAccessById(access_id);

  res.status(201).json(skillsAccess);
}

async function getAgentSkillsAccessesByAgentId(req: Request, res: Response) {
  const { agent_id } = req.params as { agent_id: string };

  const skillsAccesses = await findAgentSkillsAccesses({
    agent_id,
    ...parsePaginationQuery(req.query),
  });

  res.json(skillsAccesses);
}

async function deleteAgentSkillsAccess(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteAgentSkillsAccessById(id);

  if (!deleted) {
    res.status(404).json({ error: "Agent skills access not found" });
    return;
  }

  res.status(204).send();
}

export {
  createAgentSkillsAccess,
  getAgentSkillsAccessesByAgentId,
  deleteAgentSkillsAccess,
};
