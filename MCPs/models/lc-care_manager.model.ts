import { RowDataPacket } from "mysql2";
import pulsePool from "../../db-pulse";

async function getCaremanagerDetails(cm_id: number) {
  const [rows] = await pulsePool.query<RowDataPacket[]>(
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
