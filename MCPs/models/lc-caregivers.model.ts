import { RowDataPacket } from "mysql2";
import pulsePool from "../../db-pulse";

async function getCaregiversWithActiveBooking({
  limit = 50,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
}) {
  const [rows] = await pulsePool.query<RowDataPacket[]>(
    `
    SELECT cg.hp_unique_id, cg.fullname, cg.phone_number
    FROM n_hp_profile cg
    LEFT JOIN n_booking_hp bh ON bh.hp_unique_id = cg.hp_unique_id
    WHERE bh.status = 120
    ORDER BY bh.created_on DESC
    LIMIT ? OFFSET ?;
    `,
    [limit, offset],
  );

  const caregivers = rows;

  return caregivers;
}

// Get Caregiver details for Caregiver with
async function getCaregiverDetails(cg_id: number) {
  const [rows] = await pulsePool.query<RowDataPacket[]>(
    `
    SELECT
      cg.hp_unique_id,
      cg.fullname,
      cg.phone_number,
      cg.dob,
      g.gen_name as gender,
      bh.bkng_id as booking_id,
      cg_languages.languages AS languages
    FROM n_hp_profile cg
    LEFT JOIN life_gender g ON g.gen_id = cg.gender
    LEFT JOIN n_booking_hp bh ON bh.hp_unique_id = cg.hp_unique_id
    LEFT JOIN (
      SELECT
        cg_lang.hp_unique_id, GROUP_CONCAT(master_lang.name SEPARATOR ', ') AS languages
      FROM n_hp_language cg_lang
      JOIN n_master_languages master_lang ON master_lang.id = cg_lang.lang_id
      WHERE cg_lang.status = (SELECT id FROM n_master_status WHERE code='o_2')
      GROUP BY cg_lang.hp_unique_id
    ) AS cg_languages ON cg_languages.hp_unique_id = cg.hp_unique_id
    WHERE cg.hp_unique_id = ? AND bh.status = 120;
    `,
    [cg_id],
  );

  const caregiver = rows[0];

  return caregiver;
}

async function getCaregiverActiveBookingDetails(cg_id: number) {
  const [rows] = await pulsePool.query<RowDataPacket[]>(
    `
    SELECT b.id, cl.clnt_name, cl.pat_name, p.first_name, e.emp_name, b.patient_id, b.old_client_id, b.hp_manager
    FROM n_bookings b
    LEFT JOIN n_booking_hp bh ON bh.bkng_id = b.id
    LEFT JOIN life_client cl ON cl.clnt_id = b.old_client_id
    LEFT JOIN n_patient p ON p.id = b.patient_id
    LEFT JOIN life_emp_details e ON e.det_id = b.hp_manager
    WHERE bh.status = 120 AND bh.hp_unique_id = ?;
    `,
    [cg_id],
  );

  const caregiver_booking = rows[0];

  return caregiver_booking;
}

async function isCaregiverPhoneNumber(phone: string) {
  let ph_number = phone;
  if (phone.length > 10) {
    ph_number = phone.slice(-10);
  }

  const [rows] = await pulsePool.query<RowDataPacket[]>(
    `SELECT 1 FROM n_hp_profile WHERE phone_number REGEXP ?;`,
    [ph_number],
  );

  const record = rows[0];

  return !!record;
}

export {
  getCaregiversWithActiveBooking,
  getCaregiverDetails,
  getCaregiverActiveBookingDetails,
  isCaregiverPhoneNumber,
};
