import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

async function getCaremanagerDetails(cm_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT cm.det_id, cm.emp_name, cm.det_mobile
    FROM life_emp_details cm
    WHERE cm.det_id = ?
    `,
    [cm_id],
  );

  const caremanager = rows[0];

  return caremanager;
}

async function isLCEmployeePhoneNumber(phone: string) {
  let ph_number = phone;
  if (phone.length > 10) {
    ph_number = phone.slice(-10);
  }

  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT 1 FROM life_emp_details WHERE det_mobile REGEXP ?;`,
    [ph_number],
  );

  const record = rows[0];

  return !!record;
}

export { getCaremanagerDetails, isLCEmployeePhoneNumber };
