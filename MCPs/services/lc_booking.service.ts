import { getCarejobsCandidateModel } from "../models/lc_carejobs.model";

async function getCarejobsCandidates() {
    try {
        const candidates = await getCarejobsCandidateModel({});
        
        return candidates;
    } catch (err) {
        console.log("[getCarejobsCandidates]", err);
        return null;
    }
}

export {
    getCarejobsCandidates
}