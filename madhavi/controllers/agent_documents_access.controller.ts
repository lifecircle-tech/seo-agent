import { Request, Response } from "express";
import {
  insertAgentDocumentsAccess,
  findAgentDocumentsAccesses,
  findAgentDocumentsAccessById,
  deleteAgentDocumentsAccessById,
} from "../models/agent_documents_access.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createAgentDocumentsAccess(req: Request, res: Response) {
  const { agent_id, doc_id } = req.body;

  const access_id = await insertAgentDocumentsAccess({ agent_id, doc_id });
  const documentsAccess = await findAgentDocumentsAccessById(access_id);

  res.status(201).json(documentsAccess);
}

async function getAgentDocumentsAccessesByAgentId(
  req: Request,
  res: Response,
) {
  const { agent_id } = req.params as { agent_id: string };

  const documentsAccesses = await findAgentDocumentsAccesses({
    agent_id,
    ...parsePaginationQuery(req.query),
  });

  res.json(documentsAccesses);
}

async function deleteAgentDocumentsAccess(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteAgentDocumentsAccessById(id);

  if (!deleted) {
    res.status(404).json({ error: "Agent documents access not found" });
    return;
  }

  res.status(204).send();
}

export {
  createAgentDocumentsAccess,
  getAgentDocumentsAccessesByAgentId,
  deleteAgentDocumentsAccess,
};
