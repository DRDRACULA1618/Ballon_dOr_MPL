const root = document.querySelector("#admin-root");
let adminSecret = "";
let state = null;

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

function showMessage(id, message, error = false) {
  const node = document.querySelector(`#${id}`);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", error);
  node.classList.add("visible");
}

function renderDashboard(nextState) {
  state = nextState;
  const pending = state.pending?.length
    ? `<aside class="notice"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Le catalogue contient des points à valider pour le scrutin officiel.</strong><p>Le test ci-dessous utilise le catalogue actuel et reste séparé des votes officiels.</p></div></aside>`
    : `<p class="status-good">Catalogue prêt · ${state.categoryCount} catégories · ${state.nominationCount} nominations.</p>`;
  const latest = state.lastTestBallot
    ? `<p class="field-note">Dernier vote test enregistré : ${escapeHtml(new Date(state.lastTestBallot.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }))}. Reçu : <code>${escapeHtml(state.lastTestBallot.id)}</code></p>`
    : `<p class="field-note">Aucun bulletin test enregistré pour le moment.</p>`;

  root.innerHTML = `<div class="admin-intro"><p class="eyebrow">MPL Ballin’ d’Or 2026</p><h1>Test du vote</h1><p>Cette page permet de vérifier le parcours et l’enregistrement dans D1. Le lien créé est un lien de test à usage unique, valable une heure.</p></div>
    <div class="demo-ribbon">MODE TEST — ces bulletins sont marqués comme tests et ne doivent pas être utilisés pour le scrutin officiel.</div>
    ${pending}
    <section class="admin-panel"><h2>État du stockage</h2><p>Base Cloudflare D1 reliée au site sous le nom <code>DB</code>.</p><p><strong>${state.testBallots}</strong> bulletin(s) test enregistré(s) · période de test ${state.isOpen && state.testMode ? "ouverte" : "fermée"}.</p>${latest}<button class="admin-button secondary" id="refresh-state" type="button">Actualiser l’état</button></section>
    <section class="admin-panel"><h2>Créer un lien pour le vote test</h2><p>Le lien est généré ici et n’est envoyé à personne. Ouvre-le dans un autre onglet pour soumettre un vrai bulletin de test enregistré dans D1.</p><label class="field">Nom de test<input id="test-name" maxlength="100" value="Vote test MPL" /></label><div class="admin-row"><button class="admin-button" id="create-test-link" type="button">Créer mon lien test</button><span class="admin-message" id="link-message" role="status"></span></div><label class="field" id="link-field" hidden>Lien de test<input id="test-link" type="url" readonly /></label><div class="admin-row" id="link-actions" hidden><button class="admin-button secondary" id="copy-test-link" type="button">Copier le lien</button><a class="admin-button" id="open-test-link" target="_blank" rel="noopener noreferrer">Ouvrir le lien</a></div></section>
    <section class="admin-panel"><h2>Clôturer le test</h2><p>La clôture désactive les liens de test encore ouverts.</p><button class="admin-button danger" id="close-test" type="button" ${state.isOpen && state.testMode ? "" : "disabled"}>Clôturer la période de test</button><span class="admin-message" id="close-message" role="status"></span></section>
    <p><a href="./">← Retour au site</a></p>`;

  document.querySelector("#refresh-state").addEventListener("click", refreshState);
  document.querySelector("#create-test-link").addEventListener("click", createTestLink);
  document.querySelector("#copy-test-link").addEventListener("click", copyTestLink);
  document.querySelector("#close-test").addEventListener("click", closeTest);
}

async function refreshState() {
  try {
    renderDashboard(await api("adminState"));
  } catch (error) {
    showMessage("login-message", error.message, true);
  }
}

async function createTestLink() {
  const button = document.querySelector("#create-test-link");
  button.disabled = true;
  showMessage("link-message", "Création du lien…");
  try {
    const result = await api("adminCreateTestLink", { name: document.querySelector("#test-name").value });
    document.querySelector("#test-link").value = result.testUrl;
    document.querySelector("#link-field").hidden = false;
    document.querySelector("#link-actions").hidden = false;
    document.querySelector("#open-test-link").href = result.testUrl;
    showMessage("link-message", "Lien créé. Il expire dans une heure ou après le vote.");
    state = await api("adminState");
    const linkField = document.querySelector("#link-field");
    const linkActions = document.querySelector("#link-actions");
    const linkValue = document.querySelector("#test-link").value;
    renderDashboard(state);
    document.querySelector("#test-link").value = linkValue;
    document.querySelector("#link-field").hidden = false;
    document.querySelector("#link-actions").hidden = false;
    document.querySelector("#open-test-link").href = linkValue;
    showMessage("link-message", "Lien créé. Il expire dans une heure ou après le vote.");
  } catch (error) {
    showMessage("link-message", error.message, true);
    button.disabled = false;
  }
}

async function copyTestLink() {
  const value = document.querySelector("#test-link").value;
  try {
    await navigator.clipboard.writeText(value);
    showMessage("link-message", "Lien copié. Ouvre-le dans un nouvel onglet pour voter.");
  } catch {
    document.querySelector("#test-link").select();
    showMessage("link-message", "Sélectionne le lien puis copie-le avec Ctrl+C.");
  }
}

async function closeTest() {
  const button = document.querySelector("#close-test");
  button.disabled = true;
  try {
    await api("adminCloseVote");
    renderDashboard(await api("adminState"));
  } catch (error) {
    showMessage("close-message", error.message, true);
    button.disabled = false;
  }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminSecret = document.querySelector("#admin-secret").value;
  showMessage("login-message", "Vérification…");
  try {
    renderDashboard(await api("adminState"));
  } catch (error) {
    adminSecret = "";
    showMessage("login-message", error.message, true);
  }
});
