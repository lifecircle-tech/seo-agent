import { Request, Response } from "express";
import {
  insertMcpTool,
  findMcpTools,
  findMcpToolById,
  updateMcpToolById,
  deleteMcpToolById,
} from "../models/mcp_tools.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createMcpTool(req: Request, res: Response) {
  const { name, title, description, endpoint_url, is_active } = req.body;

  const tool_id = await insertMcpTool({
    name,
    title,
    description,
    endpoint_url,
    is_active,
  });
  const mcpTool = await findMcpToolById(tool_id);

  res.status(201).json(mcpTool);
}

async function getMcpTools(req: Request, res: Response) {
  const { name, is_active } = req.query;

  const mcpTools = await findMcpTools({
    name: name as string | undefined,
    is_active: is_active !== undefined ? is_active === "true" : undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(mcpTools);
}

async function getActiveMcpTools(req: Request, res: Response) {
  const mcpTools = await findMcpTools({
    is_active: true,
    ...parsePaginationQuery(req.query),
  });

  res.json(mcpTools);
}

async function getMcpToolById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const mcpTool = await findMcpToolById(id);

  if (!mcpTool) {
    res.status(404).json({ error: "MCP tool not found" });
    return;
  }

  res.json(mcpTool);
}

async function updateMcpTool(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { name, title, description, endpoint_url, is_active } = req.body;

  const updated = await updateMcpToolById(id, {
    name,
    title,
    description,
    endpoint_url,
    is_active,
  });

  if (!updated) {
    res.status(404).json({ error: "MCP tool not found" });
    return;
  }

  const mcpTool = await findMcpToolById(id);

  res.json(mcpTool);
}

async function deleteMcpTool(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteMcpToolById(id);

  if (!deleted) {
    res.status(404).json({ error: "MCP tool not found" });
    return;
  }

  res.status(204).send();
}

export {
  createMcpTool,
  getMcpTools,
  getActiveMcpTools,
  getMcpToolById,
  updateMcpTool,
  deleteMcpTool,
};
