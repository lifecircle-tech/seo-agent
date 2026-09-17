import { getAgeFromDOB } from "../utils/common.js";
import {
  getCaregiverActiveBookingDetails,
  getCaregiverDetails,
  getCaregiversWithActiveBooking,
} from "../models/lc-caregivers.model.js";

async function getCareGiverWithActiveBooking({
  limit = 50,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
}) {
  try {
    return [
      {
        cg_id: 951,
        name: "Jay",
        phone: "8105938170",
      },
    ];

    // const rows = await getCaregiversWithActiveBooking({
    //   limit,
    //   offset,
    // });

    // const caregivers = rows.map((row) => ({
    //   cg_id: row.hp_unique_id,
    //   name: row.fullname,
    //   phone: row.phone_number,
    // }));

    // return caregivers;
  } catch (err) {
    console.log("[getCareGiverWithActiveBooking]", err);
    return null;
  }
}

async function getCareGiverDetails(cg_id: number) {
  try {
    return {
      caregiver: {
        cg_id: 951,
        name: "Jay",
        phone: "8105938170",
        gender: "Male",
        age: 28,
        languages: "Hindi, English",
        booking_id: 753,
      },
    };

    // const caregiver = await getCaregiverDetails(cg_id);

    // return {
    //   caregiver: {
    //     cg_id: caregiver.hp_unique_id,
    //     name: caregiver.fullname,
    //     phone: caregiver.phone_number,
    //     gender: caregiver.gender,
    //     age: getAgeFromDOB(caregiver.dob),
    //     languages: caregiver.languages,
    //     booking_id: caregiver.booking_id || undefined,
    //   },
    // };
  } catch (err) {
    console.log("[getCareGiverDetails]", err);
    return null;
  }
}

async function getCareGiverActiveBookingDetails(cg_id: number) {
  try {
    return {
      booking_id: 963,
      client_name: "Kumar",
      patient_name: "Prakash",
      cm_name: "Ganesh",

      client_id: 456,
      patient_id: 852,
      cm_id: 789,
    };

    // const booking = await getCaregiverActiveBookingDetails(cg_id);

    // return {
    //   booking_id: booking.id || undefined,
    //   client_name: booking.clnt_name || undefined,
    //   patient_name: booking.first_name || booking.pat_name || undefined,
    //   cm_name: booking.emp_name || undefined,

    //   client_id: booking.old_client_id || undefined,
    //   patient_id: booking.patient_id || undefined,
    //   cm_id: booking.hp_manager || undefined,
    // };
  } catch (err) {
    console.log("[getCareGiverActiveBookingDetails]", err);
    return null;
  }
}

export {
  getCareGiverDetails,
  getCareGiverWithActiveBooking,
  getCareGiverActiveBookingDetails,
};
