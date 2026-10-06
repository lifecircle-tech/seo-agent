import { getCaremanagerDetailsModel } from "../models/lc-care_manager.model.js";
import SAMPLE from "../sample/sample.js";

async function getCareManagerDetails(cm_id: number) {
  try {
    // const manager = SAMPLE.SAMPLE_CM_DATA.find((m) => m.cm_id == cm_id);
    // return manager
    //   ? {
    //       care_manager: manager,
    //     }
    //   : null;

    const caremanager = await getCaremanagerDetailsModel(cm_id);

    return caremanager
      ? {
          care_manager: {
            cm_id: caremanager.det_id,
            name: caremanager.emp_name,
            phone: caremanager.det_mobile,
          },
        }
      : null;
  } catch (err) {
    console.log("[getCareManagerDetails]", err);
    return null;
  }
}

export { getCareManagerDetails };
