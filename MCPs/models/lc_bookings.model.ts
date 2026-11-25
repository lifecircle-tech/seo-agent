import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

// Lead-stage booking: what is known before a caregiver is found. The end
// date is not known until a placement is agreed, so it is not read here.
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
        nb.service_start_time,
        nb.service_end_time,
        nb.spl_care_requirements,
        nb.patient_conditions_others,
        ua.locality as client_locality,
        ua.pincode as client_pincode,
        nms.webapp_display_name as booking_status,
        JSON_OBJECT(
            "patient_id", np.id,
            "name", np.first_name,
            -- age is sometimes entered as the year of birth (e.g. 1962)
            "age", CASE
                WHEN np.age BETWEEN 1 AND 110 THEN np.age
                WHEN np.yob > 0 THEN YEAR(CURDATE()) - np.yob
                WHEN np.age BETWEEN 1900 AND YEAR(CURDATE()) THEN YEAR(CURDATE()) - np.age
            END,
            "languages", (
                SELECT GROUP_CONCAT(ml.name SEPARATOR ", ")
                FROM n_master_languages ml
                WHERE FIND_IN_SET(ml.id, np.languages)
            ),
            "gender", pg.name,
            "weight", CONCAT(NULLIF(np.weight, '0'), ' KG'),
            "conditions", (
                SELECT GROUP_CONCAT(mh.name SEPARATOR ", ")
                FROM n_booking_healthcondtions bh
                LEFT JOIN n_master_healthcondtions mh ON mh.id = bh.healthcondtions_id
                WHERE bh.booking_id = nb.id
            ),
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
    -- The booking's own patient (a client can have several)
    LEFT JOIN n_patient np ON np.id = nb.patient_id
    LEFT JOIN n_master_gender pg ON pg.id = np.gender
    LEFT JOIN n_user_address ua ON ua.id = nb.address_id
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
    WHERE nb.id = ?
    `,
    [booking_id],
  );

  return rows[0];
}

export { getBookingDetailsModel };
