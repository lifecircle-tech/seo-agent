import { Request, Response } from "express";
import {
  getTenantTokenUsageSummary,
  getTenantTokenUsageDailyAnalytics,
  getTenantTokenUsageMonthlyAnalytics,
} from "../models/tenant_agent_tokens_usage.model.js";

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

export { getTenantTokenUsageSummaryReport, getTenantTokenUsageAnalyticsReport };
