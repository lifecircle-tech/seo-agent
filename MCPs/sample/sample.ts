export default {
  SAMPLE_CG_DATA: [
    {
      cg_id: 123,
      name: "Jay",
      phone: "+916361479764",
      gender: "Male",
      age: 28,
      languages: "Hindi, English",
      cm_id: 789,
      booking_id: 753,
    },
  ],

  SAMPLE_BOOKING_DATA: {
    123: {
      booking_id: 753,
      client_id: 456,
      patient_id: 8160,
      cm_id: 789,
    },
  },

  SAMPLE_CG_PROFILE_STATUS: [
    {
      profile_status: "profile completed",
      cg_id: 123,
      hp_unique_id: 123,
      name: "Jay",
      gender: "Male",
      age: 28,
      dob: new Date("1998-11-30").toISOString(),
      languages: "Hindi, English",
      marital_status: "single",
      address: "Hyderbad, Telangana",
      preferred_locations: [
        { city: "Hyderabad", area: "Hyderabad", preference_order: 1 },
      ],
      preferred_shift: [{ name: "Live-out", preference_order: 1 }],
      qualifications: ["Intermediate (12th)"],
      references: [{ name: "Yamuna", relation: "father" }],
      created_on: new Date("2025-08-30").toISOString(),
    },
  ],

  SAMPLE_CG_WORKING_STATUS: [
    // {
    //   cg_id: 123,
    //   status: "on leave",
    //   from_date: '2026-10-01',
    //   expected_return: '2026-10-05',
    // },
    {
      status: "working",
      from_date: "2026-09-27",
      cg_id: 123,
      hp_unique_id: 123,
      client_id: 456,
      patient_id: 8160,
      booking_id: 753,
      client_name: "kavta malik",
      patient_name: "Arun Kumar Malik",
      patient_health_condition: "Diabetes, Hypothyroidism, Hypertension (High BP), Stroke (CVA) - Post Stroke Care, Parkinson's Disease,  Speech Challenges",
    },
  ],

  SAMPLE_CG_WORKING_HISTORY: [
    {
      cg_id: 123,
      hp_unique_id: 123,
      client_name: "kavta malik",
      patient_name: "Arun Kumar Malik",
      patient_condition: "Diabetes, Hypothyroidism, Hypertension (High BP), Stroke (CVA) - Post Stroke Care, Parkinson's Disease,  Speech Challenges",
      from_date: "2026-09-27",
    },
    {
      cg_id: 123,
      hp_unique_id: 123,
      client_name: "Ram",
      patient_name: "Dashrath",
      patient_condition: "Dementia (Alzheimer's, Vascular)",
      from_date: "2025-09-01",
      to_date: "2026-08-31",
    },
  ],

  SAMPLE_CM_DATA: [
    {
      cm_id: 789,
      name: "Ganesh",
      phone: "+918105938170",
    },
  ],

  SAMPLE_CLIENT_DATA: [
    {
      client_id: 456,
      name: "Kumar",
    },
  ],

  SAMPLE_PATIENT_DATA: [
    {
      name: "Prakash",
      age: 50,
      gender: "Male",
      relation_with_client: "father",
      health_conditions: "Diabetes, Obesity, Heart Failure (CHF)",
    },
  ],

  SAMPLE_CG_PAYMENT_DATA: [
    {
      cg_id: 123,
      time_period: "per_month",
      base_salary: 20000,
      total_payable: 18000,
      due_date: "2026-09-30",
      deduction: {
        unpaid_leaves: 2000,
      },
    },
  ],
};
