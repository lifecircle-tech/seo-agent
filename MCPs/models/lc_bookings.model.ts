import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

async function getBookingDetailsModel(booking_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT
        nb.id,
        np.first_name as patient_name,
        nu.first_name as client_name,
        emp.det_id as cm_id,
        emp.emp_name as cm_name,
        nb.base_rate as offered_rate,
        nb.final_rate as final_rate,
        nb.base_unit as pay_type,
        nb.original_booking_date as booking_date,
        nb.service_start_date,
        nb.service_end_date,
        nms.webapp_display_name as booking_status,
        nsc.city_name as service_city,
        nsc.service_name as service_type,
        nbl.lost_reason
    FROM n_bookings nb
    LEFT JOIN n_user nu ON nu.id = nb.usr_id
    LEFT JOIN n_patient np ON np.id = nb.patient_id
    LEFT JOIN life_emp_details emp ON emp.det_id = nb.hp_manager
    LEFT JOIN n_master_status nms ON nms.id = nb.status
    LEFT JOIN (
        SELECT nsc.id, nmc.name as city_name, nms.name as service_name
        FROM n_service_city nsc
        LEFT JOIN n_master_services nms ON nms.id = nsc.service_id 
        LEFT JOIN n_master_cities nmc ON nmc.id = nsc.city_id
        WHERE nsc.status = 2
    ) nsc ON nsc.id = nb.service_city_id
    LEFT JOIN n_master_booking_lost_reasons nbl ON nbl.id = nb.lost_reason  
    WHERE nb.id = ?
    `,
    [booking_id],
  );

  return rows[0];
}

export { getBookingDetailsModel };
