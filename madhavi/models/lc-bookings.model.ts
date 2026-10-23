import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

export interface BookingSummary extends RowDataPacket {
  booking_id: number;
  client_name: string | null;
  patient_name: string | null;
  cm_name: string | null;
  booking_status: string | null;
  service_type: string | null;
  city: string | null;
  caregiver_gender: string | null;
  shift: string | null;
  service_start_date: Date | null;
}

// The booking fields a recruitment screen shows, for many bookings in one
// query. Bookings live in the LC database, on another server than the
// recruitment tables, so they are fetched by id and merged in code.
async function getBookingSummariesByIds(booking_ids: number[]) {
  if (booking_ids.length === 0) return [];

  const [rows] = await lc_pool.query<BookingSummary[]>(
    `
      SELECT
        nb.id AS booking_id,
        nu.first_name AS client_name,
        np.first_name AS patient_name,
        emp.emp_name AS cm_name,
        nms.webapp_display_name AS booking_status,
        svc.name AS service_type,
        city.name AS city,
        g.name AS caregiver_gender,
        lt.name AS shift,
        nb.service_start_date
      FROM n_bookings nb
      LEFT JOIN n_user nu ON nu.id = nb.usr_id
      LEFT JOIN n_patient np ON np.id = nb.patient_id
      LEFT JOIN life_emp_details emp ON emp.det_id = nb.hp_manager
      LEFT JOIN n_master_status nms ON nms.id = nb.status
      LEFT JOIN n_service_city nsc ON nsc.id = nb.service_city_id
      LEFT JOIN n_master_services svc ON svc.id = nsc.service_id
      LEFT JOIN n_master_cities city ON city.id = nsc.city_id
      LEFT JOIN n_master_gender g ON g.id = svc.hp_gender
      LEFT JOIN n_master_live_type lt ON lt.id = svc.live_type
      WHERE nb.id IN (?);
    `,
    [booking_ids],
  );

  return rows;
}

export { getBookingSummariesByIds };
