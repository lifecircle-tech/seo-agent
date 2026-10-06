const api_base_url = process.env.LC_BACKEND_API_BASE_URL || "";
const madhavi_report = process.env.MADHAVI_REPORT || "";
const madhavi_suggestion = process.env.MADHAVI_SUGGESTION || "";

async function notifyCareManager(cm_id: number, message: string) {
  //   const response = await fetch(api_base_url as string, {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify({ cm_id, message }),
  //   });

  const response = await fetch(api_base_url, {
    method: "POST",
    body: JSON.stringify({ text: message }),
  });

  if (!response.ok) {
    return {
      status: "error",
      message: `Failed to notify care manager: ${response.status} ${response.statusText}`,
    };
  }

  return {
    status: "ok",
    message: "Care manager notified",
  };
}

async function notifyMadhaviReport(message: string) {
  const response = await fetch(madhavi_report, {
    method: "POST",
    body: JSON.stringify({ text: message }),
  });

  if (!response.ok) {
    return {
      status: "error",
      message: `Failed to report: ${response.status} ${response.statusText}`,
    };
  }

  return {
    status: "ok",
    message: "Message sent",
  };
}

async function notifyMissingInformation(message: string) {
  const response = await fetch(madhavi_suggestion, {
    method: "POST",
    body: JSON.stringify({ text: message }),
  });

  if (!response.ok) {
    return {
      status: "error",
      message: `Failed to message: ${response.status} ${response.statusText}`,
    };
  }

  return {
    status: "ok",
    message: "Improvement or suggestion sent",
  };
}

export { notifyCareManager, notifyMadhaviReport, notifyMissingInformation };
