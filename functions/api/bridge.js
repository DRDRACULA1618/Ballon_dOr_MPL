const ACTIONS = new Set([
  "requestOtp",
  "verifyOtp",
  "getBallot",
  "submitBallot",
  "adminState",
  "adminSaveSettings",
  "adminRegisterVoters",
  "adminSendInvitations",
  "adminCloseVote",
  "adminAudit",
  "adminSyncResults",
]);

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ message: "Origine de requête refusée." }, 403);

  let body;
  try {
    const text = await request.text();
    if (text.length > 65536) return json({ message: "Requête trop volumineuse." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ message: "Requête illisible." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || !ACTIONS.has(body.action)) {
    return json({ message: "Opération inconnue." }, 400);
  }

  const endpoint = env.MPL_APPS_SCRIPT_URL || "";
  const bridgeSecret = env.MPL_API_BRIDGE_SECRET || "";
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint) || bridgeSecret.length < 32) {
    return json({ message: "Le service de vote n’est pas encore configuré." }, 503);
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, bridgeSecret }),
      redirect: "follow",
    });
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ message: "Le service de vote a renvoyé une réponse invalide." }, 502);
    }
    const status = Number(payload.__status || response.status || 200);
    delete payload.__status;
    return json(payload, status);
  } catch {
    return json({ message: "Le service de vote est momentanément indisponible." }, 502);
  }
}
