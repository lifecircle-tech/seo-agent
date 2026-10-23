import { toWhatsappPhone } from "../utils/common";
import { sendMessage } from "./timelines.service";
import { getCaregiverContactModel } from "../models/lc-caregivers.model";
import {
  ACTIVE_STATUSES,
  deleteCandidate,
  getCandidate,
  getCandidatesByBookingId,
  getCandidatesByLeadId,
  getCandidatesForContactCheck,
  getLeadByBookingId,
  getOnHoldCandidate,
  insertCandidate,
  insertEvents,
  lockLeadByBookingId,
  updateCandidateNote,
  updateCandidateStatus,
  updateLeadStatus,
  withTransaction,
  type RecruitmentCandidate,
  type RecruitmentLead,
  type RecruitmentStatus,
  type ReleaseReason,
} from "../models/lc-recruitment.model";

// A contacted caregiver who has not replied by then is marked 'no_response'
// (by the madhavi scheduler).
const REPLY_WINDOW_HOURS = 4;

// Statuses each status can be reached from. 'released' is final, so a
// released caregiver never comes back for the same booking.
const ALLOWED_FROM: Record<"on_hold" | "placed" | "released", RecruitmentStatus[]> = {
  on_hold: ["contacted", "no_response"],
  placed: ["on_hold"],
  released: ["contacted", "on_hold", "no_response", "placed"],
};

type Result<T = {}> =
  | ({ status: "ok"; message: string } & T)
  | { status: "error"; message: string };

const toIso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function toCandidateView(c: RecruitmentCandidate) {
  return {
    booking_id: Number(c.booking_id),
    cg_id: Number(c.hp_unique_id),
    name: c.caregiver_name,
    phone: c.caregiver_phone,
    status: c.status,
    release_reason: c.release_reason,
    note: c.note,
    contacted_at: toIso(c.contacted_at),
    reply_due_at: c.status === "contacted" ? toIso(c.response_due_at) : null,
    responded_at: toIso(c.responded_at),
    status_changed_at: toIso(c.status_changed_at),
  };
}

// Why a caregiver must not be contacted for the booking, or null when they
// can be. `candidates` holds their row for this booking and the booking
// they are on hold for, if any.
function getContactBlock(
  booking_id: number,
  hp_unique_id: number,
  lead: RecruitmentLead | undefined,
  candidates: RecruitmentCandidate[],
) {
  if (lead?.status === "filled") {
    return `Booking ${booking_id} already has a placed caregiver.`;
  }
  if (lead?.status === "closed") {
    return `Recruitment for booking ${booking_id} is closed.`;
  }

  const mine = candidates.filter((c) => Number(c.hp_unique_id) === hp_unique_id);
  const own = mine.find((c) => Number(c.booking_id) === booking_id);
  if (own?.status === "released") {
    return `Released from booking ${booking_id} (${own.release_reason}); never contact them again for this booking.`;
  }
  if (own) {
    return `Already contacted for booking ${booking_id} (status: ${own.status}).`;
  }

  const on_hold = mine.find((c) => c.status === "on_hold");
  if (on_hold) {
    return `On hold for booking ${on_hold.booking_id}; cannot be contacted for another booking until released from it.`;
  }

  return null;
}

async function checkCaregiversForBooking(booking_id: number, cg_ids: number[]) {
  const lead = await getLeadByBookingId(booking_id);
  const candidates = await getCandidatesForContactCheck(booking_id, cg_ids);

  return cg_ids.map((cg_id) => {
    const reason = getContactBlock(booking_id, cg_id, lead, candidates);
    return reason
      ? { cg_id, can_contact: false, reason }
      : { cg_id, can_contact: true };
  });
}

// Sends the job offer and records the caregiver as contacted. The caregiver
// is claimed for the booking before the message goes out, so two runs can
// never message them for the same booking; the claim is undone when the
// message cannot be sent.
async function contactCaregiverForBooking({
  booking_id,
  hp_unique_id,
  message,
}: {
  booking_id: number;
  hp_unique_id: number;
  message: string;
}): Promise<
  Result<{ phone: string; chat_id?: string; message_id?: string }>
