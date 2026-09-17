import { getCaremanagerDetails as getCaremanagerDetailsModel } from "../models/lc-care_manager.model.js";

async function getCaremanagerDetails(cm_id: number) {
  return getCaremanagerDetailsModel(cm_id);
}

export { getCaremanagerDetails };
