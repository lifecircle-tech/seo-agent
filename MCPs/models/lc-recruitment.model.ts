import type {
  Connection,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { madhavi_pool } from "../../db";

export type LeadStatus = "open" | "filled" | "closed";
export type RecruitmentStatus =
  | "contacted"
  | "on_hold"
  | "no_response"
  | "placed"
  | "released";
export type ReleaseReason =
  | "declined"
  | "not_selected"
  | "left_booking"
  | "recruitment_completed"
  | "booking_closed";
export type RecruitmentEventSource = "agent" | "system";

// Caregivers still in the running for a booking.
export const ACTIVE_STATUSES: RecruitmentStatus[] = [
  "contacted",
  "on_hold",
  "no_response",
];

export interface RecruitmentLead extends RowDataPacket {
  id: number;
  booking_id: number;
  status: LeadStatus;
  close_reason: string | null;
  opened_at: Date;
  closed_at: Date | null;
}

export interface RecruitmentCandidate extends RowDataPacket {
  id: number;
  lead_id: number;
  booking_id: number;
  hp_unique_id: number;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  status: RecruitmentStatus;
  release_reason: ReleaseReason | null;
  note: string | null;
  contacted_at: Date;
  response_due_at: Date;
  responded_at: Date | null;
  status_changed_at: Date;
}

export type RecruitmentEvent = {
  candidate_id: number;
  from_status: RecruitmentStatus | null;
  to_status: RecruitmentStatus;
  reason: string | null;
  note: string | null;
  source: RecruitmentEventSource;
};

const CANDIDATE_SELECT = `
  SELECT
    c.id, c.lead_id, l.booking_id, c.hp_unique_id, c.caregiver_name,
    c.caregiver_phone, c.status, c.release_reason, c.note, c.contacted_at,
    c.response_due_at, c.responded_at, c.status_changed_at
  FROM life_digital_recruitment_candidate c
  JOIN life_digital_recruitment_lead l ON l.id = c.lead_id
`;

async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>) {
  const conn = await madhavi_pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getLeadByBookingId(
  booking_id: number,
  db: Connection = madhavi_pool,
) {
  const [rows] = await db.query<RecruitmentLead[]>(
    `SELECT * FROM life_digital_recruitment_lead WHERE booking_id = ?;`,
    [booking_id],
  );

  return rows[0];
}

// Locks the booking's lead for the rest of the transaction, so changes to
// one booking's candidates are serialised. Creates the lead when asked.
async function lockLeadByBookingId(
  conn: Connection,
  booking_id: number,
  { create }: { create: boolean },
) {
  if (create) {
    await conn.query<ResultSetHeader>(
      `INSERT IGNORE INTO life_digital_recruitment_lead (booking_id) VALUES (?);`,
      [booking_id],
    );
  }

  const [rows] = await conn.query<RecruitmentLead[]>(
    `SELECT * FROM life_digital_recruitment_lead WHERE booking_id = ? FOR UPDATE;`,
    [booking_id],
  );

  return rows[0];
}

async function updateLeadStatus(
  conn: Connection,
  lead_id: number,
  status: LeadStatus,
  close_reason: string | null = null,
) {
  await conn.query<ResultSetHeader>(
    `
      UPDATE life_digital_recruitment_lead
      SET status = ?,
        close_reason = ?,
        closed_at = IF(? = 'open', NULL, CURRENT_TIMESTAMP)
      WHERE id = ?;
    `,
    [status, close_reason, status, lead_id],
  );
}

async function getCandidate(
  booking_id: number,
  hp_unique_id: number,
  db: Connection = madhavi_pool,
  { lock = false }: { lock?: boolean } = {},
) {
  const [rows] = await db.query<RecruitmentCandidate[]>(
    `${CANDIDATE_SELECT} WHERE l.booking_id = ? AND c.hp_unique_id = ?
      ${lock ? "FOR UPDATE" : ""};`,
    [booking_id, hp_unique_id],
  );

  return rows[0];
}

async function getCandidatesByBookingId(booking_id: number) {
  const [rows] = await madhavi_pool.query<RecruitmentCandidate[]>(
    `${CANDIDATE_SELECT} WHERE l.booking_id = ? ORDER BY c.contacted_at ASC;`,
    [booking_id],
  );

  return rows;
}

async function getCandidatesByLeadId(
  conn: Connection,
  lead_id: number,
  statuses: RecruitmentStatus[],
) {
  const [rows] = await conn.query<RecruitmentCandidate[]>(
    `${CANDIDATE_SELECT} WHERE c.lead_id = ? AND c.status IN (?) FOR UPDATE;`,
    [lead_id, statuses],
  );

  return rows;
}

// The booking a caregiver is on hold for, if any.
async function getOnHoldCandidate(
  hp_unique_id: number,
  db: Connection = madhavi_pool,
) {
  const [rows] = await db.query<RecruitmentCandidate[]>(
    `${CANDIDATE_SELECT} WHERE c.on_hold_hp_unique_id = ?;`,
    [hp_unique_id],
  );

  return rows[0];
}

// Everything that decides whether these caregivers can be contacted for
// the booking: their row for it, and any booking they are on hold for.
async function getCandidatesForContactCheck(
  booking_id: number,
  hp_unique_ids: number[],
) {
  if (hp_unique_ids.length === 0) return [];

  const [rows] = await madhavi_pool.query<RecruitmentCandidate[]>(
    `${CANDIDATE_SELECT}
      WHERE c.hp_unique_id IN (?)
        AND (l.booking_id = ? OR c.status = 'on_hold');`,
    [hp_unique_ids, booking_id],
  );

  return rows;
}

async function insertCandidate(
  conn: Connection,
  {
    lead_id,
    hp_unique_id,
    caregiver_name,
    caregiver_phone,
    reply_window_hours,
  }: {
    lead_id: number;
    hp_unique_id: number;
    caregiver_name: string | null;
    caregiver_phone: string | null;
    reply_window_hours: number;
  },
) {
  const [result] = await conn.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_recruitment_candidate
        (lead_id, hp_unique_id, caregiver_name, caregiver_phone, response_due_at)
      VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR));
    `,
    [lead_id, hp_unique_id, caregiver_name, caregiver_phone, reply_window_hours],
  );

  return result.insertId;
}

async function deleteCandidate(id: number) {
  await madhavi_pool.query<ResultSetHeader>(
    `DELETE FROM life_digital_recruitment_candidate WHERE id = ?;`,
    [id],
  );
}

// A new note replaces the old one; no note keeps it.
async function updateCandidateStatus(
  conn: Connection,
  ids: number[],
  {
    status,
    release_reason = null,
    note = null,
  }: {
    status: RecruitmentStatus;
    release_reason?: ReleaseReason | null;
    note?: string | null;
  },
) {
  if (ids.length === 0) return;

  await conn.query<ResultSetHeader>(
    `
      UPDATE life_digital_recruitment_candidate
      SET status = ?,
        release_reason = ?,
        note = COALESCE(?, note),
        status_changed_at = CURRENT_TIMESTAMP
      WHERE id IN (?);
    `,
    [status, release_reason, note, ids],
  );
}

async function updateCandidateNote(conn: Connection, id: number, note: string) {
  await conn.query<ResultSetHeader>(
    `UPDATE life_digital_recruitment_candidate SET note = ? WHERE id = ?;`,
    [note, id],
  );
}

async function insertEvents(conn: Connection, events: RecruitmentEvent[]) {
  if (events.length === 0) return;

  await conn.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_recruitment_event
        (candidate_id, from_status, to_status, reason, note, source)
      VALUES ?;
    `,
    [
      events.map((e) => [
        e.candidate_id,
        e.from_status,
        e.to_status,
        e.reason,
        e.note,
        e.source,
      ]),
    ],
  );
}

export {
  withTransaction,
  getLeadByBookingId,
  lockLeadByBookingId,
  updateLeadStatus,
  getCandidate,
  getCandidatesByBookingId,
  getCandidatesByLeadId,
  getOnHoldCandidate,
  getCandidatesForContactCheck,
  insertCandidate,
  deleteCandidate,
  updateCandidateStatus,
  updateCandidateNote,
  insertEvents,
};