> {
  const caregiver = await getCaregiverContactModel(hp_unique_id);
  if (!caregiver?.phone_number) {
    return {
      status: "error",
      message: `No phone number found for cg_id ${hp_unique_id}. Not contacted.`,
    };
  }
  const phone = toWhatsappPhone(caregiver.phone_number);

  const claim = await withTransaction(async (conn) => {
    const lead = await lockLeadByBookingId(conn, booking_id, { create: true });
    const candidates = [
      await getCandidate(booking_id, hp_unique_id, conn),
      await getOnHoldCandidate(hp_unique_id, conn),
    ].filter((c): c is RecruitmentCandidate => !!c);

    const block = getContactBlock(booking_id, hp_unique_id, lead, candidates);
    if (block) return { block };

    const candidate_id = await insertCandidate(conn, {
      lead_id: lead.id,
      hp_unique_id,
      caregiver_name: caregiver.fullname,
      caregiver_phone: phone,
      reply_window_hours: REPLY_WINDOW_HOURS,
    });
    await insertEvents(conn, [
      {
        candidate_id,
        from_status: null,
        to_status: "contacted",
        reason: null,
        note: null,
        source: "agent",
      },
    ]);
    return { candidate_id };
  });

  if ("block" in claim) {
    return { status: "error", message: `${claim.block} Not contacted.` };
  }

  let sent: Awaited<ReturnType<typeof sendMessage>>;
  try {
    sent = await sendMessage(phone, message);
  } catch (err: any) {
    sent = { status: "error", message: err.message };
  }

  if (sent.status !== "ok") {
    await deleteCandidate(claim.candidate_id);
    return {
      status: "error",
      message: `Message not sent: ${sent.message ?? "unknown error"}. Not recorded as contacted.`,
    };
  }

  return {
    status: "ok",
    message: `Message sent to ${caregiver.fullname ?? `cg_id ${hp_unique_id}`}; recorded as contacted for booking ${booking_id}. Marked no_response if they do not reply within ${REPLY_WINDOW_HOURS} hours.`,
    phone,
    chat_id:
      "chat_id" in sent && sent.chat_id != null ? String(sent.chat_id) : undefined,
    message_id:
      "message_id" in sent && sent.message_id != null
        ? String(sent.message_id)
        : undefined,
  };
}

// Messages a caregiver already approached for the booking (selection
// confirmation, case filled, follow-up), whatever their status. Does not
// change their status. First offers go through contactCaregiverForBooking.
async function messageBookingCaregiver({
  booking_id,
  hp_unique_id,
  message,
}: {
  booking_id: number;
  hp_unique_id: number;
  message: string;
}): Promise<
  Result<{ phone: string; chat_id?: string; message_id?: string }>
> {
  const candidate = await getCandidate(booking_id, hp_unique_id);
  if (!candidate) {
    return {
      status: "error",
      message: `cg_id ${hp_unique_id} was never contacted for booking ${booking_id}; send a first offer with 'contact_caregiver_for_booking'. Not sent.`,
    };
  }

  const contact = candidate.caregiver_phone
    ? null
    : await getCaregiverContactModel(hp_unique_id);
  const raw_phone = candidate.caregiver_phone ?? contact?.phone_number;
  if (!raw_phone) {
    return {
      status: "error",
      message: `No phone number found for cg_id ${hp_unique_id}. Not sent.`,
    };
  }
  const phone = toWhatsappPhone(raw_phone);

  const sent = await sendMessage(phone, message);
  if (sent.status !== "ok") {
    return {
      status: "error",
      message: `Message not sent: ${sent.message ?? "unknown error"}.`,
    };
  }

  return {
    status: "ok",
    message: `Message sent to ${candidate.caregiver_name ?? `cg_id ${hp_unique_id}`} (${candidate.status} for booking ${booking_id}).`,
    phone,
    chat_id:
      "chat_id" in sent && sent.chat_id != null ? String(sent.chat_id) : undefined,
    message_id:
      "message_id" in sent && sent.message_id != null
        ? String(sent.message_id)
        : undefined,
  };
}

