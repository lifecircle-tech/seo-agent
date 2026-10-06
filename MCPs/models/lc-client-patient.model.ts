import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

async function getClientsDetailsModel(client_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT cl.clnt_id, cl.clnt_name, cl.pat_name,
    FROM life_client cl
    WHERE cl.clnt_id = ?
    `,
    [client_id],
  );

  return rows[0];
}

async function getPatientDetailByIdModel(patient_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
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

  return rows[0];
}

async function getPatientCarePlansModel(patient_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT ncp.* FROM n_care_plan ncp
    WHERE ncp.patient_id = ? AND ncp.status = 1
    ORDER BY ncp.version_no DESC
    LIMIT 1
    `,
    [patient_id],
  );

  return rows[0];
}

async function getPatientCareScheduleModel(patient_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT base.frequency, act.activity_name, act.how_to, cat.cat_name AS category_name
    FROM n_care_plan_schedule_base base
    INNER JOIN n_care_plan_activity AS act ON base.activity_id = act.id
    INNER JOIN n_care_plan_activity_category AS cat ON act.category_id = cat.id
    WHERE base.care_plan_id = (
        SELECT ncp.id FROM n_care_plan ncp
        WHERE ncp.patient_id = ? AND ncp.status = 1
        ORDER BY ncp.version_no DESC
        LIMIT 1
      )
      AND base.status = 1 AND base.activity_id > 0

    `,
    [patient_id],
  );

  return rows;
}

async function getPatientMedicinesModel(care_plan_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT
      m.med_name,
      base.medicine_dose as dose,
      base.frequency,
      base.medicine_instruction as instruction
    FROM n_care_plan_schedule_base AS base
    LEFT JOIN n_medicine m ON m.id = base.medicine_id
    WHERE base.care_plan_id = ? AND base.status = 1 AND base.activity_id = 0
    ORDER BY base.id ASC
  `,
    [care_plan_id],
  );
  return rows;
}

export {
  getClientsDetailsModel,
  getPatientDetailByIdModel,
  getPatientCarePlansModel,
  getPatientCareScheduleModel,
  getPatientMedicinesModel,
};
