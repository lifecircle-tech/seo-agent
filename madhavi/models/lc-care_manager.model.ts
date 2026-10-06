import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

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

export { isLCEmployeePhoneNumber };
