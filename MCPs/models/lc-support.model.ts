import { ResultSetHeader, RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

interface CreateSupportTicket {
  support_id: number;
  user_id: number;
  request_param1?: any;
  request_param2?: any;
  title: string;
  description: string;
}

async function getSupportTypeModel(app_type: string = "hpapp") {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT * FROM n_support_type WHERE app_type = ? AND status = 2
    `,
    [app_type],
  );

  const support_types = rows;
  return support_types;
}

async function createSupportTicketModel(data: CreateSupportTicket) {
  const [result] = await lc_pool.query<ResultSetHeader>(
    `
    INSERT INTO n_support_requests(
      user_id, support_type_id, request_param1, request_param2,
      title, description, created_by_employee, created_on, updated_on, created_by, updated_by
    ) VALUES
    (?, ?, ?, ?, ?, ?, 0, NOW(), NOW(), ?, ?)
    `,
    [
      data.user_id,
      data.support_id,
      data.request_param1,
      data.request_param2,
      data.title,
      data.description,
      data.user_id,
      data.user_id,
    ],
  );

  return result.insertId;
}

export { getSupportTypeModel, createSupportTicketModel };