// Records a caregiver's answer or an employee's decision: 'on_hold' when
// they are interested, 'released' when they decline or are rejected.
async function updateRecruitmentStatus({
  booking_id,
  hp_unique_id,
  status,
  release_reason,
  note,
}: {
  booking_id: number;
  hp_unique_id: number;
  status: "on_hold" | "released";
  release_reason?: ReleaseReason;
  note?: string;
}): Promise<Result> {
  if (status === "released" && !release_reason) {
    return {
      status: "error",
      message: "release_reason is required to release a caregiver.",
    };
  }

  return withTransaction(async (conn): Promise<Result> => {
    const lead = await lockLeadByBookingId(conn, booking_id, { create: false });
    const candidate =
      lead &&
      (await getCandidate(booking_id, hp_unique_id, conn, { lock: true }));
    if (!candidate) {
      return {
        status: "error",
        message: `cg_id ${hp_unique_id} was never contacted for booking ${booking_id}.`,
      };
    }

    if (candidate.status === status) {
      if (note) await updateCandidateNote(conn, candidate.id, note);
      return {
        status: "ok",
        message: `cg_id ${hp_unique_id} is already ${status} for booking ${booking_id}.`,
      };
    }

    if (!ALLOWED_FROM[status].includes(candidate.status)) {
      return {
        status: "error",
        message: `cg_id ${hp_unique_id} is ${candidate.status} for booking ${booking_id} and cannot become ${status}.`,
      };
    }

    if (status === "on_hold") {
      const on_hold = await getOnHoldCandidate(hp_unique_id, conn);
      if (on_hold) {
        return {
          status: "error",
          message: `cg_id ${hp_unique_id} is already on hold for booking ${on_hold.booking_id}. A caregiver can be on hold for one booking at a time; release them from booking ${on_hold.booking_id} first.`,
        };
      }
    }

    await updateCandidateStatus(conn, [candidate.id], {
      status,
      release_reason: status === "released" ? release_reason : null,
      note,
    });
    await insertEvents(conn, [
      {
        candidate_id: candidate.id,
        from_status: candidate.status,
        to_status: status,
        reason: status === "released" ? release_reason! : null,
        note: note ?? null,
        source: "agent",
      },
    ]);

    // The booking lost its caregiver: recruitment for it is open again
    if (candidate.status === "placed") {
      await updateLeadStatus(conn, lead.id, "open");
    }

    return {
      status: "ok",
      message: `cg_id ${hp_unique_id} is now ${status} for booking ${booking_id}.`,
    };
  });
}

