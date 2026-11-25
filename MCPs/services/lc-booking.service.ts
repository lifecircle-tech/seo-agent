import { getBookingDetailsModel } from "../models/lc_bookings.model";

// Share of the client's price that may go to the caregiver (LifeCircle keeps
// about 30%). Staff can change the ceiling for a lead in the Slack thread.
const CAREGIVER_PAY_SHARE = 0.7;
const DAYS_PER_MONTH = 30;

// "09:00:00" -> "09:00". When no timings were entered the booking holds
// 00:00 to 00:00, or the same start and end time, so both mean "not set".
function getDutyTimings(start: string | null, end: string | null) {
  const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : null);
  const from = hhmm(start);
  const to = hhmm(end);
  if (!from || !to || from === to) return null;
  return { from, to };
}

// Client's locality and pincode; placeholders such as ",," and "000000"
// are dropped. Never the full address.
function getClientArea(locality: unknown, pincode: unknown) {
  const area = typeof locality === "string" && /[a-z]/i.test(locality) ? locality.trim() : null;
  const pin = typeof pincode === "string" && /^[1-9]\d{5}$/.test(pincode) ? pincode : null;
  return area || pin ? { locality: area, pincode: pin } : null;
}

// Pay ceiling for the caregiver, from the client's daily price.
function getPayCeiling(final_rate: unknown, base_rate: unknown, pay_type: unknown) {
  const daily = Number(final_rate) > 0 ? Number(final_rate) : Number(base_rate);
  if (pay_type !== "PERDAY" || !(daily > 0)) return null;

  return {
    client_price_per_day: daily,
    client_price_per_month: Math.round(daily * DAYS_PER_MONTH),
    caregiver_pay_per_day: Math.round(daily * CAREGIVER_PAY_SHARE),
    caregiver_pay_per_month: Math.round(daily * DAYS_PER_MONTH * CAREGIVER_PAY_SHARE),
  };
}

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
          pay_ceiling: getPayCeiling(
            booking.final_rate,
            booking.base_rate,
            booking.pay_type,
          ),
          booking_date: booking.booking_date,
          service_start_date: booking.service_start_date,
          // Not known at lead stage: set once a placement is agreed
          service_end_date: null,
          duty_timings: getDutyTimings(
            booking.service_start_time,
            booking.service_end_time,
          ),
          client_area: getClientArea(
            booking.client_locality,
            booking.client_pincode,
          ),
          special_care_requirements: booking.spl_care_requirements || null,
          other_conditions: booking.patient_conditions_others || null,
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

export { getBookingDetails, getPayCeiling, getDutyTimings, getClientArea };
