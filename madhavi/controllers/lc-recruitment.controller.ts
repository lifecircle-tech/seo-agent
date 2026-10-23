import { Request, Response } from "express";
import {
  normalizePagination,
  parsePaginationQuery,
} from "../utils/common.js";
import {
  getReportDayRange,
  isValidReportDate,
} from "../services/lc-daily-report.service.js";
import {
  getCaregiverRecruitments,
  getRecruitmentLead,
  getRecruitmentSummary,
  isLeadStatus,
  listRecruitmentLeads,
} from "../services/lc-recruitment.service.js";

function queryString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInt(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// `from` / `to` are IST dates (YYYY-MM-DD), both inclusive. Returns the
// [from, to) bounds in IST wall-clock time, or an error message.
function parseDateRange(query: Record<string, unknown>) {
  const from = queryString(query.from);
  const to = queryString(query.to);

  if ((from && !isValidReportDate(from)) || (to && !isValidReportDate(to))) {
    return { error: "from / to must be dates in YYYY-MM-DD" };
  }
  if (from && to && from > to) {
    return { error: "from must not be after to" };
  }

  return {
    from: from ? getReportDayRange(from).from : undefined,
    to: to ? getReportDayRange(to).to : undefined,
  };
}

// GET /recruitment/leads?status=&booking_id=&from=&to=&limit=&offset=
async function getLeads(req: Request, res: Response) {
  const query = req.query as Record<string, unknown>;
  const { limit, offset } = normalizePagination(parsePaginationQuery(query));

  const status = queryString(query.status);
  if (status && !isLeadStatus(status)) {
    res.status(400).json({ message: "status must be open, filled or closed" });
    return;
  }

  const booking_id = queryString(query.booking_id);
  if (booking_id && !positiveInt(booking_id)) {
    res.status(400).json({ message: "Invalid booking_id" });
    return;
  }

  const range = parseDateRange(query);
  if ("error" in range) {
    res.status(400).json({ message: range.error });
    return;
  }

  res.json(
    await listRecruitmentLeads({
      status: status && isLeadStatus(status) ? status : undefined,
      booking_id: positiveInt(booking_id),
      from: range.from,
      to: range.to,
      limit,
      offset,
    }),
  );
}

// GET /recruitment/leads/:booking_id
async function getLead(req: Request, res: Response) {
  const booking_id = positiveInt(req.params.booking_id);
  if (!booking_id) {
    res.status(400).json({ message: "Invalid booking_id" });
    return;
  }

  const lead = await getRecruitmentLead(booking_id);
  if (!lead) {
    res
      .status(404)
      .json({ message: "No caregiver has been contacted for this booking" });
    return;
  }

  res.json(lead);
}

// GET /recruitment/caregivers/:cg_id?limit=&offset=
async function getCaregiver(req: Request, res: Response) {
  const hp_unique_id = positiveInt(req.params.cg_id);
  if (!hp_unique_id) {
    res.status(400).json({ message: "Invalid cg_id" });
    return;
  }

  const { limit, offset } = normalizePagination(
    parsePaginationQuery(req.query as Record<string, unknown>),
  );

  res.json(await getCaregiverRecruitments({ hp_unique_id, limit, offset }));
}

// GET /recruitment/summary?from=&to=
async function getSummary(req: Request, res: Response) {
  const query = req.query as Record<string, unknown>;
  const range = parseDateRange(query);
  if ("error" in range) {
    res.status(400).json({ message: range.error });
    return;
  }

  res.json({
    from: queryString(query.from) ?? null,
    to: queryString(query.to) ?? null,
    ...(await getRecruitmentSummary({ from: range.from, to: range.to })),
  });
}

export { getLeads, getLead, getCaregiver, getSummary };
