import {
  getPatientCarePlansModel,
  getPatientCareScheduleModel,
  getPatientDetailByIdModel,
  getPatientMedicinesModel,
} from "../models/lc-client-patient.model.js";
import SAMPLE from "../sample/sample.js";

async function getClientDetails(client_id: number) {
  return {
    client: SAMPLE.SAMPLE_CLIENT_DATA[0],
  };
}

async function getPatientDetail(patient_id: number) {
  try {
    // const patient = SAMPLE.SAMPLE_PATIENT_DATA[0];
    // return {
    //   patient: null,
    // };

    const patient = await getPatientDetailByIdModel(patient_id);

    return patient
      ? {
          patient: {
            name: patient.first_name || undefined,
            gender: patient.gender || undefined,
            age: new Date().getFullYear() - patient.yob || undefined,
            relation_with_client: patient.relation || undefined,
            health_conditions: patient.health_conditions || undefined
          },
        }
      : null;
  } catch (err) {
    console.log("[getPatientDetail]", err);
    return null;
  }
}

async function getPatientCarePlan(patient_id: number) {
  try {
    const carePlan = await getPatientCarePlansModel(patient_id);
    const careSchedule = await getPatientCareScheduleModel(patient_id);
    const careMedicine = await getPatientMedicinesModel(carePlan.id);

    const response = {
      care_remark: carePlan.care_objective_type_remarks,
      care_schedule: careSchedule,
      medicines: careMedicine,
      notes: carePlan.notes
    }

    return response;
  } catch (err) {
    console.log("[getPatientCarePlan]", err);
    return [];
  }
}

export { getClientDetails, getPatientDetail, getPatientCarePlan };
