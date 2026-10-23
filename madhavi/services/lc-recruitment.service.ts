import { logger } from "../utils/logger";
import {
  ACTIVE_STATUSES,
  findCandidatesByLeadId,
  findCandidatesOfCaregiver,
  findEventsByCandidateIds,
  findRecruitmentLeadByBookingId,
  findRecruitmentLeads,
  getCandidatesByHpUniqueId,
  getOverdueCandidates,
  getRecruitmentCounts,
  getUnansweredCandidates,
  insertEvents,
  updateCandidateStatus,
  updateCandidatesResponded,
  withTransaction,
  type IstDateTime,
  type LeadStatus,
  type RecruitmentCandidateRow,
  type RecruitmentEventRow,
  type RecruitmentLeadRow,
} from "../models/lc-recruitment.model";
import {
  getBookingSummariesByIds,
  type BookingSummary,
} from "../models/lc-bookings.model";

const toIso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

// The job offers a caregiver has not finished answering, for the
// WhatsApp agent's prompt. Never throws: the agent must still reply.
async function getRecruitmentPromptContext(hp_unique_id: number) {
  try {
    const candidates = await getCandidatesByHpUniqueId(
      hp_unique_id,
      ACTIVE_STATUSES,
    );
    if (candidates.length === 0) return "";

    const offers = candidates.map((c) => ({
      booking_id: Number(c.booking_id),
      status: c.status,
      offered_at: toIso(c.contacted_at),
      note: c.note,
    }));

    return `JOB OFFERS SENT TO THIS PERSON (newest first):
${JSON.stringify(offers)}

If the person's latest message answers one of these job offers, record the answer yourself with 'update_recruitment_status' (cg_id ${hp_unique_id} and that offer's booking_id); this is allowed even though you do not update other data:
- interested in / agrees to take the job -> status 'on_hold'
- declines or is not available -> status 'released', release_reason 'declined'
Add a short note of what they said (conditions, expected pay, joining date).
Record only a clear answer; if it is unclear, ask them. Never tell them they are selected: the care team decides that.
Use 'get_booking_details' when they ask about the job.
`;
  } catch (err) {
    logger.error("[getRecruitmentPromptContext]", err);
    return "";
  }
}

// Called for every WhatsApp message from a caregiver. Their first reply
// to an offer stops it from being marked 'no_response', and a late reply
// moves a 'no_response' offer back to 'contacted'. Never throws.
async function recordCaregiverReply(hp_unique_id: number) {
  try {
    await withTransaction(async (conn) => {
      const unanswered = await getUnansweredCandidates(conn, hp_unique_id);
      const late = unanswered.filter((c) => c.status === "no_response");

      await updateCandidatesResponded(
        conn,
        unanswered.map((c) => c.id),
      );
      await updateCandidateStatus(
        conn,
        late.map((c) => c.id),
        "contacted",
      );
      await insertEvents(
        conn,
        late.map((c) => ({
          candidate_id: c.id,
          from_status: "no_response" as const,
          to_status: "contacted" as const,
          reason: "late_reply",
          note: null,
          source: "system" as const,
        })),
      );
    });
  } catch (err) {
    logger.error(`[recordCaregiverReply] cg ${hp_unique_id}`, err);
  }
}

// Marks contacted caregivers who did not reply in time. Run by the
// scheduler. Never throws.
async function markOverdueNoResponse() {
  try {
    const marked = await withTransaction(async (conn) => {
      const overdue = await getOverdueCandidates(conn);

      await updateCandidateStatus(
        conn,
        overdue.map((c) => c.id),
        "no_response",
      );
      await insertEvents(
        conn,
        overdue.map((c) => ({
          candidate_id: c.id,
          from_status: "contacted" as const,
          to_status: "no_response" as const,
          reason: null,
          note: null,
          source: "system" as const,
        })),
      );
      return overdue.length;
    });

    if (marked > 0) logger.log(`[recruitment] ${marked} caregiver(s) marked no_response`);
  } catch (err) {
    logger.error("[markOverdueNoResponse]", err);
  }
}

// ---------------------------------------------------------------------------
// Recruitment API
// ---------------------------------------------------------------------------

const CANDIDATE_STATUSES = [
  "contacted",
  "on_hold",
  "no_response",
  "placed",
  "released",
] as const;
const LEAD_STATUSES: LeadStatus[] = ["open", "filled", "closed"];

function toBookingView(b: BookingSummary | undefined) {
  if (!b) return null;
  return {
    client_name: b.client_name,
    patient_name: b.patient_name,
    cm_name: b.cm_name,
    booking_status: b.booking_status,
    service_type: b.service_type,
    city: b.city,
    caregiver_gender: b.caregiver_gender,
    shift: b.shift,
    // A calendar date (YYYY-MM-DD), not an instant
    service_start_date: b.service_start_date
      ? new Date(b.service_start_date).toISOString().slice(0, 10)
      : null,
  };
}

// Booking details from the LC database, by booking id. A failure there
// leaves `booking` null instead of failing the request.
async function getBookingsById(booking_ids: number[]) {
  try {
    const bookings = await getBookingSummariesByIds([...new Set(booking_ids)]);
    return new Map(bookings.map((b) => [Number(b.booking_id), b]));
  } catch (err) {
    logger.error("[recruitment api] booking details unavailable", err);
    return new Map<number, BookingSummary>();
  }
}

