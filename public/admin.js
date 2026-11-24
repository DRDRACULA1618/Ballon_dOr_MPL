const root = document.querySelector("#admin-root");
let adminSecret = "";
let state = null;
let resultData = null;

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

function renderLinks(links, expiresAt) {
  const section = document.querySelector('#generated-links');
  if (!section) return;
  section.hidden = false;
  const deadline = expiresAt ? new Date(expiresAt).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' }) : 'date de clôture';
  const statuses = {
    available: ['✓', 'Disponible', 'available'],
    used: ['✕', 'Déjà utilisé', 'inactive'],
    disabled: ['✕', 'Désactivé par l’organisateur', 'inactive'],
    expired: ['✕', 'Expiré', 'inactive'],
    closed: ['✕', 'Scrutin clôturé', 'inactive'],
    unrecoverable: ['!', 'Ancien lien : URL non récupérable', 'unrecoverable'],
  };
  section.innerHTML = '<h3>Historique des liens personnels</h3><p class="field-note">Les liens sont conservés ici et restent consultables après reconnexion. Chaque lien ne permet qu’un seul vote et expire après utilisation ou à la clôture du scrutin (' + escapeHtml(deadline) + ', heure d’Abidjan). Les liens ne sont pas envoyés par e-mail. Une croix rouge indique un lien inutilisable.</p>' +
    (links.length ? '<div class="generated-links-grid">' + links.map((item) => {
      const status = statuses[item.status] || statuses.unrecoverable;
      const url = item.url ? '<input readonly aria-label="Lien de ' + escapeHtml(item.name) + '" value="' + escapeHtml(item.url) + '">' : '<p class="link-unavailable">' + (item.status === 'unrecoverable' ? 'Ce lien a été créé avant la sauvegarde sécurisée des clés. Son adresse ne peut pas être restaurée.' : 'Aucun lien actif à partager.') + '</p>';
      const copy = item.url ? '<button class="admin-button secondary copy-link" type="button">Copier</button>' : '';
      const disable = ['available', 'unrecoverable'].includes(item.status) ? '<button class="admin-button danger disable-link" data-link-id="' + escapeHtml(item.id) + '" type="button">Désactiver</button>' : '';
      const expiry = new Date(item.expiresAt).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
      return '<article class="generated-link-card"><div class="generated-link-top"><strong>' + escapeHtml(item.name) + '</strong><span class="link-status ' + status[2] + '"><span aria-hidden="true">' + status[0] + '</span> ' + status[1] + '</span></div><div class="generated-link-url">' + url + '</div><div class="generated-link-bottom"><small>Expire le ' + escapeHtml(expiry) + ' · Abidjan</small><div class="generated-link-actions">' + copy + disable + '</div></div></article>';
    }).join('') + '</div>' : '<p class="field-note">Aucun lien personnel n’a encore été créé.</p>');
  section.querySelectorAll('.copy-link').forEach((button) => button.addEventListener('click', async () => {
    const input = button.closest('.generated-link-card').querySelector('input');
    try { await navigator.clipboard.writeText(input.value); button.textContent = 'Copié'; }
    catch { input.select(); button.textContent = 'Sélectionne puis Ctrl+C'; }
  }));
  section.querySelectorAll('.disable-link').forEach((button) => button.addEventListener('click', () => disableOfficialLink(button.dataset.linkId)));
}
function renderResults(data) {
  resultData = data;
  const target = document.querySelector("#results-content");
  if (!target) return;
  target.innerHTML = `<p class="field-note">${data.totalBallots} bulletin(s) officiel(s) comptabilisé(s). Les réponses individuelles ne sont pas affichées.</p>${data.categories.map((category) => `<section class="result-group"><h3>${escapeHtml(category.title)}</h3>${category.nominees.map((nominee) => `<div class="result-line"><span>${escapeHtml(nominee.name)}</span><strong>${nominee.votes}</strong></div>`).join("")}</section>`).join("")}`;
  document.querySelector("#export-results").hidden = false;
}

