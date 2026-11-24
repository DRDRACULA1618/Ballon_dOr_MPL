import { ballot } from "./data.js";

const app = document.querySelector("#app");
const params = new URLSearchParams(window.location.search);
const demoMode = false;
const sessionKey = "mpl-vote-session";
const demoSubmittedKey = "mpl-preview-vote-submitted";
let inviteToken = "";
let sessionToken = sessionStorage.getItem(sessionKey) || "";

const fragment = window.location.hash.match(/^#t=([^&]+)/);
if (fragment) {
  try { inviteToken = decodeURIComponent(fragment[1]); } catch { inviteToken = ""; }
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
}
if (sessionToken) inviteToken = "";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

async function api(action, payload = {}) {
  const response = await fetch("/api/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.message || "La requête n’a pas abouti.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function hashName(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function avatarSvg(name, key) {
  const hash = hashName(`${key}-${name}`);
  const palettes = [
    ["#e8aa8c", "#272222", "#8d6c2f", "#d7ca9a"],
    ["#b87857", "#171a1d", "#725729", "#d7b176"],
    ["#84513f", "#241b18", "#8c5739", "#e1b894"],
    ["#d49a75", "#3a2b23", "#6a642e", "#c6d1a0"],
    ["#704735", "#121416", "#9a7138", "#d8b98b"],
    ["#c18865", "#6b4031", "#7b5e3c", "#d8c5a8"],
  ];
  const [skin, hair, shirt, trim] = palettes[hash % palettes.length];
  const id = `av-${hash.toString(16)}-${key}`;
  const hairstyles = [
    `<path d="M23 35c-3-18 7-28 20-28 14 0 22 10 19 28l-6-5-3-11c-7 6-18 8-28 6l-2 10z" fill="${hair}"/>`,
    `<path d="M23 35c-4-16 5-28 20-28 15 0 23 11 19 29l-6-5-2-12c-7 5-18 7-29 6z" fill="${hair}"/><path d="M22 26c3-9 9-15 18-17" fill="none" stroke="#fff" stroke-opacity=".15" stroke-width="3"/>`,
    `<path d="M24 32c-2-15 6-25 19-25 14 0 21 10 19 24l-7-5-3-8c-7 5-17 6-27 4z" fill="${hair}"/><path d="M25 18c-3 4-4 9-3 15l-4-3c-2-10 1-19 7-25l2 6z" fill="${hair}"/>`,
    `<path d="M23 35c-4-17 5-29 20-29 14 0 23 11 19 28l-7-5-3-12c-8 6-18 8-28 6z" fill="${hair}"/><circle cx="25" cy="14" r="3" fill="${hair}"/><circle cx="34" cy="8" r="3" fill="${hair}"/><circle cx="44" cy="6" r="3" fill="${hair}"/><circle cx="54" cy="10" r="3" fill="${hair}"/>`,
  ];
  const hairstyle = hairstyles[(hash >>> 4) % hairstyles.length];
  return `<svg viewBox="0 0 84 84" role="img" aria-label="Avatar fictif de ${escapeHtml(name)}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f5e6bd"/><stop offset="1" stop-color="#9e702e"/></linearGradient></defs><circle cx="42" cy="42" r="42" fill="url(#${id})"/><path d="M9 84c2-18 12-28 27-31h12c16 3 25 13 28 31" fill="${shirt}"/><path d="m34 55 8 10 8-10 4 4-7 9H37l-7-9z" fill="${trim}"/><path d="M33 47h18v11c-4 7-14 7-18 0z" fill="${skin}"/><ellipse cx="42" cy="35" rx="18" ry="22" fill="${skin}"/>${hairstyle}<path d="M33 38c2-2 4-2 6 0M46 38c2-2 4-2 6 0" fill="none" stroke="#382b25" stroke-width="1.6" stroke-linecap="round"/><circle cx="36" cy="40" r="1.15" fill="#231d1b"/><circle cx="49" cy="40" r="1.15" fill="#231d1b"/><path d="M38 48c2 2 6 2 8 0" fill="none" stroke="#854c3d" stroke-width="1.5" stroke-linecap="round"/><path d="M33 59l9 7 9-7" fill="none" stroke="#fff" stroke-opacity=".52" stroke-width="1.5"/></svg>`;
}

function topbar(label = "Vote des supporters", title = ballot.title, homeHref = "./") {
  const isBallot = label === "Vote des supporters" || label === "Aperçu partagé";
  return `<header class="site-topbar"><a class="club-wordmark" href="${homeHref}"><span class="wordmark-name">Le CLUB MPL 11</span><span class="wordmark-edition">MPL BALLIN’ D’OR · 2026</span></a>${isBallot ? `<nav class="club-nav" aria-label="Navigation principale"><a href="#categories">Catégories</a><a href="#calendrier">Calendrier</a><a href="#consignes">Consignes</a></nav><a class="topbar-submit btn-focus" href="#soumission"><span class="topbar-count">Bulletin · 0/0</span><span aria-hidden="true">↘</span></a>` : `<span class="topbar-label">${escapeHtml(label)}</span>`}</header>`;
}

function renderState({ icon = "✦", title, message, error = "" }) {
  app.innerHTML = `${topbar()}<main class="state-view"><div class="state-icon" aria-hidden="true">${icon}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${error ? `<p class="inline-error">${escapeHtml(error)}</p>` : ""}</main><footer class="site-footer"><span>Les résultats sont agrégés. L’organisateur peut vérifier la participation depuis le registre privé.</span><a href="./admin.html">Espace organisateur</a></footer>`;
}

function renderDemoReceipt() {
  app.innerHTML = `${topbar("Aperçu terminé", ballot.title, "./?demo=1")}<main class="state-view demo-receipt"><div class="state-icon" aria-hidden="true">✓</div><p class="section-kicker">MPL BALLIN’ D’OR 2026</p><h1>Vote soumis</h1><p>Merci pour ta participation. Dans le scrutin réel, ce lien personnel serait maintenant désactivé et ne permettrait plus de voter une seconde fois.</p><div class="demo-ribbon">Confirmation simulée — aucun vote réel n’a été enregistré.</div></main><footer class="site-footer"><span>Aperçu public — le bulletin est fermé dans cet onglet.</span></footer>`;
}

function playBallAnimation(direction) {
  return new Promise((resolve) => {
    const isOutro = direction === "outro";
    app.innerHTML = `<section class="cinematic-screen ${isOutro ? "cinematic-outro" : "cinematic-intro"}" aria-label="${isOutro ? "Animation de fin du vote" : "Animation de bienvenue"}"><div class="cinematic-stars" aria-hidden="true"></div><div class="cinematic-light" aria-hidden="true"></div><div class="cinematic-copy"><p>${isOutro ? "MPL · BALLIN’ D’OR 2026" : "CÉRÉMONIE DE REMISE"}</p><h1>${isOutro ? "Merci pour ton vote" : "Le CLUB MPL 11"}</h1><span>${isOutro ? "TON CHOIX ENTRE DANS L’HISTOIRE" : "UN TROPHÉE · SEPT VOTES"}</span></div><div class="ball-journey ${isOutro ? "ball-journey-out" : "ball-journey-in"}" aria-hidden="true"><div class="ball-shadow"></div><svg class="cinematic-ball" viewBox="0 0 220 220" role="img" aria-label="Ballon d’Or doré"><defs>
<radialGradient id="ballSurface" cx="32%" cy="23%" r="78%"><stop stop-color="#fff9dc"/><stop offset=".16" stop-color="#f9dc8b"/><stop offset=".39" stop-color="#bf7b19"/><stop offset=".58" stop-color="#40220a"/><stop offset=".73" stop-color="#e8ae3d"/><stop offset=".88" stop-color="#7a470d"/><stop offset="1" stop-color="#170d06"/></radialGradient>
<linearGradient id="goldFacet" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff6c8"/><stop offset=".25" stop-color="#dc9c2c"/><stop offset=".53" stop-color="#57300b"/><stop offset=".79" stop-color="#f3c454"/><stop offset="1" stop-color="#8a4d0d"/></linearGradient>
<linearGradient id="goldRim" x1=".1" y1="0" x2=".9" y2="1"><stop stop-color="#fff9cf"/><stop offset=".3" stop-color="#f0c45a"/><stop offset=".68" stop-color="#8a5116"/><stop offset="1" stop-color="#fff2b2"/></linearGradient>
<radialGradient id="ballGlare" cx="0" cy="0" r="1" gradientTransform="translate(65 54) rotate(50) scale(69 44)" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity=".96"/><stop offset=".22" stop-color="#fff3bf" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<clipPath id="ballClip"><circle cx="110" cy="110" r="91"/></clipPath>
<filter id="ballGlow"><feGaussianBlur stdDeviation="5"/></filter></defs>
<circle cx="110" cy="110" r="99" fill="#f9c956" opacity=".14" filter="url(#ballGlow)"/>
<circle cx="110" cy="110" r="93" fill="url(#ballSurface)" stroke="url(#goldRim)" stroke-width="3"/>
<g clip-path="url(#ballClip)" stroke="url(#goldRim)" stroke-width="3" stroke-linejoin="round">
<path fill="url(#goldFacet)" d="m110 71 32 21-12 37H91L78 92z"/>
<path fill="#251507" d="m110 71 2-50 37-16 31 27-8 45-30 15z"/>
<path fill="url(#goldFacet)" d="m78 92-43-12-20-36 25-32 43 7 27 52z"/>
<path fill="#39200a" d="m91 129-31 29-43-7-16-38 22-37 43 16z"/>
<path fill="url(#goldFacet)" d="m130 129 31 29 43-7 16-38-22-37-43 16z"/>
<path fill="#4a2809" d="m91 129 39 0 19 40-18 40-40 15-34-35 3-31z"/>
<path fill="url(#goldFacet)" d="m110 71 32 21-12 37H91L78 92z" opacity=".24"/>
</g>
<ellipse cx="75" cy="53" rx="45" ry="23" fill="url(#ballGlare)" transform="rotate(-30 75 53)"/>
<path d="M48 75c11-27 36-45 63-47" fill="none" stroke="#fff9d8" stroke-opacity=".78" stroke-width="3" stroke-linecap="round"/>
<circle cx="110" cy="110" r="91" fill="none" stroke="#fff7cf" stroke-opacity=".42" stroke-width="1"/>
<g fill="#fff4c4" opacity=".9"><circle cx="57" cy="42" r="2"/><circle cx="144" cy="35" r="1.7"/><circle cx="169" cy="113" r="1.5"/><circle cx="72" cy="174" r="1.4"/></g>
</svg></div><button class="skip-animation" type="button">Passer l’animation</button></section>`;
    const screen = app.querySelector(".cinematic-screen");
    const skip = app.querySelector(".skip-animation");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      skip.removeEventListener("click", finish);
      window.removeEventListener("keydown", onKeyDown);
      screen.classList.add("cinematic-leaving");
      window.setTimeout(resolve, reducedMotion ? 80 : 420);
    };
    const onKeyDown = (event) => { if (event.key === "Escape") finish(); };
    skip.addEventListener("click", finish);
    window.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(finish, reducedMotion ? 850 : (isOutro ? 2700 : 2850));
  });
}

function formatDeadline(value) {
  if (!value) return "Clôture le 1er décembre 2026 à 23:59:59 GMT";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date de clôture à définir";
  return `Clôture le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium", timeZone: "Africa/Abidjan" }).format(date)} (Abidjan)`;
}

function renderVerification() {
  app.innerHTML = `${topbar("Accès électeur")}<main class="state-view auth-view"><div class="state-icon" aria-hidden="true">✉</div><h1>Ouvre ton bulletin</h1><p>Ce lien personnel permet un seul vote. Il expirera après la soumission ou à la fin de la période du test.</p><button class="primary-button" id="open-ballot" type="button">Ouvrir mon bulletin <span class="button-arrow" aria-hidden="true">→</span></button><p class="form-message" id="auth-message" role="status"></p><p class="auth-note">Garde ce lien privé. Une fois le bulletin soumis, il ne pourra plus servir.</p></main><footer class="site-footer"><span>Un seul bulletin par lien personnel.</span></footer>`;

  const openButton = document.querySelector("#open-ballot");
  const message = document.querySelector("#auth-message");
  openButton.addEventListener("click", async () => {
    openButton.disabled = true;
    openButton.textContent = "Ouverture du bulletin…";
    message.classList.remove("visible", "error");
    try {
      const result = await api("claimInvite", { token: inviteToken });
      sessionToken = result.session;
      sessionStorage.setItem(sessionKey, sessionToken);
      inviteToken = "";
      await loadBallot();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("visible", "error");
      openButton.disabled = false;
      openButton.innerHTML = 'Réessayer <span class="button-arrow" aria-hidden="true">→</span>';
    }
  });
}

function renderCategory(item, index) {
  const nomineeCards = item.nominees.map((candidate, nomineeIndex) => {
    const ordinal = String(nomineeIndex + 1).padStart(2, "0");
    return `<label class="candidate nominee-glass"><input type="radio" name="${item.id}" value="${candidate.id}" aria-label="${escapeHtml(candidate.name)} — ${escapeHtml(item.title)}"><span class="candidate-inner"><span class="nominee-copy"><span class="nominee-tag">NOMINÉ · ${ordinal}</span><span class="candidate-name">${escapeHtml(candidate.name)}</span><span class="nominee-subtitle">${escapeHtml(item.title)}</span></span><span class="pick-mark" aria-hidden="true">✓</span></span><span class="nominee-footer"><span class="nominee-action">Sélectionner ce nominé</span><span class="nominee-selected">Sélectionné sur votre bulletin</span></span></label>`;
  }).join("");
  return `<section class="category-card" aria-labelledby="title-${item.id}"><div class="category-head"><div class="category-title-wrap"><span class="category-number">${String(index + 1).padStart(2, "0")}</span><div><h3 class="category-title" id="title-${item.id}">${escapeHtml(item.title)}</h3><p class="category-prompt">Choisissez un nominé dans cette catégorie</p></div></div><span class="category-state" data-state="${item.id}">Sélection requise</span></div><div class="candidate-grid">${nomineeCards}</div></section>`;
}

function renderBallot(data, isDemo = false) {
  const categories = data.categories;
  const nomineeCount = categories.reduce((total, category) => total + category.nominees.length, 0);
  const previewRibbon = `<div class="demo-ribbon">Aperçu partagé — aucun vote ne sera envoyé ni enregistré. Les catégories et nominations pourront évoluer avant l’ouverture.</div>`;
  const footer = isDemo
    ? `<footer class="site-footer"><span>Aperçu public — aucun bulletin n’est collecté.</span></footer>`
    : `<footer class="site-footer"><span>Les bulletins sont conservés dans un fichier maître privé.</span><a href="./admin.html">Espace organisateur</a></footer>`;
  const heroBallArt = `<div class="hero-ball-stage" aria-hidden="true"><div class="hero-ball-halo"></div><div class="hero-ball-orbit"></div><svg class="hero-ball" viewBox="0 0 220 220"><defs><radialGradient id="heroBallSurface" cx="32%" cy="25%"><stop stop-color="#fff"/><stop offset=".48" stop-color="#f5f5f3"/><stop offset=".82" stop-color="#d6d8dc"/><stop offset="1" stop-color="#858b94"/></radialGradient><clipPath id="heroBallClip"><circle cx="110" cy="110" r="91"/></clipPath></defs><circle cx="110" cy="110" r="92" fill="url(#heroBallSurface)" stroke="#f5f5f5" stroke-width="2"/><g clip-path="url(#heroBallClip)" fill="#090a0c" stroke="#f7f7f5" stroke-width="5" stroke-linejoin="round"><path d="m110 68 28 20-11 33h-34L82 88z"/><path d="m110 68 8-48 35-20 27 27-11 42-31 19z"/><path d="m82 88-46-9-23-34 20-35 42-4 25 27z"/><path d="m93 121-28 33-43 3-18-34 15-40 40-4z"/><path d="m127 121 28 33 43 3 18-34-15-40-40-4z"/><path d="m93 121 34 0 17 39-13 41-39 15-28-30 1-42z"/></g><ellipse cx="79" cy="53" rx="38" ry="17" fill="#fff" opacity=".36" transform="rotate(-33 79 53)"/><circle cx="110" cy="110" r="91" fill="none" stroke="rgba(255,255,255,.34)" stroke-width="1"/></svg><span class="hero-art-caption">LE PALMARÈS MPL · 2026</span></div>`;
  app.innerHTML = `${topbar(isDemo ? "Aperçu partagé" : "Vote des supporters", data.title || ballot.title, isDemo ? "./?demo=1" : "./")}<section id="accueil" class="hero"><div class="hero-inner"><div class="hero-copy"><p class="eyebrow">LE RENDEZ-VOUS DES CHAMPIONS</p><h1>Une saison.<br><span>Des légendes.</span></h1><p class="hero-subtitle">Supporters du CLUB MPL 11, exprimez votre voix pour élire les figures marquantes de la saison. Chaque bulletin demeure strictement confidentiel jusqu’à la proclamation officielle.</p><div class="hero-meta"><span><i class="meta-dot"></i>${categories.length} catégories</span><span><i class="meta-dot"></i>${nomineeCount} nominations</span><span class="deadline-meta">${escapeHtml(formatDeadline(data.closesAt))}</span></div></div>${heroBallArt}</div></section><section class="hero-info" aria-label="Calendrier et consignes"><article id="calendrier" class="liquid-glass info-panel"><p class="info-kicker">CALENDRIER OFFICIEL</p><h2>Clôture du scrutin</h2><p class="info-date">${escapeHtml(formatDeadline(data.closesAt))}</p><p class="info-copy">Les bulletins personnels sont accessibles pendant la période de vote indiquée.</p></article><article id="consignes" class="liquid-glass info-panel"><p class="info-kicker blue">CONSIGNES DE VOTE</p><h2>Un choix par catégorie</h2><ul><li>Choisis un nominé dans chaque catégorie.</li><li>Vérifie tes choix avant de soumettre le bulletin.</li><li>Après soumission, ton lien ne pourra plus être réutilisé.</li></ul></article></section><main class="main-wrap">${isDemo ? previewRibbon : ""}<section class="progress-panel" aria-label="Progression du bulletin"><div class="progress-copy"><span class="progress-title">Ton palmarès</span><span id="progress-count" class="progress-count">0 catégorie sur ${categories.length} complétée</span></div><div class="progress-track" role="progressbar" aria-label="Catégories complétées" aria-valuemin="0" aria-valuemax="${categories.length}" aria-valuenow="0"><div id="progress-fill" class="progress-fill"></div></div><span id="progress-badge" class="progress-badge">0 / ${categories.length}</span></section><div class="section-heading"><div><p class="section-kicker">LE CHOIX DES SUPPORTERS</p><h2>Choisissez vos lauréats par catégorie</h2><p>Sélectionnez un nominé dans chaque catégorie avant de valider votre bulletin.</p></div><span class="section-counter">${String(categories.length).padStart(2, "0")} CATÉGORIES</span></div><form id="vote-form" novalidate><div class="category-list">${categories.map(renderCategory).join("")}</div><div class="form-message" id="form-message" role="alert"></div><div id="soumission" class="submit-area"><p class="submit-note">${isDemo ? "La confirmation sera simulée dans cette maquette; aucun vote réel ne sera enregistré." : "Après l’envoi, ton lien personnel sera désactivé et ne pourra plus servir à voter une deuxième fois."}</p><button class="primary-button" type="submit" id="submit-vote" disabled>Soumettre mon vote<span class="button-arrow" aria-hidden="true">→</span></button></div></form></main>${footer}`;

  const form = document.querySelector("#vote-form");
  const sendButton = document.querySelector("#submit-vote");
  const message = document.querySelector("#form-message");
  const progressCount = document.querySelector("#progress-count");
  const progressFill = document.querySelector("#progress-fill");
  const progressBadge = document.querySelector("#progress-badge");
  const progressTrack = document.querySelector(".progress-track");
  const readSelections = () => Object.fromEntries(categories.map((category) => [
    category.id,
    form.querySelector(`input[name="${category.id}"]:checked`)?.value || "",
  ]));
  const updateProgress = () => {
    const selections = readSelections();
    const complete = categories.filter((category) => Boolean(selections[category.id])).length;
    const percent = categories.length ? complete / categories.length * 100 : 0;
    progressCount.textContent = `${complete} catégorie${complete > 1 ? "s" : ""} sur ${categories.length} complétée${complete > 1 ? "s" : ""}`;
    const topbarCount = document.querySelector(".topbar-count");
    if (topbarCount) topbarCount.textContent = `Bulletin · ${complete}/${categories.length}`;
    progressFill.style.width = `${percent}%`;
    progressBadge.textContent = `${complete} / ${categories.length}`;
    progressTrack.setAttribute("aria-valuenow", String(complete));
    categories.forEach((category) => {
      const completeCategory = Boolean(selections[category.id]);
      const state = document.querySelector(`[data-state="${category.id}"]`);
      state.textContent = completeCategory ? "Choix fait" : "À choisir";
      state.classList.toggle("selected", completeCategory);
    });
    sendButton.disabled = complete !== categories.length;
  };

  form.addEventListener("change", updateProgress);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selections = readSelections();
    const missing = categories.find((category) => !selections[category.id]);
    if (missing) {
      message.textContent = `Il manque ton choix pour « ${missing.title} ».`;
      message.classList.add("visible");
      document.querySelector(`#title-${missing.id}`).scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (isDemo) {
      sessionStorage.setItem(demoSubmittedKey, "1");
      await playBallAnimation("outro");
      renderDemoReceipt();
      return;
    }
    if (!window.confirm("Envoyer ton bulletin maintenant ? Ton lien ne pourra ensuite plus être réutilisé.")) return;
    sendButton.disabled = true;
    sendButton.textContent = "Envoi en cours…";
    message.classList.remove("visible", "error");
    try {
      await api("submitBallot", { session: sessionToken, selections });
      sessionStorage.removeItem(sessionKey);
      sessionToken = "";
      await playBallAnimation("outro");
      renderState({ icon: "✓", title: "Vote soumis", message: "Merci, ton vote a bien été enregistré. Ce lien a expiré et ne peut plus être utilisé." });
    } catch (error) {
      sendButton.disabled = false;
      sendButton.innerHTML = 'Réessayer <span class="button-arrow" aria-hidden="true">→</span>';
      message.textContent = error.message || "Une erreur est survenue.";
      message.classList.add("visible", "error");
    }
  });
  updateProgress();
}

async function loadBallot() {
  try {
    const result = await api("getBallot", { session: sessionToken });
    renderBallot(result);
  } catch (error) {
    if (error.status === 401 || error.status === 410) {
      sessionStorage.removeItem(sessionKey);
      sessionToken = "";
    }
    renderState({
      icon: error.status === 410 ? "◷" : "!",
      title: error.status === 410 ? "Le vote est fermé" : "Bulletin indisponible",
      message: error.message || "Le bulletin n’a pas pu être chargé. Réessaie plus tard.",
    });
  }
}

async function start() {
  await playBallAnimation("intro");
  if (demoMode) {
    if (sessionStorage.getItem(demoSubmittedKey) === "1") {
      renderDemoReceipt();
      return;
    }
    renderBallot({ ...ballot, closesAt: ballot.closesAt }, true);
    return;
  }
  if (sessionToken) {
    await loadBallot();
    return;
  }
  if (inviteToken) {
    renderVerification();
    return;
  }
  renderState({ icon: "↗", title: "Ouvre ton lien de vote", message: "Le bulletin est réservé aux électeurs invités. Ouvre le lien personnel reçu par e-mail." });
}

start();
