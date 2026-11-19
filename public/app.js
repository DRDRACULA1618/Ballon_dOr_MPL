import { ballot } from "./data.js";

const app = document.querySelector("#app");
const params = new URLSearchParams(window.location.search);
const demoMode = params.get("demo") === "1";
const sessionKey = "mpl-vote-session";
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
  return `<svg viewBox="0 0 84 84" role="img" aria-label="Avatar fictif de ${escapeHtml(name)}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4f0dd"/><stop offset="1" stop-color="#d4e1cb"/></linearGradient></defs><circle cx="42" cy="42" r="42" fill="url(#${id})"/><path d="M9 84c2-18 12-28 27-31h12c16 3 25 13 28 31" fill="${shirt}"/><path d="m34 55 8 10 8-10 4 4-7 9H37l-7-9z" fill="${trim}"/><path d="M33 47h18v11c-4 7-14 7-18 0z" fill="${skin}"/><ellipse cx="42" cy="35" rx="18" ry="22" fill="${skin}"/>${hairstyle}<path d="M33 38c2-2 4-2 6 0M46 38c2-2 4-2 6 0" fill="none" stroke="#382b25" stroke-width="1.6" stroke-linecap="round"/><circle cx="36" cy="40" r="1.15" fill="#231d1b"/><circle cx="49" cy="40" r="1.15" fill="#231d1b"/><path d="M38 48c2 2 6 2 8 0" fill="none" stroke="#854c3d" stroke-width="1.5" stroke-linecap="round"/><path d="M33 59l9 7 9-7" fill="none" stroke="#fff" stroke-opacity=".52" stroke-width="1.5"/></svg>`;
}

function topbar(label = "Vote des supporters", title = ballot.title) {
  return `<header class="site-topbar"><a class="brand" href="./"><span class="brand-mark" aria-hidden="true">✦</span><span>${escapeHtml(title)}</span></a><span class="topbar-label">${escapeHtml(label)}</span></header>`;
}

function renderState({ icon = "✦", title, message, error = "" }) {
  app.innerHTML = `${topbar()}<main class="state-view"><div class="state-icon" aria-hidden="true">${icon}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${error ? `<p class="inline-error">${escapeHtml(error)}</p>` : ""}</main><footer class="site-footer"><span>Les résultats sont agrégés. L’organisateur peut vérifier la participation depuis le registre privé.</span><a href="./admin.html">Espace organisateur</a></footer>`;
}

function formatDeadline(value) {
  if (!value) return "Clôture le 1er décembre 2026 · heure à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date de clôture à définir";
  return `Clôture le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Abidjan" }).format(date)} (Abidjan)`;
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
  app.innerHTML = `${topbar("Bulletin officiel", data.title || ballot.title)}<section class="hero"><div class="hero-inner"><p class="eyebrow">MPL Ballin’ d’Or 2026</p><h1>La saison.<br><span>Vos choix.</span></h1><p class="hero-subtitle">Vote une fois dans chacune des 11 catégories. Relis ton bulletin avant de l’envoyer.</p><div class="hero-meta"><span><i class="meta-dot"></i> Un bulletin par lien</span><span><i class="meta-dot"></i> ${escapeHtml(formatDeadline(data.closesAt))}</span></div></div></section><main class="main-wrap">${isDemo ? `<div class="demo-ribbon">Aperçu — les choix ne seront pas envoyés.</div>${ballot.pending.length ? `<aside class="notice"><span class="notice-icon" aria-hidden="true">i</span><div><strong>Éléments à valider avant l’ouverture.</strong><ul>${ballot.pending.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></aside>` : ""}`}<section class="progress-panel" aria-label="Progression du bulletin"><div class="progress-copy"><span class="progress-title">Ton bulletin</span><span id="progress-count" class="progress-count">0 catégorie sur ${categories.length} complétée</span></div><div class="progress-track" role="progressbar" aria-label="Catégories complétées" aria-valuemin="0" aria-valuemax="${categories.length}" aria-valuenow="0"><div id="progress-fill" class="progress-fill"></div></div><span id="progress-badge" class="progress-badge">0 / ${categories.length}</span></section><div class="section-heading"><div><h2>Les catégories</h2><p>Un choix obligatoire par catégorie.</p></div></div><form id="vote-form" novalidate><div class="category-list">${categories.map(renderCategory).join("")}</div><div class="form-message" id="form-message" role="alert"></div><div class="submit-area"><p class="submit-note">Après l’envoi, ton lien personnel sera désactivé et ne pourra plus servir à voter une deuxième fois.</p><button class="primary-button" type="submit" id="submit-vote" disabled>${isDemo ? "Prévisualiser" : "Envoyer mon bulletin"}<span class="button-arrow" aria-hidden="true">→</span></button></div></form></main><footer class="site-footer"><span>Les bulletins sont conservés dans un fichier maître privé.</span><a href="./admin.html">Espace organisateur</a></footer>`;

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
      message.textContent = "Aucun bulletin n’a été enregistré : ceci est un aperçu.";
      message.classList.add("visible");
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
      renderState({ icon: "✓", title: "Bulletin reçu", message: "Merci pour ta participation. Ton lien personnel a été utilisé." });
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
  if (demoMode) {
    renderBallot({ ...ballot, closesAt: "" }, true);
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
