import {
  getClientsDetails as getClientsDetailsModel,
  getPatientDetailById as getPatientDetailByIdModel,
} from "../models/lc-client-patient.model.js";

async function getClientsDetails(client_id: number) {
  return getClientsDetailsModel(client_id);
}

async function getPatientDetailById(patient_id: number) {
  return getPatientDetailByIdModel(patient_id);
}

export { getClientsDetails, getPatientDetailById };
