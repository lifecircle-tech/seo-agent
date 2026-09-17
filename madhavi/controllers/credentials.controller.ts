import { Request, Response } from "express";
import {
  insertCredentials,
  findCredentials,
  findCredentialById,
  updateCredentialsById,
  deleteCredentialsById,
} from "../models/credentials.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createCredentials(req: Request, res: Response) {
  const { employee_id, username, password_hash } = req.body;

  const credential_id = await insertCredentials({
    employee_id,
    username,
    password_hash,
  });
  const credentials = await findCredentialById(credential_id);

  res.status(201).json(credentials);
}

async function getCredentials(req: Request, res: Response) {
  const { employee_id, username } = req.query;

  const credentials = await findCredentials({
    employee_id: employee_id as string | undefined,
    username: username as string | undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(credentials);
}

async function getCredentialById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const credentials = await findCredentialById(id);

  if (!credentials) {
    res.status(404).json({ error: "Credentials not found" });
    return;
  }

  res.json(credentials);
}

async function updateCredentials(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { username, password_hash, last_login } = req.body;

  const updated = await updateCredentialsById(id, {
    username,
    password_hash,
    last_login,
  });

  if (!updated) {
    res.status(404).json({ error: "Credentials not found" });
    return;
  }

  const credentials = await findCredentialById(id);

  res.json(credentials);
}

async function deleteCredentials(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteCredentialsById(id);

  if (!deleted) {
    res.status(404).json({ error: "Credentials not found" });
    return;
  }

  res.status(204).send();
}

export {
  createCredentials,
  getCredentials,
  getCredentialById,
  updateCredentials,
  deleteCredentials,
};
