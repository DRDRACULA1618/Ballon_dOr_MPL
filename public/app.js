import { ballot } from "./data.js";

const app = document.querySelector("#app");
const params = new URLSearchParams(window.location.search);
const demoMode = params.get("demo") === "1";
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
  return `<header class="site-topbar"><a class="brand" href="${homeHref}"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M10 9h16l-2 11c-.7 4-3 6-6 6s-5.3-2-6-6L10 9Z"/><path d="M10 12H7c0 5 2 8 6 8m13-8h3c0 5-2 8-6 8M18 26v4m-6 2h12"/></svg></span><span class="brand-copy"><span class="brand-title">${escapeHtml(title)}</span><span class="brand-subtitle">ÉDITION 2026</span></span></a><span class="topbar-label">${escapeHtml(label)}</span></header>`;
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
    app.innerHTML = `<section class="cinematic-screen ${isOutro ? "cinematic-outro" : "cinematic-intro"}" aria-label="${isOutro ? "Animation de fin du vote" : "Animation de bienvenue"}"><div class="cinematic-stars" aria-hidden="true"></div><div class="cinematic-light" aria-hidden="true"></div><div class="cinematic-copy"><p>${isOutro ? "MPL · BALLIN’ D’OR 2026" : "LE RENDEZ-VOUS DES CHAMPIONS"}</p><h1>${isOutro ? "Merci pour ton vote" : "Le CLUB MPL 11"}</h1><span>${isOutro ? "TON CHOIX ENTRE DANS L’HISTOIRE" : "MPL BALLIN’ D’OR · 2026"}</span></div><div class="ball-journey ${isOutro ? "ball-journey-out" : "ball-journey-in"}" aria-hidden="true"><div class="ball-shadow"></div><svg class="cinematic-ball" viewBox="0 0 220 220"><defs><radialGradient id="ballSurface" cx="33%" cy="27%"><stop stop-color="#fff8df"/><stop offset=".42" stop-color="#e5c474"/><stop offset="1" stop-color="#82561d"/></radialGradient><clipPath id="ballClip"><circle cx="110" cy="110" r="91"/></clipPath></defs><circle cx="110" cy="110" r="92" fill="url(#ballSurface)" stroke="#f8e6b6" stroke-width="2"/><g clip-path="url(#ballClip)" fill="#171923" stroke="#f4d88e" stroke-width="2"><path d="m110 65 22 16-8 26h-28l-8-26zm-48-31 26 4 13 24-24 10-23-17zm96 0-26 4-13 24 24 10 23-17zM61 124l25-15 20 20-8 29-27 3zm98 0-25-15-20 20 8 29 27 3zM84 177l14-19h24l14 19-11 26H95z"/></g><ellipse cx="79" cy="53" rx="38" ry="17" fill="#fff" opacity=".16" transform="rotate(-33 79 53)"/></svg></div><button class="skip-animation" type="button">Passer l’animation</button></section>`;
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
  app.innerHTML = `${topbar("Accès électeur")}<main class="state-view auth-view"><div class="state-icon" aria-hidden="true">✉</div><h1>Vérifie ton adresse e-mail</h1><p>Un code temporaire sera envoyé à l’adresse enregistrée par l’organisateur. Tu en auras besoin pour ouvrir le bulletin.</p><button class="primary-button" id="request-code" type="button">Envoyer le code <span class="button-arrow" aria-hidden="true">→</span></button><form id="verify-form" class="otp-form" hidden><label class="field">Code à 6 chiffres<input id="otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required /></label><button class="primary-button" type="submit">Vérifier le code</button></form><p class="form-message" id="auth-message" role="status"></p><p class="auth-note">Le code expire après 10 minutes. Garde ton lien personnel privé.</p></main><footer class="site-footer"><span>Un seul bulletin par lien personnel.</span><a href="./admin.html">Espace organisateur</a></footer>`;

  const requestButton = document.querySelector("#request-code");
  const form = document.querySelector("#verify-form");
  const message = document.querySelector("#auth-message");
  let retryTimer = null;

  requestButton.addEventListener("click", async () => {
    requestButton.disabled = true;
    requestButton.textContent = "Envoi en cours…";
    message.classList.remove("visible", "error");
    try {
      const result = await api("requestOtp", { token: inviteToken });
      message.textContent = result.message;
      message.classList.add("visible");
      form.hidden = false;
      document.querySelector("#otp-code").focus();
      let remaining = 60;
      requestButton.textContent = `Renvoyer le code dans ${remaining}s`;
      retryTimer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          window.clearInterval(retryTimer);
          requestButton.disabled = false;
          requestButton.textContent = "Renvoyer le code";
        } else {
          requestButton.textContent = `Renvoyer le code dans ${remaining}s`;
        }
      }, 1000);
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("visible", "error");
      requestButton.disabled = false;
      requestButton.textContent = "Réessayer l’envoi";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = document.querySelector("#otp-code").value.trim();
    const submit = form.querySelector("button");
    submit.disabled = true;
    submit.textContent = "Vérification…";
    message.classList.remove("visible", "error");
    try {
      const result = await api("verifyOtp", { token: inviteToken, code });
      sessionToken = result.session;
      sessionStorage.setItem(sessionKey, sessionToken);
      inviteToken = "";
      if (retryTimer) window.clearInterval(retryTimer);
      await loadBallot();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("visible", "error");
      submit.disabled = false;
      submit.textContent = "Vérifier le code";
      document.querySelector("#otp-code").select();
    }
  });
}

