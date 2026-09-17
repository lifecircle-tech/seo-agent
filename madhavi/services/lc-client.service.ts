import { getPatientDetailById } from "../models/lc-client-patient.model.js";

async function getClientDetails(client_id: number) {
  return {
    client: {
      client_id: 456,
      name: "Kumar",
    },
  };
}

async function getPatientDetail(patient_id: number) {
  try {
    return {
      patient: {
        name: "Prakash",
        age: 50,
        gender: "Male",
        relation_with_client: "father",
        health_conditions: "Malnutrition / Frailty, Heart Failure (CHF), ",
      },
    };

    // const patient = await getPatientDetailById(patient_id);

    // return patient
    //   ? {
    //       patient: {
    //         name: patient.first_name || undefined,
    //         gender: patient.gender || undefined,
    //         age: new Date().getFullYear() - patient.yob || undefined,
    //         relation_with_client: patient.relation || undefined,
    //         health_conditions: patient.health_conditions || undefined
    //       },
    //     }
    //   : null;
  } catch (err) {
    console.log("[getPatientDetail]", err);
    return null;
  }
}

export { getClientDetails, getPatientDetail };
