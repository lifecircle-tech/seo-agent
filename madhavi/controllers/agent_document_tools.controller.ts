import { Request, Response } from "express";
import {
  insertAgentDocumentTool,
  findAgentDocumentTools,
  findAgentDocumentToolById,
  updateAgentDocumentToolById,
  updateAgentDocumentToolActiveById,
  deleteAgentDocumentToolById,
} from "../models/agent_document_tools.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createAgentDocumentTool(req: Request, res: Response) {
  const { doc_name, description, content, active } = req.body;

  const doc_id = await insertAgentDocumentTool({
    doc_name,
    description,
    content,
    active,
  });
  const documentTool = await findAgentDocumentToolById(doc_id);

  res.status(201).json(documentTool);
}

async function getAgentDocumentTools(req: Request, res: Response) {
  const { doc_name, active } = req.query;

  const documentTools = await findAgentDocumentTools({
    doc_name: doc_name as string | undefined,
    active: active !== undefined ? active === "true" : undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(documentTools);
}

async function getAgentDocumentToolById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const documentTool = await findAgentDocumentToolById(id);

  if (!documentTool) {
    res.status(404).json({ error: "Agent document tool not found" });
    return;
  }

  res.json(documentTool);
}

async function updateAgentDocumentTool(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { doc_name, description, content } = req.body;

  const updated = await updateAgentDocumentToolById(id, {
    doc_name,
    description,
    content,
  });

  if (!updated) {
    res.status(404).json({ error: "Agent document tool not found" });
    return;
  }

  const documentTool = await findAgentDocumentToolById(id);

  res.json(documentTool);
}

async function updateAgentDocumentToolActive(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { active } = req.body;

  const updated = await updateAgentDocumentToolActiveById(id, active);

  if (!updated) {
    res.status(404).json({ error: "Agent document tool not found" });
    return;
  }

  const documentTool = await findAgentDocumentToolById(id);

  res.json(documentTool);
}

async function deleteAgentDocumentTool(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteAgentDocumentToolById(id);

  if (!deleted) {
    res.status(404).json({ error: "Agent document tool not found" });
    return;
  }

  res.status(204).send();
}

export {
  createAgentDocumentTool,
  getAgentDocumentTools,
  getAgentDocumentToolById,
  updateAgentDocumentTool,
  updateAgentDocumentToolActive,
  deleteAgentDocumentTool,
};
