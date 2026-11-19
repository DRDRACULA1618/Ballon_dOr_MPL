const root = document.querySelector("#admin-root");
let adminSecret = "";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

async function api(action, payload = {}) {
  const response = await fetch("/api/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, adminSecret, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.message || "La requête n’a pas abouti.");
  return result;
}

function showMessage(id, text, error = false) {
  const node = document.querySelector(`#${id}`);
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("error", error);
}

function renderDashboard(state) {
  const voters = state.voters.length
    ? state.voters.map((voter) => `<tr><td>${escapeHtml(voter.name)}</td><td>${escapeHtml(voter.email)}</td><td>${voter.voted ? "Vote reçu" : voter.invitationSent ? "Invitation envoyée" : "En attente"}</td></tr>`).join("")
    : `<tr><td colspan="3">Aucun électeur enregistré.</td></tr>`;
  const pending = state.pending.length
    ? `<aside class="notice"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Bulletin à valider avant ouverture</strong><ul>${state.pending.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></aside>`
    : `<p class="status-good">Catalogue prêt · ${state.categoryCount} catégories · ${state.nominationCount} nominations.</p>`;

  root.innerHTML = `<div class="admin-intro"><p class="eyebrow">MPL Ballin’ d’Or 2026</p><h1>Tableau organisateur</h1><p>Gère le registre, les invitations, l’échéance et le rapport privé. Le vote reste fermé tant que le catalogue ou l’heure de clôture ne sont pas validés.</p></div>
    ${pending}
    <section class="admin-panel"><h2>Paramètres du scrutin</h2><form id="settings-form"><div class="admin-row"><label class="field">Titre<input id="vote-title" maxlength="100" required /></label><label class="field">Date de clôture<input id="closing-date" type="date" required /></label><label class="field">Heure GMT / Abidjan<input id="closing-time" type="time" step="1" required /></label></div><p class="field-note">Échéance communiquée : 1er décembre 2026 à 23:59:59 GMT (heure d’Abidjan). Le serveur applique cette échéance.</p><label class="check-row"><input id="vote-open" type="checkbox" ${state.ballotReady ? "" : "disabled"} /> Ouvrir le scrutin</label><div class="admin-row"><button class="admin-button" type="submit">Enregistrer</button><button class="admin-button danger" id="close-vote" type="button" ${state.isOpen ? "" : "disabled"}>Clôturer maintenant</button><span class="admin-message" id="settings-message" role="status"></span></div></form></section>
    <section class="admin-panel"><h2>Registre des électeurs</h2><p>Ajoute les électeurs autorisés avec leur adresse e-mail. Format : une ligne par personne, <code>Nom|adresse@exemple.com</code>.</p><form id="voters-form"><label class="field">Noms et e-mails<textarea id="voter-list" rows="5" placeholder="Nom du votant|adresse@exemple.com"></textarea></label><div class="admin-row"><button class="admin-button" type="submit" ${state.isOpen || state.voterRegistryLocked ? "disabled" : ""}>Enregistrer les électeurs</button><span class="admin-message" id="voters-message" role="status"></span></div></form><div class="table-wrap"><table class="admin-table"><thead><tr><th>Électeur</th><th>E-mail enregistré</th><th>Participation</th></tr></thead><tbody>${voters}</tbody></table></div><div class="admin-row"><button class="admin-button secondary" id="send-invitations" type="button" ${state.isOpen ? "" : "disabled"}>Envoyer les invitations en attente</button><span class="admin-message" id="invites-message" role="status"></span></div><p class="field-note">Les liens sont envoyés par e-mail, stockés uniquement sous forme d’empreinte et expirent à la clôture. Le registre est gelé dès la première ouverture.</p></section>
    <section class="admin-panel"><div class="admin-row panel-title-row"><h2>Audit et rapport agrégé</h2><button class="admin-button secondary" id="refresh-state" type="button">Actualiser</button></div><p>Participation : ${state.voters.filter((voter) => voter.voted).length} sur ${state.voters.length}. Bulletins valides comptés : ${state.audit.validBallots}. Bulletins invalides : ${state.audit.invalidBallots}.</p><div class="admin-row"><button class="admin-button secondary" id="run-audit" type="button">Recalculer l’audit</button><span class="admin-message" id="audit-message" role="status"></span></div><label class="field report-emails">E-mails des organisateurs autorisés à lire le rapport<textarea id="organizer-emails" rows="3" placeholder="organisateur@exemple.com, autre@exemple.com"></textarea></label><div class="admin-row"><button class="admin-button" id="sync-results" type="button" ${state.resultsLocked ? "disabled" : ""}>Créer / synchroniser le rapport privé</button><span class="admin-message" id="report-message" role="status"></span></div>${state.reportUrl ? `<p class="field-note">Rapport privé : <a href="${escapeHtml(state.reportUrl)}" target="_blank" rel="noopener noreferrer">ouvrir la feuille de résultats</a></p>` : ""}<p class="field-note">Le rapport contient uniquement les totaux agrégés. Il reste privé et accessible seulement aux comptes Google indiqués.</p></section>
    <p class="admin-message" id="readiness-message" role="status">Version catalogue : ${escapeHtml(state.catalogVersion)}. État : ${state.isOpen ? "ouvert" : "fermé"}.</p><p><a href="./">← Retour au site</a></p>`;

  document.querySelector("#vote-title").value = state.title;
  document.querySelector("#closing-date").value = state.closingDate || "2026-12-01";
  document.querySelector("#closing-time").value = state.closesAt ? state.closesAt.slice(11, 19) : "23:59:59";
  document.querySelector("#vote-open").checked = state.isOpen;
  document.querySelector("#settings-form").addEventListener("submit", saveSettings);
  document.querySelector("#close-vote").addEventListener("click", closeVote);
  document.querySelector("#voters-form").addEventListener("submit", registerVoters);
  document.querySelector("#send-invitations").addEventListener("click", sendInvitations);
  document.querySelector("#refresh-state").addEventListener("click", refreshState);
  document.querySelector("#run-audit").addEventListener("click", runAudit);
  document.querySelector("#sync-results").addEventListener("click", syncResults);
}

async function refreshState() {
  try {
    const state = await api("adminState");
    renderDashboard(state);
  } catch (error) {
    showMessage("readiness-message", error.message, true);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const isOpen = document.querySelector("#vote-open").checked;
  const closingDate = document.querySelector("#closing-date").value;
  const closingTime = document.querySelector("#closing-time").value;
  const normalizedTime = closingTime.length === 5 ? `${closingTime}:00` : closingTime;
  const closesAt = closingDate && normalizedTime ? `${closingDate}T${normalizedTime}.000Z` : "";
  showMessage("settings-message", "Enregistrement…");
  try {
    if (isOpen && !closesAt) throw new Error("Saisis l’heure exacte de clôture avant d’ouvrir.");
    if (isOpen && !window.confirm("Confirmer l’ouverture du scrutin ?")) return;
    await api("adminSaveSettings", {
      title: document.querySelector("#vote-title").value,
      closingDate,
      closesAt,
      isOpen,
    });
    await refreshState();
    showMessage("settings-message", isOpen ? "Scrutin ouvert." : "Paramètres enregistrés. Scrutin fermé.");
  } catch (error) {
    showMessage("settings-message", error.message, true);
  }
}

async function closeVote() {
  if (!window.confirm("Clôturer le vote maintenant ?")) return;
  try {
    await api("adminCloseVote");
    await refreshState();
  } catch (error) {
    showMessage("settings-message", error.message, true);
  }
}

async function registerVoters(event) {
  event.preventDefault();
  const lines = document.querySelector("#voter-list").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const voters = lines.map((line) => {
    const separator = line.lastIndexOf("|");
    return separator < 1 ? { name: "", email: "" } : { name: line.slice(0, separator).trim(), email: line.slice(separator + 1).trim() };
  });
  showMessage("voters-message", "Enregistrement…");
  try {
    const result = await api("adminRegisterVoters", { voters });
    document.querySelector("#voter-list").value = "";
    await refreshState();
    showMessage("voters-message", `${result.added} électeur(s) ajouté(s).`);
  } catch (error) {
    showMessage("voters-message", error.message, true);
  }
}

async function sendInvitations() {
  const button = document.querySelector("#send-invitations");
  button.disabled = true;
  showMessage("invites-message", "Envoi des invitations…");
  try {
    const result = await api("adminSendInvitations", { publicBaseUrl: window.location.origin });
    await refreshState();
    showMessage("invites-message", `${result.sent} invitation(s) envoyée(s), ${result.skipped} déjà envoyée(s), ${result.errors} erreur(s), ${result.remaining} en attente.`);
  } catch (error) {
    showMessage("invites-message", error.message, true);
    button.disabled = false;
  }
}

async function runAudit() {
  showMessage("audit-message", "Audit en cours…");
  try {
    const result = await api("adminAudit");
    const audit = result.audit;
    showMessage("audit-message", `${audit.validBallots} bulletin(s) valide(s), ${audit.invalidBallots} invalide(s), écart registre/bulletins : ${audit.ballotStatusDifference}.`);
    await refreshState();
  } catch (error) {
    showMessage("audit-message", error.message, true);
  }
}

async function syncResults() {
  const raw = document.querySelector("#organizer-emails").value;
  const organizerEmails = raw.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean);
  showMessage("report-message", "Création du rapport privé…");
  try {
    await api("adminSyncResults", { organizerEmails });
    await refreshState();
    showMessage("report-message", "Rapport privé créé ou synchronisé.");
  } catch (error) {
    showMessage("report-message", error.message, true);
  }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminSecret = document.querySelector("#admin-secret").value;
  showMessage("login-message", "Vérification…");
  try {
    const state = await api("adminState");
    renderDashboard(state);
  } catch (error) {
    adminSecret = "";
    showMessage("login-message", error.message, true);
  }
});
