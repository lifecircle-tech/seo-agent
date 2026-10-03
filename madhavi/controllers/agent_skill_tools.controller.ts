import { Request, Response } from "express";
import {
  insertAgentSkillTool,
  findAgentSkillTools,
  findAgentSkillToolById,
  updateAgentSkillToolById,
  updateAgentSkillToolActiveById,
  deleteAgentSkillToolById,
} from "../models/agent_skill_tools.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createAgentSkillTool(req: Request, res: Response) {
  const { skill_name, description, content, active } = req.body;

  const skill_id = await insertAgentSkillTool({
    skill_name,
    description,
    content,
    active,
  });
  const skillTool = await findAgentSkillToolById(skill_id);

  res.status(201).json(skillTool);
}

async function getAgentSkillTools(req: Request, res: Response) {
  const { skill_name, active } = req.query;

  const skillTools = await findAgentSkillTools({
    skill_name: skill_name as string | undefined,
    active: active !== undefined ? active === "true" : undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(skillTools);
}

async function getAgentSkillToolById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const skillTool = await findAgentSkillToolById(id);

  if (!skillTool) {
    res.status(404).json({ error: "Agent skill tool not found" });
    return;
  }

  res.json(skillTool);
}

async function updateAgentSkillTool(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { skill_name, description, content } = req.body;

  const updated = await updateAgentSkillToolById(id, {
    skill_name,
    description,
    content,
  });

  if (!updated) {
    res.status(404).json({ error: "Agent skill tool not found" });
    return;
  }

  const skillTool = await findAgentSkillToolById(id);

  res.json(skillTool);
}

async function updateAgentSkillToolActive(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { active } = req.body;

  const updated = await updateAgentSkillToolActiveById(id, active);

  if (!updated) {
    res.status(404).json({ error: "Agent skill tool not found" });
    return;
  }

  const skillTool = await findAgentSkillToolById(id);

  res.json(skillTool);
}

async function deleteAgentSkillTool(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteAgentSkillToolById(id);

  if (!deleted) {
    res.status(404).json({ error: "Agent skill tool not found" });
    return;
  }

  res.status(204).send();
}

export {
  createAgentSkillTool,
  getAgentSkillTools,
  getAgentSkillToolById,
  updateAgentSkillTool,
  updateAgentSkillToolActive,
  deleteAgentSkillTool,
};
