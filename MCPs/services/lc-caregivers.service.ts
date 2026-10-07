import { getAgeFromDOB } from "../utils/common.js";
import {
  getCaregiverDocumentsModel,
  getCaregiverLeaveRequestsHistoryModel,
  getCaregiverLocationPreferenceModel,
  getCaregiverProfileDetailsModel,
  getCaregiverQualificationsModel,
  getCaregiverReferencesModel,
  getCaregiverShiftPreferenceModel,
  getCaregiverTerminationDetails,
  getCaregiverWorkingHistoryModel,
} from "../models/lc-caregivers.model.js";
import SAMPLE from "../sample/sample.js";

const required_data = {
  NAME: "name",
  // NUMBER: "number",
  DOB: "dob",
  GENDER: "gender",
  REFERENCES: "references",
  AADHAAR: "aadhaar_no",
  CURRENTADDRESS: "currentAddress",
  SHIFTS: "shift_preferences",
  QUALIFICATIONS: "qualifications",
  LOCATIONS: "locations",
  EXPERIENCE: "experience",
  PROFILEPIC: "profile_pic",
};

const required_documents = {
  default: ["aadhar card front", "aadhar card back"],
  Nursing: [
    "aadhar card front",
    "aadhar card back",
    // 'pan card', 'voter id front', 'passbook'
  ],
  Caregiving: ["aadhar card front", "aadhar card back"],
  Therapy: ["aadhar card front", "aadhar card back"],
};

async function getCaregiverProfileStatus(cg_id: number) {
  try {
    // const profile = SAMPLE.SAMPLE_CG_PROFILE_STATUS.find(
    //   (p) => p.cg_id == cg_id,
    // );

    // return profile ?? null;

    const cg_profile = await getCaregiverProfileDetailsModel(cg_id);
    const cg_document = await getCaregiverDocumentsModel(cg_id);

    const missing_data = Object.values(required_data).filter(
      (data) => !cg_profile[data],
    );

    const present_docs = cg_document.map((doc) => doc.type);
    const missing_documents = required_documents.default.filter(
      (doc) => !present_docs.includes(doc),
    );

    if ([...missing_data, ...missing_documents].length) {
      return {
        profile_status: "profile incomplete",
        cg_id: cg_profile.hp_unique_id,
        hp_unique_id: cg_profile.hp_unique_id,
        reason: "missing details",
        onboarding_status: cg_profile.onboarding_status,
        missing_data: missing_data.length ? missing_data : undefined,
        missing_documents: missing_documents.length
          ? missing_documents
          : undefined,
      };
    }

    const preferred_locations =
      await getCaregiverLocationPreferenceModel(cg_id);
    const preferred_shift = await getCaregiverShiftPreferenceModel(cg_id);
    const qualifications = await getCaregiverQualificationsModel(cg_id);
    const references = await getCaregiverReferencesModel(cg_id);

    const address = [
      cg_profile.street,
      cg_profile.area,
      cg_profile.city,
      cg_profile.district,
      cg_profile.state,
      cg_profile.country,
      cg_profile.pincode,
    ]
      .filter((item) => item?.trim(" "))
      .join(", ");

    return {
      profile_status: "profile completed",
      cg_id: cg_profile.hp_unique_id,
      cg_user_id: cg_profile.user_id,
      hp_unique_id: cg_profile.hp_unique_id,
      name: cg_profile.name,
      gender: cg_profile.gender,
      age: getAgeFromDOB(cg_profile.dob),
      dob: new Date(cg_profile.dob).toISOString(),
      languages: cg_profile.languages,
      marital_status: cg_profile.marital_status,
      address: address,
      preferred_locations: preferred_locations.map((loc) => ({
        city: loc.name,
        area: loc.area,
        preference_order: loc.preference_order,
      })),
      preferred_shift: preferred_shift,
      qualifications: qualifications.map((ref) => ref.name),
      references: references.map((ref) => ({
        name: ref.name,
        relation: ref.relationship,
      })),
      created_on: new Date(cg_profile.created_on).toISOString(),
    };
  } catch (err) {
    console.log("[getCaregiverProfileStatus]", err);
    return null;
  }
}

async function getCaregiverWorkingStatus(cg_id: number) {
  try {
    // return null;

    // return (
    //   SAMPLE.SAMPLE_CG_WORKING_STATUS.find((w) => w.cg_id == cg_id) ?? null
    // );

    const [recent_working] = await getCaregiverWorkingHistoryModel(cg_id);
    const [recent_leave] = await getCaregiverLeaveRequestsHistoryModel(cg_id);
    const termination_detail = await getCaregiverTerminationDetails(cg_id);

    if (termination_detail) {
      return {
        status: "profile terminated",
        from_date: new Date(termination_detail.cg_term_date).toISOString(),
        reason: termination_detail.reject_reason,
      };
    }

    if (recent_leave && recent_leave.request_status) {
      return {
        status: "on leave",
        from_date: recent_leave.actual_start_date,
        expected_return: recent_leave.request_end_date,
      };
    }

    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });

    if (recent_working && recent_working.merged_to_date >= today) {
      return {
        status: "working",
        from_date: recent_working.merged_from_date,
        cg_id: recent_working.cg_unique_id,
        hp_unique_id: recent_working.cg_unique_id,
        client_id: recent_working.client_id,
        patient_id: recent_working.patient_id,
        booking_id: recent_working.booking_id,
        client_name: recent_working.client_name,
        patient_name: recent_working.patient_name,
        patient_health_condition: recent_working.health_conditions,
      };
    }

    return {
      status: "bench : ready to work",
    };
  } catch (err) {
    console.log("[getCaregiverWorkingStatus]", err);
    return null;
  }
}

async function getCaregiverWorkingHistory(cg_id: number) {
  try {
    // return [];

    // return SAMPLE.SAMPLE_CG_WORKING_HISTORY.filter((w) => w.cg_id == cg_id);

    const work_history = await getCaregiverWorkingHistoryModel(cg_id);

    // en-CA yields YYYY-MM-DD, matching the IST-formatted merged_to_date from SQL
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });

    const history = work_history.map((work) => {
      return {
        cg_id: work.cg_unique_id,
        hp_unique_id: work.cg_unique_id,
        client_name: work.client_name,
        patient_name: work.patient_name,
        patient_condition: work.health_conditions, // flaw in reading health condition, reading duplicate values
        from_date: work.merged_from_date,
        to_date: work.merged_to_date >= today ? undefined : work.merged_to_date,
      };
    });

    return history;
  } catch (err) {
    console.log("[getCaregiverWorkingHistory]", err);
    return null;
  }
}

async function getCaregiverPaymentInfo(cg_id: number) {
  try {
    console.log("payment ", SAMPLE.SAMPLE_CG_PAYMENT_DATA);

    const payment_info = SAMPLE.SAMPLE_CG_PAYMENT_DATA.find(
      (p) => p.cg_id == cg_id,
    );

    return payment_info;
  } catch (err) {
    console.log("[getCaregiverPaymentInfo]", err);
    return null;
  }
}

export {
  getCaregiverProfileStatus,
  getCaregiverWorkingStatus,
  getCaregiverWorkingHistory,
  getCaregiverPaymentInfo,
};
