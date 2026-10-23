import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

async function getBookingDetailsModel(booking_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT
        nb.id,
        nu.first_name as client_name,
        emp.det_id as cm_id,
        emp.emp_name as cm_name,
        nb.base_rate,
        nb.final_rate,
        nb.base_unit as pay_type,
        nb.original_booking_date as booking_date,
        nb.service_start_date,
        nb.service_end_date,
        nms.webapp_display_name as booking_status,
        JSON_OBJECT(
            "patient_id", np.id,
            "name", np.first_name,
            "languages", np.langs,
        	"gender", np.p_gender,
            "weight", CONCAT(np.weight, ' KG'),
            "conditions", hc.conditions,
            "relation", np.relation
        ) as patient_details,
        JSON_OBJECT(
            "service_type", nsc.service_name,
        	"gender", nsc.cg_gender,
        	"shift", nsc.cg_shift,
            "city", nsc.city_name
        ) as enquired_caregiver
    FROM n_bookings nb
    LEFT JOIN n_user nu ON nu.id = nb.usr_id
    LEFT JOIN (
        SELECT p.*, g.name as p_gender, GROUP_CONCAT(ml.name SEPARATOR ", ") as langs
        FROM n_patient p
        LEFT JOIN n_master_gender g ON g.id = p.gender
        LEFT JOIN n_master_languages ml ON FIND_IN_SET(ml.id, p.languages)
		GROUP BY p.user_id
    ) np ON np.id = nb.patient_id
    LEFT JOIN life_emp_details emp ON emp.det_id = nb.hp_manager
    LEFT JOIN n_master_status nms ON nms.id = nb.status
    LEFT JOIN (
        SELECT nsc.id, nmc.name as city_name, nms.name as service_name, nmg.name as cg_gender, nml.name as cg_shift
        FROM n_service_city nsc
        LEFT JOIN n_master_services nms ON nms.id = nsc.service_id 
        LEFT JOIN n_master_cities nmc ON nmc.id = nsc.city_id
        LEFT JOIN n_master_gender nmg ON nmg.id = nms.hp_gender
        LEFT JOIN n_master_live_type nml on nml.id = nms.live_type
        WHERE nsc.status = 2
    ) nsc ON nsc.id = nb.service_city_id
     LEFT JOIN (
        SELECT GROUP_CONCAT(mh.name SEPARATOR ", ") as conditions, bh.booking_id FROM n_booking_healthcondtions bh
		LEFT JOIN n_master_healthcondtions mh ON mh.id = bh.healthcondtions_id
		GROUP BY booking_id
    ) hc ON hc.booking_id = nb.id
    LEFT JOIN n_master_booking_lost_reasons nbl ON nbl.id = nb.lost_reason  
    WHERE nb.id = ?
    `,
    [booking_id],
  );

  return rows[0];
}

export { getBookingDetailsModel };
