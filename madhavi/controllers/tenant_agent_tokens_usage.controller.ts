import { Request, Response } from "express";
import {
  insertTenantAgentTokensUsage,
  findTenantAgentTokensUsages,
  findTenantAgentTokensUsageById,
  updateTenantAgentTokensUsageById,
  deleteTenantAgentTokensUsageById,
  getTenantTokenUsageSummary,
  getTenantTokenUsageDailyAnalytics,
  getTenantTokenUsageMonthlyAnalytics,
} from "../models/tenant_agent_tokens_usage.model.js";
import { parsePaginationQuery } from "../utils/common.js";

interface TokenUsageBucket {
  period: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  request_count: number;
}

function emptyBucket(period: string): TokenUsageBucket {
  return {
    period,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    request_count: 0,
  };
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayKey(date: Date) {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

async function createTenantAgentTokensUsage(req: Request, res: Response) {
  const {
    tenant_id,
    agent_id,
    input_tokens,
    output_tokens,
    request_started_at,
    request_completed_at,
  } = req.body;

  const usage_id = await insertTenantAgentTokensUsage({
    tenant_id,
    agent_id,
    input_tokens,
    output_tokens,
    request_started_at,
    request_completed_at,
  });
  const usage = await findTenantAgentTokensUsageById(usage_id);

  res.status(201).json(usage);
}

async function getTenantAgentTokensUsages(req: Request, res: Response) {
  const { tenant_id, agent_id } = req.query;

  const usages = await findTenantAgentTokensUsages({
    tenant_id: tenant_id as string | undefined,
    agent_id: agent_id as string | undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(usages);
}

async function getTenantAgentTokensUsageById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const usage = await findTenantAgentTokensUsageById(id);

  if (!usage) {
    res.status(404).json({ error: "Token usage record not found" });
    return;
  }

  res.json(usage);
}

async function updateTenantAgentTokensUsage(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { input_tokens, output_tokens, request_completed_at } = req.body;

  const updated = await updateTenantAgentTokensUsageById(id, {
    input_tokens,
    output_tokens,
    request_completed_at,
  });

  if (!updated) {
    res.status(404).json({ error: "Token usage record not found" });
    return;
  }

  const usage = await findTenantAgentTokensUsageById(id);

  res.json(usage);
}

async function deleteTenantAgentTokensUsage(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteTenantAgentTokensUsageById(id);

  if (!deleted) {
    res.status(404).json({ error: "Token usage record not found" });
    return;
  }

  res.status(204).send();
}

async function getTenantTokenUsageSummaryReport(
  req: Request,
  res: Response,
) {
  const { slug } = req.params as { slug: string };

  const rows = await getTenantTokenUsageSummary(slug);
  const byPeriod = new Map(rows.map((row) => [row.period, row]));

  const now = new Date();
  const currentMonth = monthKey(now);
  const lastMonth = monthKey(
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
  );

  res.json({
    tenant: slug,
    current_month: byPeriod.get(currentMonth) ?? emptyBucket(currentMonth),
    last_month: byPeriod.get(lastMonth) ?? emptyBucket(lastMonth),
  });
}

async function getTenantTokenUsageAnalyticsReport(
  req: Request,
  res: Response,
) {
  const { slug } = req.params as { slug: string };

  const [dailyRows, monthlyRows] = await Promise.all([
    getTenantTokenUsageDailyAnalytics(slug),
    getTenantTokenUsageMonthlyAnalytics(slug),
  ]);

  const dailyByPeriod = new Map(dailyRows.map((row) => [row.period, row]));
  const monthlyByPeriod = new Map(
    monthlyRows.map((row) => [row.period, row]),
  );

  const now = new Date();

  const daily: TokenUsageBucket[] = [];
  const daysInCurrentMonth = now.getDate();
  for (let day = 1; day <= daysInCurrentMonth; day++) {
    const date = new Date(now.getFullYear(), now.getMonth(), day);
    const key = dayKey(date);
    daily.push(dailyByPeriod.get(key) ?? emptyBucket(key));
  }

  const monthly: TokenUsageBucket[] = [];
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = monthKey(date);
    monthly.push(monthlyByPeriod.get(key) ?? emptyBucket(key));
  }

  res.json({ tenant: slug, daily, monthly });
}

export {
  createTenantAgentTokensUsage,
  getTenantAgentTokensUsages,
  getTenantAgentTokensUsageById,
  updateTenantAgentTokensUsage,
  deleteTenantAgentTokensUsage,
  getTenantTokenUsageSummaryReport,
  getTenantTokenUsageAnalyticsReport,
};
