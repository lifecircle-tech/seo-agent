import { RowDataPacket } from "mysql2";
import pulsePool from "../../db-pulse";

async function getClientsDetails(client_id: number) {
  const [rows] = await pulsePool.query<RowDataPacket[]>(
    `
    SELECT cl.clnt_id, cl.clnt_name, cl.pat_name,
    FROM life_client cl
    WHERE cl.clnt_id = ?
    `,
    [client_id],
  );

  const client = rows[0];

  return client;
}

async function getPatientDetailById(patient_id: number) {
  const [rows] = await pulsePool.query<RowDataPacket[]>(
    `
    SELECT
      p.first_name,
      p.yob,
      p.relation,
      g.name as gender,
      GROUP_CONCAT(hc.condition_name SEPARATOR ', ') as health_conditions
    FROM n_patient p
    LEFT JOIN n_master_gender g ON g.id = p.gender
    LEFT JOIN n_bookings b ON b.patient_id = p.id
    LEFT JOIN n_booking_hp bh ON bh.bkng_id = b.id
    LEFT JOIN (SELECT bhc.booking_id, mhc.name AS condition_name
      FROM n_booking_healthcondtions bhc
      JOIN n_master_healthcondtions mhc ON bhc.healthcondtions_id = mhc.id
    ) as hc ON hc.booking_id = bh.bkng_id
    WHERE p.id = ? AND bh.status = 120;
    `,
    [patient_id],
  );

  const patient = rows[0];

  return patient;
}

export { getClientsDetails, getPatientDetailById };
