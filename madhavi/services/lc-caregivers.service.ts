import { getAgeFromDOB } from "../utils/common.js";
import {
  getCaregiverActiveBookingDetailsModel,
  getCaregiverDetails,
  getCaregiversInRegistration,
  getCaregiversWithActiveBooking,
  isCaregiverPhoneNumber as isCaregiverPhoneNumberModel,
} from "../models/lc-caregivers.model";
import { findAgentCaregiversWithoutContact } from "../models/lc-agent-audit.model";
import { logger } from "../utils/logger.js";

// import SAMPLE from "../../sample/sample.js";

async function getCareGiverWithActiveBooking({
  limit = 50,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
}) {
  try {
    // return SAMPLE.SAMPLE_CG_DATA.slice(offset, offset + limit).map(
    //   (sample) => ({
    //     cg_id: sample.cg_id,
    //     name: sample.name,
    //     phone: sample.phone,
    //   }),
    // );

    const rows = await getCaregiversWithActiveBooking({
      limit,
      offset,
    });

    const caregivers = rows.map((row) => ({
      cg_id: row.hp_unique_id,
      name: row.fullname,
      phone: row.phone_number,
    }));

    return caregivers;
  } catch (err) {
    logger.error("[getCareGiverWithActiveBooking]", err);
    return null;
  }
}

async function getCareGiverDetails(cg_id: number) {
  try {
    // const cg = SAMPLE.SAMPLE_CG_DATA.find(
    //   (sample) => sample.cg_id === cg_id,
    // );
    // if (cg) {
    //   return {
    //     caregiver: cg,
    //   };
    // }
    // return null;

    const caregiver = await getCaregiverDetails(cg_id);

    return {
      caregiver: {
        cg_id: caregiver.hp_unique_id,
        cg_user_id: caregiver.user_id,
        name: caregiver.fullname,
        phone: caregiver.phone_number,
        gender: caregiver.gender,
        age: getAgeFromDOB(caregiver.dob),
        languages: caregiver.languages,
        booking_id: caregiver.booking_id || undefined,
        ...(caregiver.booking_id && {
          cm_id: caregiver.cm_id,
          cm_name: caregiver.cm_name,
        }),
      },
    };
  } catch (err) {
    logger.error("[getCareGiverDetails]", err);
    return null;
  }
}

async function getCareGiverActiveBookingDetails(cg_id: number) {
  try {
    // const bookings: Record<
    //   number,
    //   (typeof SAMPLE.SAMPLE_BOOKING_DATA)[keyof typeof SAMPLE.SAMPLE_BOOKING_DATA]
    // > = SAMPLE.SAMPLE_BOOKING_DATA;
    // return bookings[cg_id] ?? null;

    const booking = await getCaregiverActiveBookingDetailsModel(cg_id);

    return {
      booking_id: booking.id || undefined,
      client_name: booking.clnt_name || undefined,
      patient_name: booking.first_name || booking.pat_name || undefined,
      cm_name: booking.emp_name || undefined,

      client_id: booking.old_client_id || undefined,
      patient_id: booking.patient_id || undefined,
      cm_id: booking.hp_manager || undefined,
    };
  } catch (err) {
    logger.error("[getCareGiverActiveBookingDetails]", err);
    return null;
  }
}

async function isCaregiverPhoneNumber(phone: string) {
  return await isCaregiverPhoneNumberModel(phone);
}

// Caregivers the registration agent has worked with, still in registration,
// and not contacted for `days` days. Oldest contact first. Conversations
// live in the Madhavi database and profiles in the LC database, so the two
// are filtered one after the other.
async function getCaregiversDueForRegistrationFollowup({
  agent_key,
  days,
  limit,
}: {
  agent_key: string;
  days: number;
  limit: number;
}) {
  try {
    const not_contacted = await findAgentCaregiversWithoutContact(
      agent_key,
      days,
    );
    const in_registration = new Set(
      await getCaregiversInRegistration(
        not_contacted.map((cg) => cg.hp_unique_id),
      ),
    );

    return not_contacted
      .filter((cg) => in_registration.has(cg.hp_unique_id))
      .slice(0, limit)
      .map((cg) => cg.hp_unique_id);
  } catch (err) {
    logger.error("[getCaregiversDueForRegistrationFollowup]", err);
    return [];
  }
}

export {
  getCaregiversDueForRegistrationFollowup,
  getCareGiverDetails,
  getCareGiverWithActiveBooking,
  getCareGiverActiveBookingDetails,
  isCaregiverPhoneNumber,
};
