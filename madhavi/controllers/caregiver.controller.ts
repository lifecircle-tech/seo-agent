import { Request, Response } from "express";
import {
  insertCaregiver,
  findCaregivers,
  findCaregiverById,
  updateCaregiverById,
  deleteCaregiverById,
} from "../models/caregiver.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createCaregiver(req: Request, res: Response) {
  const {
    tenant_id,
    supervisor_id,
    name,
    email,
    phone,
    start_date,
    end_date,
    status,
  } = req.body;

  const caregiver_id = await insertCaregiver({
    tenant_id,
    supervisor_id,
    name,
    email,
    phone,
    start_date,
    end_date,
    status,
  });
  const caregiver = await findCaregiverById(caregiver_id);

  res.status(201).json(caregiver);
}

async function getCaregivers(req: Request, res: Response) {
  const { tenant_id, supervisor_id, status } = req.query;

  const caregivers = await findCaregivers({
    tenant_id: tenant_id as string | undefined,
    supervisor_id: supervisor_id as string | undefined,
    status: status as string | undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(caregivers);
}

async function getCaregiverById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const caregiver = await findCaregiverById(id);

  if (!caregiver) {
    res.status(404).json({ error: "Caregiver not found" });
    return;
  }

  res.json(caregiver);
}

async function updateCaregiver(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { supervisor_id, name, email, phone, start_date, end_date, status } =
    req.body;

  const updated = await updateCaregiverById(id, {
    supervisor_id,
    name,
    email,
    phone,
    start_date,
    end_date,
    status,
  });

  if (!updated) {
    res.status(404).json({ error: "Caregiver not found" });
    return;
  }

  const caregiver = await findCaregiverById(id);

  res.json(caregiver);
}

async function deleteCaregiver(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteCaregiverById(id);

  if (!deleted) {
    res.status(404).json({ error: "Caregiver not found" });
    return;
  }

  res.status(204).send();
}

export {
  createCaregiver,
  getCaregivers,
  getCaregiverById,
  updateCaregiver,
  deleteCaregiver,
};
