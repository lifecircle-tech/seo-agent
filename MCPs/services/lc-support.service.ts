import {
  createSupportTicketModel,
  getCaregiversSupportTicketListModel,
  getSupportTypeModel,
} from "../models/lc-support.model";

interface CreateSupportTicket {
  user_id: number;
  support_id: number;
  from_date?: string;
  to_date?: string;
  amount?: number;
  title: string;
  description: string;
}

async function getSupportTypes() {
  const support_list = await getSupportTypeModel("hpapp");
  const support_types = support_list
    .map((type: any) => ({
      support_id: type.id,
      name: type.name,
    }))
    .filter((type: any) => type.support_id != -2);

  return support_types;
}

async function createSupportTicket(data: CreateSupportTicket) {
  try {
    let payload = {
      user_id: data.user_id,
      support_id: data.support_id,
      title: data.title,
      description: data.description,
    } as Record<string, unknown>;

    if (data.support_id == 7) {
      payload.request_param1 = data.amount;
    } else if (data.support_id == 8) {
      payload.request_param1 = data.from_date;
      payload.request_param2 = data.to_date;
    } else if (data.support_id == 9) {
      payload.request_param1 = data.from_date;
    }

    console.log("payload", payload);

    // return "success";
    const result = await createSupportTicketModel(data);
    if (result) {
      return "success";
    }

    throw new Error("Something went wrong");
  } catch (err) {
    console.log("create_support_ticket", err);
    return "failed";
  }
}

async function getCaregiverSupportTickets(cg_user_id: number) {
  try {
    const tickets = await getCaregiversSupportTicketListModel(cg_user_id);

    const support = tickets.map((s) => ({
      support_id: s.support_type_id,
      title: s.title,
      description: s.description,
      status: s.status == 18 ? 'open' : 'closed',
      created_on: s.created_on
    }));

    return support;
  } catch (err: any) {
    console.log("create_support_ticket", err);
    return "error fetching support tickets";
  }
}

export { getSupportTypes, createSupportTicket, getCaregiverSupportTickets };