// Places a caregiver who is on hold, and releases every other caregiver
// still in the running for the booking, so they are free for other leads.
async function placeCaregiverForBooking({
  booking_id,
  hp_unique_id,
  note,
}: {
  booking_id: number;
  hp_unique_id: number;
  note?: string;
}) {
  type Released = { cg_id: number; name: string | null; previous_status: string };

  return withTransaction(async (conn): Promise<Result<{ released: Released[] }>> => {
    const lead = await lockLeadByBookingId(conn, booking_id, { create: false });
    if (!lead) {
      return {
        status: "error",
        message: `No caregiver was contacted for booking ${booking_id}.`,
      };
    }
    if (lead.status === "filled") {
      const [placed] = await getCandidatesByLeadId(conn, lead.id, ["placed"]);
      return {
        status: "error",
        message: `Booking ${booking_id} already has a placed caregiver (cg_id ${placed?.hp_unique_id}). Release them first with release_reason 'left_booking'.`,
      };
    }
    if (lead.status === "closed") {
      return {
        status: "error",
        message: `Recruitment for booking ${booking_id} is closed.`,
      };
    }

    const candidate = await getCandidate(booking_id, hp_unique_id, conn, {
      lock: true,
    });
    if (candidate?.status !== "on_hold") {
      return {
        status: "error",
        message: candidate
          ? `Only an interested caregiver (on_hold) can be placed; cg_id ${hp_unique_id} is ${candidate.status}.`
          : `cg_id ${hp_unique_id} was never contacted for booking ${booking_id}.`,
      };
    }

    const others = (
      await getCandidatesByLeadId(conn, lead.id, ACTIVE_STATUSES)
    ).filter((c) => c.id !== candidate.id);

    await updateCandidateStatus(conn, [candidate.id], { status: "placed", note });
    await updateCandidateStatus(
      conn,
      others.map((c) => c.id),
      { status: "released", release_reason: "recruitment_completed" },
    );
    await insertEvents(conn, [
      {
        candidate_id: candidate.id,
        from_status: "on_hold",
        to_status: "placed",
        reason: null,
        note: note ?? null,
        source: "agent",
      },
      ...others.map((c) => ({
        candidate_id: c.id,
        from_status: c.status,
        to_status: "released" as const,
        reason: "recruitment_completed",
        note: null,
        source: "system" as const,
      })),
    ]);
    await updateLeadStatus(conn, lead.id, "filled");

    return {
      status: "ok",
      message: `cg_id ${hp_unique_id} placed for booking ${booking_id}. ${others.length} other caregiver(s) released; they have not been messaged.`,
      released: others.map((c) => ({
        cg_id: Number(c.hp_unique_id),
        name: c.caregiver_name,
        previous_status: c.status,
      })),
    };
  });
}

// Stops recruitment for a booking (cancelled, lost, filled elsewhere) and
// releases everyone on it, including a placed caregiver.
async function closeBookingRecruitment({
  booking_id,
  reason,
}: {
  booking_id: number;
  reason: string;
}) {
  return withTransaction(async (conn): Promise<Result<{ released: number }>> => {
    const lead = await lockLeadByBookingId(conn, booking_id, { create: true });
    if (lead.status === "closed") {
      return {
        status: "ok",
        message: `Recruitment for booking ${booking_id} was already closed.`,
        released: 0,
      };
    }

    const active = await getCandidatesByLeadId(conn, lead.id, [
      ...ACTIVE_STATUSES,
      "placed",
    ]);
    await updateCandidateStatus(
      conn,
      active.map((c) => c.id),
      { status: "released", release_reason: "booking_closed" },
    );
    await insertEvents(
      conn,
      active.map((c) => ({
        candidate_id: c.id,
        from_status: c.status,
        to_status: "released" as const,
        reason: "booking_closed",
        note: reason,
        source: "system" as const,
      })),
    );
    await updateLeadStatus(conn, lead.id, "closed", reason);

    return {
      status: "ok",
      message: `Recruitment for booking ${booking_id} closed; ${active.length} caregiver(s) released. They have not been messaged.`,
      released: active.length,
    };
  });
}

async function getBookingRecruitment(booking_id: number) {
  const lead = await getLeadByBookingId(booking_id);
  if (!lead) {
    return {
      booking_id,
      recruitment_status: null,
      counts: {},
      candidates: [],
    };
  }

  const candidates = await getCandidatesByBookingId(booking_id);
  const counts: Record<string, number> = {};
  for (const c of candidates) counts[c.status] = (counts[c.status] ?? 0) + 1;

  return {
    booking_id,
    recruitment_status: lead.status,
    close_reason: lead.close_reason,
    opened_at: toIso(lead.opened_at),
    counts,
    candidates: candidates.map(toCandidateView),
  };
}

export {
  checkCaregiversForBooking,
  contactCaregiverForBooking,
  messageBookingCaregiver,
  updateRecruitmentStatus,
  placeCaregiverForBooking,
  closeBookingRecruitment,
  getBookingRecruitment,
};
