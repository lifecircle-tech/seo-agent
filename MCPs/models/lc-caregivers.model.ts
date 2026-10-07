import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

async function isCaregiverPhoneNumberModel(phone: string) {
  let ph_number = phone;
  if (phone.length > 10) {
    ph_number = phone.slice(-10);
  }

  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT 1 FROM n_hp_profile WHERE phone_number REGEXP ?;`,
    [ph_number],
  );

  const record = rows[0];

  return !!record;
}

async function getCaregiversWithActiveBookingModel({
  limit = 50,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
}) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT cg.hp_unique_id, cg.fullname, cg.phone_number
    FROM n_hp_profile cg
    LEFT JOIN n_booking_hp bh ON bh.hp_unique_id = cg.hp_unique_id
    WHERE bh.status = 120
    ORDER BY bh.created_on DESC
    LIMIT ? OFFSET ?;
    `,
    [limit, offset],
  );

  return rows;
}

// Get Caregiver details for Caregiver with
async function getCaregiverDetailsModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT
      cg.hp_unique_id,
      cg.fullname,
      cg.phone_number,
      cg.dob,
      g.gen_name as gender,
      bh.bkng_id as booking_id,
      cg_languages.languages AS languages
    FROM n_hp_profile cg
    LEFT JOIN life_gender g ON g.gen_id = cg.gender
    LEFT JOIN n_booking_hp bh ON bh.hp_unique_id = cg.hp_unique_id
    LEFT JOIN (
      SELECT
        cg_lang.hp_unique_id, GROUP_CONCAT(master_lang.name SEPARATOR ', ') AS languages
      FROM n_hp_language cg_lang
      JOIN n_master_languages master_lang ON master_lang.id = cg_lang.lang_id
      WHERE cg_lang.status = (SELECT id FROM n_master_status WHERE code='o_2')
      GROUP BY cg_lang.hp_unique_id
    ) AS cg_languages ON cg_languages.hp_unique_id = cg.hp_unique_id
    WHERE cg.hp_unique_id = ? AND bh.status = 120;
    `,
    [cg_id],
  );

  return rows[0];
}

async function getCaregiverProfileDetailsModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT
      hp.hp_unique_id,
      nu.id as user_id,
      hp.fullname as name,
      hp.photo as profile_pic,
      ms.code, 
      ms.webapp_display_name as onboarding_status, 
      mg.name as gender,
      hp.dob,
      hp.aadhaar as aadhaar_no,
      hl.languages, 
      hp.house_c as currentAddress,
      hp.street_c as street,
      hp.area_c as area,
      hp.city_c as city,
      hp.district_c as district,
      hp.state_c as state,
      hp.country_c as country,
      hp.pincode_c as pincode,
      lm.mar_name as marital_status,
      hp.experience,
      ref.count as \`references\`,
      shift.count as shift_preferences,
      q.count as qualifications,
      loc.count as locations,
      hp.registered_on,
      hp.created_on
    FROM n_hp_profile hp
    LEFT JOIN n_user nu ON nu.hp_unique_id = hp.hp_unique_id
    LEFT JOIN n_master_status ms ON ms.id = hp.status
    LEFT JOIN n_master_gender mg ON mg.id = hp.gender
    LEFT JOIN (
      SELECT
        hp_lang.hp_unique_id, GROUP_CONCAT(master_lang.name SEPARATOR ', ') AS languages
      FROM n_hp_language hp_lang
      JOIN n_master_languages master_lang ON master_lang.id = hp_lang.lang_id
      WHERE hp_lang.status = (SELECT id FROM n_master_status WHERE code='o_2')
      GROUP BY hp_lang.hp_unique_id
    ) AS hl ON hl.hp_unique_id = hp.hp_unique_id
    LEFT JOIN life_marital lm ON lm.mar_id = hp.marital_status
    LEFT JOIN (
    	SELECT hpref.hp_unique_id, COUNT(*) as count FROM n_hp_references hpref
      WHERE hpref.status = 2
      GROUP BY hpref.hp_unique_id
	  ) ref ON ref.hp_unique_id = hp.hp_unique_id
    LEFT JOIN (
    	SELECT hpshift.hp_unique_id, COUNT(*) as count FROM n_hp_shift_preference hpshift
      WHERE hpshift.status = 2
      GROUP BY hpshift.hp_unique_id
	  ) shift ON shift.hp_unique_id = hp.hp_unique_id
    LEFT JOIN (
    	SELECT hpq.hp_unique_id, COUNT(*) as count from n_hp_qualifications hpq
      WHERE hpq.status = 2
      GROUP BY hpq.hp_unique_id
	  ) q ON q.hp_unique_id = hp.hp_unique_id
    LEFT JOIN (
    	SELECT hpl.hp_unique_id, COUNT(*) as count from n_hp_locations_preference hpl
      WHERE hpl.status = 2
      GROUP BY hpl.hp_unique_id
	  ) loc ON loc.hp_unique_id = hp.hp_unique_id
    WHERE hp.hp_unique_id = ?;
  `,
    [cg_id],
  );

  return rows[0];
}

async function getCaregiverDocumentsModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT * FROM n_hp_document hd 
    LEFT JOIN n_master_hp_document_type md ON md.id = hd.doc_type_id 
    WHERE hd.hp_unique_id = ?;
  `,
    [cg_id],
  );

  return rows;
}

async function getCaregiverLocationPreferenceModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT name, area, preference_order FROM n_hp_locations_preference lp
    WHERE lp.status = 2 AND lp.hp_unique_id = ?;
  `,
    [cg_id],
  );

  return rows;
}

async function getCaregiverShiftPreferenceModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT sp.preference_order, ms.name FROM n_hp_shift_preference sp
    JOIN n_master_live_type ms ON ms.id = sp.shift_type_id
    WHERE sp.status = 2 AND sp.hp_unique_id = ?;
  `,
    [cg_id],
  );

  return rows;
}

async function getCaregiverQualificationsModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT mq.name FROM n_hp_qualifications hq
    JOIN n_hp_master_qualifications mq ON mq.id = hq.qualification_id
    WHERE hq.status = 2 AND hq.hp_unique_id = ?
    ORDER BY mq.seq_id ASC;
  `,
    [cg_id],
  );

  return rows;
}

async function getCaregiverReferencesModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT * FROM n_hp_references ref
    WHERE ref.hp_unique_id = ?
  `,
    [cg_id],
  );

  return rows;
}

async function getCaregiverActiveBookingDetailsModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT b.id, cl.clnt_name, cl.pat_name, p.first_name, e.emp_name, b.patient_id, b.old_client_id, b.hp_manager
    FROM n_bookings b
    LEFT JOIN n_booking_hp bh ON bh.bkng_id = b.id
    LEFT JOIN life_client cl ON cl.clnt_id = b.old_client_id
    LEFT JOIN n_patient p ON p.id = b.patient_id
    LEFT JOIN life_emp_details e ON e.det_id = b.hp_manager
    WHERE bh.status = 120 AND bh.hp_unique_id = ?;
    `,
    [cg_id],
  );

  return rows[0];
}

async function getCaregiverLeaveRequestsHistoryModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `SELECT * FROM n_hp_leave_requests
    WHERE request_status IN (0, 1) AND hp_unique_id = ?
    ORDER by created_on DESC LIMIT 5;`,
    [cg_id],
  );

  return rows;
}

async function getCaregiverWorkingHistoryModel(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT 
      lcp.cg_unique_id,
      t.cg_id,
      t.client_id,
      nb.id AS booking_id,
      nb.patient_id,
      TRIM(nu.first_name) AS client_name,
      np.first_name AS patient_name,
      service_category.name AS service_category_name,
      live_type.name AS live_type_name,
      MAX(hc.health_conditions) AS health_conditions,
      DATE_FORMAT(CONVERT_TZ(MIN(t.from_date), '+00:00', '+05:30'), '%Y-%m-%d') AS merged_from_date,
      DATE_FORMAT(CONVERT_TZ(MAX(t.to_date), '+00:00', '+05:30'), '%Y-%m-%d') AS merged_to_date
    FROM (
      SELECT 
        ls.*,
        @grp := IF(
          @prev_cg = ls.cg_id 
          AND @prev_client = ls.client_id
          AND DATEDIFF(
            CONVERT_TZ(ls.from_date, '+00:00', '+05:30'), 
            CONVERT_TZ(@prev_to, '+00:00', '+05:30')
          ) <= 1,
          @grp,
          @grp + 1
        ) AS grp,
        @prev_to := ls.to_date,
        @prev_cg := ls.cg_id,
        @prev_client := ls.client_id
      FROM life_schedule ls
      CROSS JOIN (SELECT 
        @grp := 0, 
        @prev_to := NULL, 
        @prev_cg := NULL, 
        @prev_client := NULL
      ) vars
      WHERE ls.status = 3
      ORDER BY ls.cg_id, ls.client_id, ls.from_date
    ) t
    JOIN life_cg_personal lcp ON lcp.cg_id = t.cg_id
    LEFT JOIN n_bookings nb ON nb.old_client_id = t.client_id
    LEFT JOIN n_user nu ON nu.id = nb.usr_id
    LEFT JOIN n_patient np ON np.id = nb.patient_id
    LEFT JOIN n_service_city service_city ON service_city.id = nb.service_city_id
    LEFT JOIN n_master_services services ON services.id = service_city.service_id
    LEFT JOIN n_master_service_category service_category ON service_category.id = services.service_category_id
    LEFT JOIN n_master_live_type live_type ON live_type.id = services.live_type
    LEFT JOIN (SELECT bhc.booking_id,
        GROUP_CONCAT(DISTINCT mhc.name ORDER BY mhc.name SEPARATOR ', ') AS health_conditions
      FROM n_booking_healthcondtions bhc
      JOIN n_master_healthcondtions mhc ON bhc.healthcondtions_id = mhc.id
      GROUP BY bhc.booking_id
    ) as hc ON hc.booking_id = nb.id
    WHERE lcp.cg_unique_id = ?
    GROUP BY 
      lcp.cg_unique_id,
      t.cg_id,
      t.client_id,
      nb.id,
      t.grp,
      nb.usr_id
    ORDER BY merged_from_date DESC;`,
    [cg_id],
  );

  return rows;
}

async function getCaregiverTerminationDetails(cg_id: number) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
    SELECT hp.hp_unique_id, hp.fullname, hp.status, nhr.reject_reason, lcp.cg_term_date
    FROM n_hp_profile hp
    LEFT JOIN n_hp_reject nhr ON nhr.hp_unique_id = hp.hp_unique_id
    LEFT JOIN life_cg_personal lcp ON lcp.cg_unique_id = hp.hp_unique_id
    WHERE hp.status = 4 AND hp.hp_unique_id = ?
    `,
    [cg_id],
  );

  return rows[0];
}

export {
  isCaregiverPhoneNumberModel,
  getCaregiversWithActiveBookingModel,
  getCaregiverDetailsModel,
  getCaregiverProfileDetailsModel,
  getCaregiverDocumentsModel,
  getCaregiverActiveBookingDetailsModel,
  getCaregiverLocationPreferenceModel,
  getCaregiverShiftPreferenceModel,
  getCaregiverQualificationsModel,
  getCaregiverReferencesModel,
  getCaregiverLeaveRequestsHistoryModel,
  getCaregiverWorkingHistoryModel,
  getCaregiverTerminationDetails,
};