function renderCategory(item, index) {
  const nomineeCards = item.nominees.map((candidate, nomineeIndex) => {
    const avatar = `<span class="avatar">${avatarSvg(candidate.name, `${item.id}-${nomineeIndex}`)}</span>`;
    return `<label class="candidate"><input type="radio" name="${item.id}" value="${candidate.id}" aria-label="${escapeHtml(candidate.name)} — ${escapeHtml(item.title)}"><span class="candidate-inner">${avatar}<span class="candidate-name">${escapeHtml(candidate.name)}</span></span><span class="pick-mark" aria-hidden="true">✓</span></label>`;
  }).join("");
  return `<section class="category-card" aria-labelledby="title-${item.id}"><div class="category-head"><div class="category-title-wrap"><span class="category-number">${String(index + 1).padStart(2, "0")}</span><div><h3 class="category-title" id="title-${item.id}">${escapeHtml(item.title)}</h3><p class="category-prompt">Choisis un nominé</p></div></div><span class="category-state" data-state="${item.id}">À choisir</span></div><div class="candidate-grid">${nomineeCards}</div></section>`;
}

function renderBallot(data, isDemo = false) {
  const categories = data.categories;
  const nomineeCount = categories.reduce((total, category) => total + category.nominees.length, 0);
  const previewRibbon = `<div class="demo-ribbon">Aperçu partagé — aucun vote ne sera envoyé ni enregistré. Les catégories et nominations pourront évoluer avant l’ouverture.</div>`;
  const footer = isDemo
    ? `<footer class="site-footer"><span>Aperçu public — aucun bulletin n’est collecté.</span></footer>`
    : `<footer class="site-footer"><span>Les bulletins sont conservés dans un fichier maître privé.</span><a href="./admin.html">Espace organisateur</a></footer>`;
  const trophyArt = `<div class="hero-art" aria-hidden="true"><div class="trophy-orbit orbit-one"></div><div class="trophy-orbit orbit-two"></div><div class="trophy-glow"></div><svg class="trophy-svg" viewBox="0 0 360 360" role="presentation"><defs><linearGradient id="trophyGold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff0b7"/><stop offset=".3" stop-color="#e4bd68"/><stop offset=".64" stop-color="#a87527"/><stop offset="1" stop-color="#f7d98b"/></linearGradient><radialGradient id="ballGold" cx="35%" cy="27%"><stop stop-color="#fff4c6"/><stop offset=".43" stop-color="#efcf7e"/><stop offset="1" stop-color="#9d6d25"/></radialGradient><linearGradient id="trophyBase" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#9a6a23"/><stop offset=".45" stop-color="#f3d786"/><stop offset="1" stop-color="#a6752b"/></linearGradient><filter id="trophyShadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="11"/></filter></defs><ellipse cx="180" cy="319" rx="84" ry="13" fill="#000" opacity=".34" filter="url(#trophyShadow)"/><circle cx="180" cy="116" r="64" fill="url(#ballGold)" stroke="#ffe9a5" stroke-opacity=".7" stroke-width="2"/><path d="m147 84 31-18 34 20 1 38-31 21-34-20zM116 113l31-29m34 41 31-39M148 164l34-9 30 16" fill="none" stroke="#8b6020" stroke-opacity=".52" stroke-width="2"/><path d="M124 143c-33-8-44-35-36-52 9-20 31-14 42 4m106 48c33-8 44-35 36-52-9-20-31-14-42 4" fill="none" stroke="url(#trophyGold)" stroke-width="13" stroke-linecap="round"/><path d="M118 137c4 50 26 78 62 81 36-3 58-31 62-81-16 9-37 14-62 14s-46-5-62-14Z" fill="url(#trophyGold)" stroke="#ffe9a5" stroke-width="2"/><path d="M164 216h32v44h-32z" fill="url(#trophyBase)"/><path d="M145 258h70l13 20H132z" fill="url(#trophyGold)"/><path d="M124 279h112l12 24H112z" fill="url(#trophyBase)" stroke="#f5d98e" stroke-opacity=".65"/><path d="M145 287h70" stroke="#fff0b7" stroke-opacity=".75" stroke-width="2"/><path d="m180 35 4 13 13 4-13 4-4 13-4-13-13-4 13-4zm107 80 3 8 8 3-8 3-3 8-3-8-8-3 8-3zM68 182l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#ffe9a5" opacity=".9"/></svg><span class="hero-art-caption">LE PALMARÈS MPL · 2026</span></div>`;
  app.innerHTML = `${topbar(isDemo ? "Aperçu partagé" : "Vote des supporters", data.title || ballot.title, isDemo ? "./?demo=1" : "./")}<section class="hero"><div class="hero-inner"><div class="hero-copy"><p class="eyebrow">LE RENDEZ-VOUS DES CHAMPIONS</p><h1>Une saison.<br><span>Des légendes.</span></h1><p class="hero-subtitle">Célèbre les joueurs qui ont fait vibrer la MPL. Choisis tes favoris dans chaque catégorie.</p><div class="hero-meta"><span><i class="meta-dot"></i>${categories.length} catégories</span><span><i class="meta-dot"></i>${nomineeCount} nominations</span><span class="deadline-meta">${escapeHtml(formatDeadline(data.closesAt))}</span></div></div>${trophyArt}</div></section><main class="main-wrap">${isDemo ? previewRibbon : ""}<section class="progress-panel" aria-label="Progression du bulletin"><div class="progress-copy"><span class="progress-title">Ton palmarès</span><span id="progress-count" class="progress-count">0 catégorie sur ${categories.length} complétée</span></div><div class="progress-track" role="progressbar" aria-label="Catégories complétées" aria-valuemin="0" aria-valuemax="${categories.length}" aria-valuenow="0"><div id="progress-fill" class="progress-fill"></div></div><span id="progress-badge" class="progress-badge">0 / ${categories.length}</span></section><div class="section-heading"><div><p class="section-kicker">LE CHOIX DES SUPPORTERS</p><h2>À toi de voter</h2><p>Choisis un nominé par catégorie pour composer ton palmarès.</p></div><span class="section-counter">${String(categories.length).padStart(2, "0")} CATÉGORIES</span></div><form id="vote-form" novalidate><div class="category-list">${categories.map(renderCategory).join("")}</div><div class="form-message" id="form-message" role="alert"></div><div class="submit-area"><p class="submit-note">${isDemo ? "La confirmation sera simulée dans cette maquette; aucun vote réel ne sera enregistré." : "Après l’envoi, ton lien personnel sera désactivé et ne pourra plus servir à voter une deuxième fois."}</p><button class="primary-button" type="submit" id="submit-vote" disabled>Soumettre mon vote<span class="button-arrow" aria-hidden="true">→</span></button></div></form></main>${footer}`;

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