function renderDashboard(nextState, links = null) {
  state = nextState;
  const warning = state.pending?.length
    ? `<aside class="notice"><span class="notice-icon">!</span><div><strong>Le catalogue comporte des éléments à vérifier.</strong><ul>${state.pending.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><p>Confirme les catégories et les noms avant de partager les liens du scrutin.</p></div></aside>`
    : `<p class="status-good">Catalogue chargé · ${state.categoryCount} catégories · ${state.nominationCount} nominés.</p>`;
  const closeDate = state.closesAt ? new Date(state.closesAt).toLocaleString("fr-FR", { timeZone:"Africa/Abidjan" }) : "à définir";
  root.innerHTML = `<div class="admin-intro"><p class="eyebrow">LE CLUB MPL 11 · ÉDITION 2026</p><h1>Scrutin officiel</h1><p>Crée autant de liens individuels que nécessaire. Chaque lien est utilisable une fois et expire après le vote ou à la clôture du scrutin.</p></div>
    <div class="demo-ribbon">MODE RÉEL — les votes officiels sont enregistrés dans Cloudflare D1 et comptés séparément des anciens bulletins de test.</div>
    ${warning}
    <section class="admin-panel"><h2>État du scrutin</h2><div class="live-stats"><p><strong>${state.officialBallots}</strong><span>votes officiels</span></p><p><strong>${state.officialLinks}</strong><span>liens non utilisés</span></p><p><strong>${state.testBallots}</strong><span>anciens tests isolés</span></p></div><p class="field-note">Clôture configurée : ${escapeHtml(closeDate)} · fuseau Abidjan.</p><button class="admin-button secondary" id="refresh-state" type="button">Actualiser l’état</button></section>
    <section class="admin-panel"><h2>Liens personnels de vote</h2><p>Les liens générés restent disponibles dans cet espace après reconnexion. Tu peux désactiver chaque lien séparément ou en ajouter de nouveaux sans invalider les liens existants. Choisis entre 1 et 1 000 liens par création ; le nombre total n’est pas plafonné.</p><div class="admin-row link-create-row"><label class="field quantity-field" for="link-count">Nombre de liens à ajouter<input id="link-count" type="number" min="1" max="1000" step="1" value="7" /></label><button class="admin-button" id="create-official-links" type="button">Créer les liens</button><span class="admin-message" id="links-message" role="status"></span></div><div id="generated-links" class="generated-links" hidden></div></section>
    <section class="admin-panel"><h2>Résultats officiels</h2><p>Les résultats sont agrégés par catégorie. Les choix individuels ne sont pas dévoilés.</p><div class="admin-row"><button class="admin-button secondary" id="load-results" type="button">Charger les résultats</button><button class="admin-button secondary" id="export-results" type="button" hidden>Exporter en CSV</button></div><div id="results-content" class="admin-results"></div></section>
    <section class="admin-panel"><h2>Clôture</h2><p>La clôture désactive immédiatement les liens encore ouverts.</p><button class="admin-button danger" id="close-vote" type="button" ${state.isOpen ? "" : "disabled"}>Clôturer le scrutin</button><span class="admin-message" id="close-message" role="status"></span></section>
    <p><a href="./">← Retour à la page publique</a></p>`;
  renderLinks(state.links || [], state.closesAt);
  if (resultData) renderResults(resultData);
  document.querySelector("#refresh-state").addEventListener("click", refreshState);
  document.querySelector("#create-official-links").addEventListener("click", createOfficialLinks);
  document.querySelector("#load-results").addEventListener("click", loadResults);
  document.querySelector("#export-results").addEventListener("click", exportResults);
  document.querySelector("#close-vote").addEventListener("click", closeVote);
}

async function refreshState() {
  try { renderDashboard(await api("adminState")); }
  catch (error) { showMessage("login-message", error.message, true); }
}
async function createOfficialLinks() {
  const input = document.querySelector('#link-count');
  const count = Number(input.value);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
    showMessage('links-message', 'Choisis un nombre entre 1 et 1 000.', true);
    return;
  }
  const button = document.querySelector('#create-official-links');
  button.disabled = true;
  showMessage('links-message', 'Création des liens…');
  try {
    await api('adminCreateOfficialLinks', { count });
    resultData = null;
    renderDashboard(await api('adminState'));
    showMessage('links-message', count + ' lien(s) ajouté(s). Ils sont conservés dans cet espace.');
  } catch (error) {
    showMessage('links-message', error.message, true);
    button.disabled = false;
  }
}

async function disableOfficialLink(linkId) {
  if (!window.confirm('Désactiver ce lien ? Il ne pourra plus être utilisé pour voter.')) return;
  try {
    await api('adminDisableOfficialLink', { linkId });
    resultData = null;
    renderDashboard(await api('adminState'));
    showMessage('links-message', 'Le lien a été désactivé.');
  } catch (error) {
    showMessage('links-message', error.message, true);
  }
}
async function loadResults() {
  try { renderResults(await api("adminResults")); }
  catch (error) { showMessage("login-message", error.message, true); }
}
function exportResults() {
  if (!resultData) return;
  const rows = [["Catégorie", "Nominé", "Votes"]];
  for (const category of resultData.categories) for (const nominee of category.nominees) rows.push([category.title, nominee.name, nominee.votes]);
  const csv = "\uFEFF" + rows.map((row) => row.map((value) => `"${String(value).replaceAll('"','""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "resultats-officiels-mpl.csv";
  link.click();
  URL.revokeObjectURL(url);
}
async function closeVote() {
  if (!window.confirm("Clôturer le scrutin maintenant ? Les liens encore ouverts cesseront de fonctionner.")) return;
  const button = document.querySelector("#close-vote");
  button.disabled = true;
  try { await api("adminCloseVote"); resultData = null; renderDashboard(await api("adminState")); }
  catch (error) { showMessage("close-message", error.message, true); button.disabled = false; }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminSecret = document.querySelector("#admin-secret").value;
  showMessage("login-message", "Vérification…");
  try { renderDashboard(await api("adminState")); }
  catch (error) { adminSecret = ""; showMessage("login-message", error.message, true); }
});
