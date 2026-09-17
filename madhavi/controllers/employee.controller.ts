import { Request, Response } from "express";
import {
  insertEmployee,
  findEmployees,
  findEmployeeById,
  updateEmployeeById,
  deleteEmployeeById,
} from "../models/employee.model.js";
import { parsePaginationQuery } from "../utils/common.js";

async function createEmployee(req: Request, res: Response) {
  const { tenant_id, name, email, phone } = req.body;

  const employee_id = await insertEmployee({ tenant_id, name, email, phone });
  const employee = await findEmployeeById(employee_id);

  res.status(201).json(employee);
}

async function getEmployees(req: Request, res: Response) {
  const { tenant_id, name, email } = req.query;

  const employees = await findEmployees({
    tenant_id: tenant_id as string | undefined,
    name: name as string | undefined,
    email: email as string | undefined,
    ...parsePaginationQuery(req.query),
  });

  res.json(employees);
}

async function getEmployeeById(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const employee = await findEmployeeById(id);

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json(employee);
}

async function updateEmployee(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { name, email, phone } = req.body;

  const updated = await updateEmployeeById(id, { name, email, phone });

  if (!updated) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  const employee = await findEmployeeById(id);

  res.json(employee);
}

async function deleteEmployee(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  const deleted = await deleteEmployeeById(id);

  if (!deleted) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.status(204).send();
}

export {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
};
