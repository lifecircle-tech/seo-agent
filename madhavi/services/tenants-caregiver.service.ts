import {
  findCaregiverById,
  findCaregivers,
  findCaregiversTenant,
} from "../models/caregiver.model";
import { getAgeFromDOB } from "../utils/common";

async function getTenantsCaregivers(tenant_id: number) {
  const caregivers_list = await findCaregivers({ tenant_id, status: "active" });

  const caregivers = caregivers_list.map((cg) => ({
    cg_id: cg.caregiver_id,
    name: cg.name,
    phone: cg.phone,
    age: getAgeFromDOB(cg.dob),
    gender: cg.gender,
    languages: JSON.parse(cg.languages).join(", "),
  }));

  return caregivers;
}

async function getTenantsCareGiverDetails(cg_id: number) {
  const caregiver = await findCaregiverById(cg_id);

  return {
    caregiver: {
      cg_id: caregiver.caregiver_id,
      name: caregiver.name,
      phone: caregiver.phone,
      age: getAgeFromDOB(caregiver.dob),
      gender: caregiver.gender,
      languages: JSON.parse(caregiver.languages).join(", "),
    },
  };
}

async function getTenantDetailsOfCaregiver(cg_id: number) {
  const tenant = await findCaregiversTenant(cg_id);

  return {
    name: tenant.company_name,
    id: tenant.tenant_id,
  };
}

export {
  getTenantsCaregivers,
  getTenantsCareGiverDetails,
  getTenantDetailsOfCaregiver,
};
