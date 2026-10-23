import { getBookingDetailsModel } from "../models/lc_bookings.model";

async function getBookingDetails(booking_id: number) {
  try {
    const booking = await getBookingDetailsModel(booking_id);

    return booking
      ? {
          booking_id: booking.id,
          client_name: booking.client_name,
          cm_id: booking.cm_id,
          cm_name: booking.cm_name,
          base_rate: booking.base_rate,
          final_rate: booking.final_rate,
          pay_type: booking.pay_type,
          booking_date: booking.booking_date,
          service_start_date: booking.service_start_date,
          service_end_date: null,
          booking_status: booking.booking_status,
          patient_details: booking.patient_details,
          enquired_caregiver: booking.enquired_caregiver,
        }
      : null;
  } catch (err) {
    console.log("[getBookingDetails]", err);
    return null;
  }
}

export { getBookingDetails };
