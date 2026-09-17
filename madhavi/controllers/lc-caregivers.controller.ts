import {
  getCaregiversWithActiveBooking as getCaregiversWithActiveBookingModel,
  getCaregiverDetails as getCaregiverDetailsModel,
  getCaregiverActiveBookingDetails as getCaregiverActiveBookingDetailsModel,
  isCaregiverPhoneNumber as isCaregiverPhoneNumberModel,
} from "../models/lc-caregivers.model";

async function getCaregiversWithActiveBooking({
  limit = 50,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
}) {
  return getCaregiversWithActiveBookingModel({ limit, offset });
}

async function getCaregiverDetails(cg_id: number) {
  return getCaregiverDetailsModel(cg_id);
}

async function getCaregiverActiveBookingDetails(cg_id: number) {
  return getCaregiverActiveBookingDetailsModel(cg_id);
}

async function isCaregiverPhoneNumber(phone: string) {
  return isCaregiverPhoneNumberModel(phone);
}

export {
  getCaregiversWithActiveBooking,
  getCaregiverDetails,
  getCaregiverActiveBookingDetails,
  isCaregiverPhoneNumber,
};
