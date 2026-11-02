import { RowDataPacket } from "mysql2";
import { lc_pool } from "../../db";

async function getCarejobsCandidateModel(filter: Record<string, any>) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  conditions.push("cj.current_stage in (?)");
  params.push(["NEW_LEAD", "SCREENING", "SUPERVISOR_REVIEW"]);

  conditions.push("nhp.hp_unique_id IS NULL");

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await lc_pool.query<RowDataPacket[]>(
    `
      SELECT
        cj.full_name as name,
        cj.date_of_birth,
        cj.gender,
        cj.age,
        cj.marital_status,
        cj.primary_mobile as phone_number,
        cj.current_city,
        cj.languages_spoken as languages,
        cj.shift_preference,
        cj.role_type as service_type,
        cj.preferred_relocation_cities as willing_to_relocate,
        cj.current_stage,
        cj.referred_by_name as refered_by
      FROM n_care_jobs_candidates cj
      LEFT JOIN n_hp_profile nhp ON RIGHT(nhp.phone_number, 10) = RIGHT(cj.primary_mobile, 10)
      ${where}
    `,
    [...params],
  );

  return rows;
}

export { getCarejobsCandidateModel };
