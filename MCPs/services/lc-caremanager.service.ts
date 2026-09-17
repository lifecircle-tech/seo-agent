import { getCaremanagerDetails } from "../models/lc-care_manager.model.js";

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

export { getCareManagerDetails };