function toLeadView(lead: RecruitmentLeadRow) {
  return {
    booking_id: Number(lead.booking_id),
    status: lead.status,
    close_reason: lead.close_reason,
    opened_at: toIso(lead.opened_at),
    closed_at: toIso(lead.closed_at),
    last_activity_at: toIso(lead.last_activity_at),
    counts: {
      total: Number(lead.total),
      contacted: Number(lead.contacted),
      on_hold: Number(lead.on_hold),
      no_response: Number(lead.no_response),
      placed: Number(lead.placed),
      released: Number(lead.released),
    },
    placed_caregiver: lead.placed_hp_unique_id
      ? {
          cg_id: Number(lead.placed_hp_unique_id),
          name: lead.placed_caregiver_name,
        }
      : null,
  };
}

function toCandidateView(c: RecruitmentCandidateRow) {
  return {
    cg_id: Number(c.hp_unique_id),
    name: c.caregiver_name,
    phone: c.caregiver_phone,
    status: c.status,
    release_reason: c.release_reason,
    note: c.note,
    contacted_at: toIso(c.contacted_at),
    // Only while a reply is still awaited
    reply_due_at:
      c.status === "contacted" && !c.responded_at
        ? toIso(c.response_due_at)
        : null,
    responded_at: toIso(c.responded_at),
    status_changed_at: toIso(c.status_changed_at),
  };
}

function toEventView(e: RecruitmentEventRow) {
  return {
    from_status: e.from_status,
    to_status: e.to_status,
    reason: e.reason,
    note: e.note,
    source: e.source,
    at: toIso(e.created_at),
  };
}

function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as string[]).includes(value);
}

async function listRecruitmentLeads(filters: {
  status?: LeadStatus;
  booking_id?: number;
  from?: IstDateTime;
  to?: IstDateTime;
  limit: number;
  offset: number;
}) {
  const { rows, total } = await findRecruitmentLeads(filters);
  const bookings = await getBookingsById(rows.map((r) => Number(r.booking_id)));

  return {
    total,
    limit: filters.limit,
    offset: filters.offset,
    leads: rows.map((lead) => ({
      ...toLeadView(lead),
      booking: toBookingView(bookings.get(Number(lead.booking_id))),
    })),
  };
}

// One lead with every caregiver approached for it and each one's status
// history. Null when nobody was ever contacted for the booking.
async function getRecruitmentLead(booking_id: number) {
  const lead = await findRecruitmentLeadByBookingId(booking_id);
  if (!lead) return null;

  const [candidates, bookings] = await Promise.all([
    findCandidatesByLeadId(lead.lead_id),
    getBookingsById([booking_id]),
  ]);
  const events = await findEventsByCandidateIds(candidates.map((c) => c.id));

  return {
    ...toLeadView(lead),
    booking: toBookingView(bookings.get(booking_id)),
    candidates: candidates.map((c) => ({
      ...toCandidateView(c),
      history: events.filter((e) => e.candidate_id === c.id).map(toEventView),
    })),
  };
}

// Every booking a caregiver was approached for, and the one they are on
// hold for, if any.
async function getCaregiverRecruitments({
  hp_unique_id,
  limit,
  offset,
}: {
  hp_unique_id: number;
  limit: number;
  offset: number;
}) {
  const [{ rows, total }, active] = await Promise.all([
    findCandidatesOfCaregiver({ hp_unique_id, limit, offset }),
    getCandidatesByHpUniqueId(hp_unique_id, ["on_hold"]),
  ]);
  const bookings = await getBookingsById(rows.map((r) => Number(r.booking_id)));

  return {
    cg_id: hp_unique_id,
    name: rows[0]?.caregiver_name ?? null,
    phone: rows[0]?.caregiver_phone ?? null,
    on_hold_booking_id: active[0] ? Number(active[0].booking_id) : null,
    total,
    limit,
    offset,
    recruitments: rows.map((c) => {
      const { cg_id, name, phone, ...candidate } = toCandidateView(c);
      return {
        booking_id: Number(c.booking_id),
        lead_status: c.lead_status,
        ...candidate,
        booking: toBookingView(bookings.get(Number(c.booking_id))),
      };
    }),
  };
}

async function getRecruitmentSummary({
  from,
  to,
}: {
  from?: IstDateTime;
  to?: IstDateTime;
}) {
  const { lead_rows, candidate_rows, placement } = await getRecruitmentCounts({
    from,
    to,
  });

  const leads = { total: 0, open: 0, filled: 0, closed: 0 };
  for (const row of lead_rows) {
    if (isLeadStatus(row.status)) leads[row.status as LeadStatus] = Number(row.count);
    leads.total += Number(row.count);
  }

  const caregivers = {
    total: 0,
    responded: 0,
    ...Object.fromEntries(CANDIDATE_STATUSES.map((s) => [s, 0])),
  } as Record<(typeof CANDIDATE_STATUSES)[number] | "total" | "responded", number>;
  for (const row of candidate_rows) {
    if ((CANDIDATE_STATUSES as readonly string[]).includes(row.status)) {
      caregivers[row.status as (typeof CANDIDATE_STATUSES)[number]] = Number(row.count);
    }
    caregivers.total += Number(row.count);
    caregivers.responded += Number(row.responded);
  }

  const avg_minutes = placement.avg_minutes_to_place;
  return {
    leads,
    caregivers,
    placements: {
      count: Number(placement.count),
      avg_hours_to_place:
        avg_minutes == null ? null : Math.round((Number(avg_minutes) / 60) * 10) / 10,
    },
  };
}

export {
  getRecruitmentPromptContext,
  recordCaregiverReply,
  markOverdueNoResponse,
  isLeadStatus,
  listRecruitmentLeads,
  getRecruitmentLead,
  getCaregiverRecruitments,
  getRecruitmentSummary,
};
