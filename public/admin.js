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
  root.innerHTML = `<div class="admin-intro"><p class="eyebrow">LE CLUB MPL 11 · ÉDITION 2026</p><p class="admin-message" id="admin-message" role="status"></p><h1>Scrutin officiel</h1><p>Crée autant de liens individuels que nécessaire. Chaque lien est utilisable une fois et expire après le vote ou à la clôture du scrutin.</p></div>
    <div class="demo-ribbon">MODE RÉEL — les votes officiels sont enregistrés dans Cloudflare D1 et comptés séparément des anciens bulletins de test.</div>
    ${warning}
    <section class="admin-panel"><h2>État du scrutin</h2><div class="live-stats"><p><strong>${state.officialBallots}</strong><span>votes officiels</span></p><p><strong>${state.officialLinks}</strong><span>liens non utilisés</span></p><p><strong>${state.testBallots}</strong><span>anciens tests isolés</span></p></div><p class="field-note">Clôture configurée : ${escapeHtml(closeDate)} · fuseau Abidjan.</p><button class="admin-button secondary" id="refresh-state" type="button">Actualiser l’état</button></section>
    <details class="admin-panel admin-collapsible photo-manager-panel" id="photo-manager-panel" open><summary><span><strong>Gérer les joueurs, alias et photos</strong><small>Répartis les portraits et corrige les alias</small></span><span class="photo-summary-count">${state.remainingPhotoCount ?? state.participantCount ?? 0} photos restantes / ${state.participantCount ?? 0} participants</span></summary><div class="photo-manager-content"><p>Glisse une photo de la galerie sur un participant. Un alias partagé entre plusieurs catégories reçoit la même photo partout. Les ajouts et corrections sont publiés pour les bulletins ouverts.</p><div id="nominee-manager" class="nominee-manager"></div></div></details>
    <section class="admin-panel"><h2>Liens personnels de vote</h2><p>Les liens générés restent disponibles dans cet espace après reconnexion. Tu peux désactiver chaque lien séparément ou en ajouter de nouveaux sans invalider les liens existants. Choisis entre 1 et 1 000 liens par création ; le nombre total n’est pas plafonné.</p><div class="admin-row link-create-row"><label class="field quantity-field" for="link-count">Nombre de liens à ajouter<input id="link-count" type="number" min="1" max="1000" step="1" value="7" /></label><button class="admin-button" id="create-official-links" type="button">Créer les liens</button><span class="admin-message" id="links-message" role="status"></span></div><div id="generated-links" class="generated-links" hidden></div></section>
    <section class="admin-panel"><h2>Résultats officiels</h2><p>Les résultats sont agrégés par catégorie. Les choix individuels ne sont pas dévoilés.</p><div class="admin-row"><button class="admin-button secondary" id="load-results" type="button">Charger les résultats</button><button class="admin-button secondary" id="export-results" type="button" hidden>Exporter en CSV</button></div><div id="results-content" class="admin-results"></div></section>
    <section class="admin-panel"><h2>Clôture</h2><p>La clôture désactive immédiatement les liens encore ouverts.</p><button class="admin-button danger" id="close-vote" type="button" ${state.isOpen ? "" : "disabled"}>Clôturer le scrutin</button><span class="admin-message" id="close-message" role="status"></span></section>
    <p><a href="./">← Retour à la page publique</a></p>`;
  renderLinks(state.links || [], state.closesAt);
  renderNomineeManager(state.participants || [], state.photoLibrary || [], state);
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


