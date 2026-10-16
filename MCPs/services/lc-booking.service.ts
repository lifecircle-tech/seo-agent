import { getBookingDetailsModel } from "../models/lc_bookings.model";

async function getBookingDetails(booking_id: number) {
  try {
    const booking = await getBookingDetailsModel(booking_id);

    return booking
      ? {
          id: booking.id,
          patient_name: booking.patient_name,
          client_name: booking.client_name,
          cm_id: booking.cm_id,
          cm_name: booking.cm_name,
          offered_rate: booking.offered_rate,
          final_rate: booking.final_rate,
          pay_type: booking.pay_type,
          booking_date: booking.booking_date,
          service_start_date: booking.service_start_date,
          service_end_date: booking.service_end_date,
          booking_status: booking.booking_status,
          service_city: booking.service_city,
          service_type: booking.service_type,
          lost_reason: booking.lost_reason,
        }
      : null;
  } catch (err) {
    console.log("[getBookingDetails]", err);
    return null;
  }
}

export { getBookingDetails };
