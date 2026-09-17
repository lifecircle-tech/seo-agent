import {
  getCaremanagerDetails,
  isLCEmployeePhoneNumber as isLCEmployeePhoneNumberModel,
} from "../models/lc-care_manager.model.js";
import { isCaregiverPhoneNumber as isCaregiverPhoneNumberModel } from "../models/lc-caregivers.model";

async function getCareManagerDetails(cm_id: number) {
  try {
    return {
      care_manager: {
        cm_id: 789,
        name: "Ganesh",
        phone: "+918105938170",
      },
    };

    // const caremanager = await getCaremanagerDetails(cm_id);

    // return caremanager
    //   ? {
    //       care_manager: {
    //         cm_id: caremanager.det_id,
    //         name: caremanager.emp_name,
    //         phone: caremanager.det_mobile,
    //       },
    //     }
    //   : null;
  } catch (err) {
    console.log("[getCareGiverWithActiveBooking]", err);
    return null;
  }
}

async function isLCMemberPhoneNumber(phone: string) {
  return (
    (await isLCEmployeePhoneNumberModel(phone)) ||
    (await isCaregiverPhoneNumberModel(phone))
  );
}

async function isLCEmployeePhoneNumber(phone: string) {
  return await isLCEmployeePhoneNumberModel(phone);
}

export {
  getCareManagerDetails,
  isLCMemberPhoneNumber,
  isLCEmployeePhoneNumber,
};