function renderNomineeManager(participants, photoLibrary, dashboardState) {
  const target = document.querySelector("#nominee-manager");
  if (!target) return;
  const selectedPhoto = window.selectedLibraryPhotoId || "";
  target.innerHTML = `
    <div class="photo-progress" role="status"><strong>${dashboardState.remainingPhotoCount ?? 0}</strong><span>photos restantes</span><span class="photo-progress-divider">/</span><strong>${dashboardState.participantCount ?? participants.length}</strong><span>participants</span><span class="photo-progress-filled">${dashboardState.assignedParticipantCount ?? 0} photo(s) attribuée(s)</span></div>
    <div class="photo-manager-columns">
      <section class="alias-board"><header><h3>Participants et alias</h3><p>Chaque carte accepte une photo par glisser-déposer.</p></header>
        <div class="alias-board-list">${participants.map((person) => `
          <article class="alias-card" data-alias="${escapeHtml(person.name)}">
            <div class="alias-card-photo">${person.photoUrl ? `<img src="${escapeHtml(person.photoUrl)}" alt="Portrait de ${escapeHtml(person.name)}">` : `<span>${escapeHtml(person.name.trim().slice(0,1).toUpperCase() || "?")}</span>`}</div>
            <div class="alias-card-info"><label>Alias<input class="alias-name-input" maxlength="80" value="${escapeHtml(person.name)}"></label></div>
            <div class="alias-card-actions"><button class="admin-button secondary save-alias" type="button">Corriger l’alias</button><button class="admin-button assign-selected-photo" type="button" ${selectedPhoto ? "" : "disabled"}>Associer la photo choisie</button></div>
            <div class="alias-drop-target" tabindex="0" role="button">Déposer la photo ici</div>
          </article>`).join("") || `<p class="field-note">Aucun participant dans le catalogue.</p>`}</div>
      </section>
      <section class="photo-library-board"><header><div><h3>Galerie des photos reçues</h3><p>${photoLibrary.length} photo(s) dans la galerie. Les portraits ajoutés ici sont carrés et pixelisés pour garder le rendu rétro.</p></div><label class="admin-button secondary add-photo-button">Ajouter des photos<input id="add-participant-photos" type="file" accept="image/*" multiple></label></header>
        <div class="photo-library-grid">${photoLibrary.map((photo) => `
          <article class="library-photo-card ${photo.id === selectedPhoto ? "is-selected" : ""}" draggable="true" data-photo-id="${escapeHtml(photo.id)}" tabindex="0" role="button" aria-label="Photo ${escapeHtml(photo.name)}${photo.assignedAlias ? ", associée à " + escapeHtml(photo.assignedAlias) : ", non attribuée"}">
            ${!photo.assignedAlias ? `<button class="library-photo-delete" type="button" aria-label="Supprimer ${escapeHtml(photo.name)}" title="Supprimer cette photo">×</button>` : ""}
            <div class="photo-gallery-pair">
              <button class="photo-gallery-thumb" type="button" data-preview="original" aria-label="Voir l’original en grand">
                <img src="${photo.originalData || photo.photoData}" alt="" loading="lazy" draggable="false"><small>Original</small>
              </button>
              <button class="photo-gallery-thumb" type="button" data-preview="pixel" aria-label="Voir le pixel art en grand">
                <img src="${photo.photoData}" alt="" loading="lazy" draggable="false"><small>Pixel art</small>
              </button>
            </div>
            <strong>${escapeHtml(photo.name)}</strong>
            <small>${photo.assignedAlias ? "Associée · " + escapeHtml(photo.assignedAlias) : "À attribuer"}</small>
          </article>`).join("") || `<div class="photo-library-empty"><strong>Aucune photo dans la galerie</strong><span>Ajoute les portraits reçus avec le bouton ci-dessus.</span></div>`}</div>
      </section>
    </div>
    <dialog class="photo-preview-dialog" id="photo-preview-dialog" aria-label="Aperçu du portrait">
      <form method="dialog"><button class="photo-preview-close" aria-label="Fermer">×</button></form>
      <h3 class="photo-preview-title"></h3>
      <div class="photo-preview-pair"></div>
    </dialog>`;

  target.querySelectorAll(".library-photo-card").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", card.dataset.photoId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    card.addEventListener("click", (event) => {
      if (event.target.closest(".library-photo-delete,.photo-gallery-thumb")) return;
      window.selectedLibraryPhotoId = card.dataset.photoId;
      renderNomineeManager(participants, photoLibrary, dashboardState);
    });
    card.querySelectorAll(".photo-gallery-thumb").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const photo = photoLibrary.find((item) => item.id === card.dataset.photoId);
      if (photo) openPhotoPreview(photo, button.dataset.preview);
    }));
    card.querySelector(".library-photo-delete")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api("adminDeletePhoto", { photoId: card.dataset.photoId });
        if (window.selectedLibraryPhotoId === card.dataset.photoId) window.selectedLibraryPhotoId = "";
        resultData = null;
        renderDashboard(await api("adminState"));
        managerMessage("Photo supprimée de la galerie.");
      } catch (error) { managerMessage(error.message, true); button.disabled = false; }
    });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); card.click(); } });
  });
  target.querySelectorAll(".alias-card").forEach((card) => {
    const drop = card.querySelector(".alias-drop-target");
    card.querySelector(".save-alias").addEventListener("click", () => saveAlias(card));
    card.querySelector(".assign-selected-photo").addEventListener("click", () => assignPhoto(card, selectedPhoto));
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-dragging"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault(); drop.classList.remove("is-dragging");
      assignPhoto(card, event.dataTransfer?.getData("text/plain"));
    });
    drop.addEventListener("click", () => { if (selectedPhoto) assignPhoto(card, selectedPhoto); });
    drop.addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && selectedPhoto) { event.preventDefault(); assignPhoto(card, selectedPhoto); } });
  });
  target.querySelector("#add-participant-photos").addEventListener("change", (event) => addPhotoFiles([...event.target.files]));
}

function managerMessage(message, error = false) {
  showMessage("admin-message", message, error);
}

async function saveAlias(card) {
  const oldAlias = card.dataset.alias;
  const name = card.querySelector(".alias-name-input").value.trim();
  if (!name) return managerMessage("Un alias ne peut pas être vide.", true);
  const button = card.querySelector(".save-alias");
  button.disabled = true;
  try {
    const result = await api("adminRenameAlias", { oldAlias, name });
    window.selectedLibraryPhotoId = "";
    resultData = null;
    renderDashboard(await api("adminState"));
    managerMessage(`Alias corrigé dans ${result.changed} nomination(s).`);
  } catch (error) { managerMessage(error.message, true); button.disabled = false; }
}

