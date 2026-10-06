import {
  isLCEmployeePhoneNumber as isLCEmployeePhoneNumberModel,
} from "../models/lc-care_manager.model.js";
import { isCaregiverPhoneNumber as isCaregiverPhoneNumberModel } from "../models/lc-caregivers.model";

async function isLCMemberPhoneNumber(phone: string) {
  return (
    (await isLCEmployeePhoneNumberModel(phone)) ||
    (await isCaregiverPhoneNumberModel(phone))
  );
}

async function isLCEmployeePhoneNumber(phone: string) {
  return await isLCEmployeePhoneNumberModel(phone);
}

export { isLCMemberPhoneNumber, isLCEmployeePhoneNumber };
