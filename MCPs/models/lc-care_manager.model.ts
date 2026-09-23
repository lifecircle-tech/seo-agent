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

export { getCaremanagerDetails };