async function assignPhoto(card, photoId) {
  if (!photoId) return managerMessage("Choisis une photo dans la galerie ou dépose-la sur le participant.", true);
  const aliasName = card.dataset.alias;
  const button = card.querySelector(".assign-selected-photo");
  button.disabled = true;
  try {
    const result = await api("adminAssignPhotoToAlias", { photoId, aliasName });
    window.selectedLibraryPhotoId = "";
    resultData = null;
    renderDashboard(await api("adminState"));
    managerMessage(`Photo associée à « ${result.aliasName} » pour ${result.nominations} nomination(s).`);
  } catch (error) { managerMessage(error.message, true); button.disabled = false; }
}

async function addPhotoFiles(files) {
  if (!files.length) return;
  const input = document.querySelector("#add-participant-photos");
  if (input) input.disabled = true;
  let uploaded = 0;
  try {
    for (const file of files) {
      const { originalData, photoData } = await imageDataUrl(file);
      await api("adminAddPhoto", { photoId: crypto.randomUUID(), name: file.name.split(".").slice(0, -1).join(".") || file.name, photoData, originalData });
      uploaded++;
    }
    renderDashboard(await api("adminState"));
    managerMessage(`${uploaded} photo(s) ajoutée(s) à la galerie. Fais glisser chaque portrait vers son alias.`);
  } catch (error) { managerMessage(`${uploaded} photo(s) ajoutée(s). ${error.message}`, true); }
  finally { const nextInput = document.querySelector("#add-participant-photos"); if (nextInput) nextInput.disabled = false; }
}

async function saveNomineeName(row) {
  const name = row.querySelector(".nominee-name-input").value.trim();
  if (!name) return nomineeMessage(row, "Le nom ne peut pas être vide.", true);
  const button = row.querySelector(".save-nominee-name");
  button.disabled = true;
  nomineeMessage(row, "Enregistrement…");
  try {
    await api("adminUpdateNomineeName", { categoryId: row.dataset.categoryId, nomineeId: row.dataset.nomineeId, name });
    resultData = null;
    renderDashboard(await api("adminState"));
    showMessage("login-message", "Nom mis à jour.");
  } catch (error) { nomineeMessage(row, error.message, true); button.disabled = false; }
}

async function imageDataUrl(file) {
  if (!file.type.startsWith("image/")) throw new Error("Choisis un fichier image.");
  const source = await createImageBitmap(file);
  const size = 384;
  const originalCanvas = document.createElement("canvas");
  originalCanvas.width = size; originalCanvas.height = size;
  const originalContext = originalCanvas.getContext("2d");
  const scale = Math.max(size / source.width, size / source.height);
  const width = source.width * scale, height = source.height * scale;
  originalContext.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
  source.close?.();
  const pixelCanvas = document.createElement("canvas");
  pixelCanvas.width = 48; pixelCanvas.height = 48;
  const pixelContext = pixelCanvas.getContext("2d");
  pixelContext.imageSmoothingEnabled = false;
  pixelContext.drawImage(originalCanvas, 0, 0, 48, 48);
  const artCanvas = document.createElement("canvas");
  artCanvas.width = size; artCanvas.height = size;
  const artContext = artCanvas.getContext("2d");
  artContext.imageSmoothingEnabled = false;
  artContext.drawImage(pixelCanvas, 0, 0, size, size);
  return {
    originalData: originalCanvas.toDataURL("image/webp", 0.84),
    photoData: artCanvas.toDataURL("image/webp", 0.9),
  };
}

async function uploadNomineePhoto(row, file) {
  const drop = row.querySelector(".nominee-dropzone");
  drop.classList.add("is-uploading");
  nomineeMessage(row, "Préparation et envoi de la photo…");
  try {
    const { photoData } = await imageDataUrl(file);
    await api("adminSetNomineePhoto", { categoryId: row.dataset.categoryId, nomineeId: row.dataset.nomineeId, photoData });
    resultData = null;
    renderDashboard(await api("adminState"));
    showMessage("login-message", "Photo attribuée au nominé.");
  } catch (error) { nomineeMessage(row, error.message, true); drop.classList.remove("is-uploading"); }
}

function openPhotoPreview(photo, initialView = "pixel") {
  const dialog = document.querySelector("#photo-preview-dialog");
  if (!dialog) return;
  dialog.querySelector(".photo-preview-title").textContent = photo.name;
  const pair = dialog.querySelector(".photo-preview-pair");
  pair.innerHTML = [
    ["originalData", "Photo originale"],
    ["photoData", "Version pixel art"],
  ].map(([key, label]) => {
    const src = photo[key] || photo.photoData;
    return `<figure class="${(key === "originalData" && initialView === "original") || (key === "photoData" && initialView === "pixel") ? "is-focused" : ""}">
      <img src="${src}" alt="${escapeHtml(label)} — ${escapeHtml(photo.name)}">
      <figcaption>${label}</figcaption>
    </figure>`;
  }).join("");
  if (!dialog.open) dialog.showModal();
}
