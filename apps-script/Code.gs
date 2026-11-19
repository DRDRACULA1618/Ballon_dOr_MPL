const SHEET_HEADERS = {
  Settings: ["key", "value"],
  Voters: ["voter_id", "name", "email", "active", "voted", "created_at"],
  Links: ["token_hash", "voter_id", "expires_at", "used", "created_at", "invitation_sent_at"],
  OtpCodes: ["voter_id", "code_hash", "expires_at", "attempts", "last_sent_at", "window_started_at", "sends_in_window", "locked_until"],
  Sessions: ["session_hash", "voter_id", "expires_at", "used", "created_at"],
  Ballots: ["ballot_id", "created_at", "catalog_hash", "answers_json"],
  Audit: ["event_id", "created_at", "action", "details_json"],
};

const DEFAULT_SETTINGS = {
  title: "MPL Ballin’ d’Or 2026",
  closing_date: "2026-12-01",
  closes_at: "2026-12-01T23:59:59.000Z",
  is_open: "0",
  has_opened: "0",
  catalog_hash: "",
  catalog_locked: "0",
  results_spreadsheet_id: "",
  results_emails: "",
};

const OTP_LIFETIME_MS = 10 * 60 * 1000;
const OTP_SESSION_MS = 20 * 60 * 1000;
const OTP_RATE_WINDOW_MS = 15 * 60 * 1000;
const OTP_LOCK_MS = 20 * 60 * 1000;
const MAX_OTP_SENDS_PER_WINDOW = 3;
const MAX_OTP_ATTEMPTS = 5;
const MAX_INVITATIONS_PER_CALL = 20;

/** Apps Script web-app entry point. Cloudflare injects the bridge secret. */
function doPost(e) {
  var input;
  try {
    input = JSON.parse(e && e.postData && e.postData.contents || "{}");
  } catch (_error) {
    return output_({ message: "Requête illisible." }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return output_({ message: "Requête invalide." }, 400);
  }

  var props = PropertiesService.getScriptProperties();
  var expectedBridge = props.getProperty("MPL_API_BRIDGE_SECRET") || "";
  if (!expectedBridge || !safeEqual_(String(input.bridgeSecret || ""), expectedBridge)) {
    return output_({ message: "Accès refusé." }, 403);
  }

  try {
    var result = dispatch_(input);
    var status = result && result.__status ? result.__status : 200;
    if (result) delete result.__status;
    return output_(result || { ok: true }, status);
  } catch (error) {
    console.error("MPL API error: " + (error && error.message || "unknown"));
    return output_({ message: "Le service est momentanément indisponible." }, 503);
  }
}

function dispatch_(input) {
  switch (String(input.action || "")) {
    case "requestOtp": return requestOtp_(input);
    case "verifyOtp": return verifyOtp_(input);
    case "getBallot": return getBallot_(input);
    case "submitBallot": return submitBallot_(input);
    case "adminState": return adminState_(input);
    case "adminSaveSettings": return adminSaveSettings_(input);
    case "adminRegisterVoters": return adminRegisterVoters_(input);
    case "adminSendInvitations": return adminSendInvitations_(input);
    case "adminCloseVote": return adminCloseVote_(input);
    case "adminAudit": return adminAudit_(input);
    case "adminSyncResults": return adminSyncResults_(input);
    default: return fail_(400, "Opération inconnue.");
  }
}

function setupMasterSpreadsheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Ouvre Apps Script depuis le fichier maître Google Sheets.");

  PropertiesService.getScriptProperties().setProperty("MASTER_SPREADSHEET_ID", spreadsheet.getId());
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
    var headers = SHEET_HEADERS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });

  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    if (getSetting_(key) === null) setSetting_(key, DEFAULT_SETTINGS[key]);
  });
  if (!getSetting_("catalog_version")) setSetting_("catalog_version", CATALOG.version);
  if (!getSetting_("catalog_hash")) setSetting_("catalog_hash", catalogHash_());

  // PRIVATE removes link-wide access; individually named collaborators remain explicit.
  DriveApp.getFileById(spreadsheet.getId()).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  SpreadsheetApp.flush();
  return "Fichier maître configuré. Vérifie son partage Google Drive avant de continuer.";
}

function requestOtp_(input) {
  return withLock_(function () {
    var token = String(input.token || "");
    var generic = {
      ok: true,
      message: "Si le lien est valide et le vote ouvert, un code sera envoyé à l’adresse enregistrée.",
    };
    if (!token || token.length < 40 || token.length > 200) return generic;

    var settings = settings_();
    var catalog = activeCatalog_();
    if (!isVoteOpen_(settings) || catalog.pending.length) return generic;
    if (setting_("catalog_locked") !== "1" || setting_("catalog_hash") !== hashCatalog_(catalog)) return generic;

    var tokenHash = sha256_(token);
    var link = findBy_("Links", 0, tokenHash);
    if (!link || link.row[3] === "1" || Date.parse(link.row[2]) <= Date.now()) return generic;
    var voter = findBy_("Voters", 0, link.row[1]);
    if (!voter || voter.row[3] !== "1" || voter.row[4] === "1") return generic;

    var otp = findBy_("OtpCodes", 0, voter.row[0]);
    var now = Date.now();
    var lockedUntil = otp ? Date.parse(otp.row[7] || "") : 0;
    if (lockedUntil > now) return generic;

    var windowStart = otp ? Date.parse(otp.row[5] || "") : 0;
    var sends = otp ? Number(otp.row[6] || 0) : 0;
    if (!windowStart || now - windowStart >= OTP_RATE_WINDOW_MS) {
      windowStart = now;
      sends = 0;
    }
    if (sends >= MAX_OTP_SENDS_PER_WINDOW || MailApp.getRemainingDailyQuota() < 1) return generic;

    var code = randomDigits_(6);
    var expiresAt = new Date(now + OTP_LIFETIME_MS).toISOString();
    var nextRow = [
      voter.row[0], otpHash_(code, voter.row[0]), expiresAt, 0,
      new Date(now).toISOString(), new Date(windowStart).toISOString(), sends + 1, "",
    ];
    try {
      MailApp.sendEmail({
        to: voter.row[2],
        subject: "Code de vérification — MPL Ballin’ d’Or 2026",
        body: "Ton code de vérification est : " + code + "\n\nIl expire dans 10 minutes. Si tu n’as pas demandé ce code, ignore ce message.",
        name: "MPL Ballin’ d’Or 2026",
      });
    } catch (_error) {
      return generic;
    }
    if (otp) writeRow_("OtpCodes", otp.number, nextRow);
    else appendRow_("OtpCodes", nextRow);
    return generic;
  });
}

function verifyOtp_(input) {
  return withLock_(function () {
    var settings = settings_();
    var catalog = activeCatalog_();
    if (!isVoteOpen_(settings) || catalog.pending.length || setting_("catalog_locked") !== "1" || setting_("catalog_hash") !== hashCatalog_(catalog)) {
      return fail_(410, "Le vote n’est pas ouvert ou sa période est terminée.");
    }
    var token = String(input.token || "");
    var code = String(input.code || "").replace(/\s/g, "");
    if (!token || token.length < 40 || token.length > 200 || !/^\d{6}$/.test(code)) {
      return fail_(401, "Code invalide ou expiré. Demande un nouveau code.");
    }
    var link = findBy_("Links", 0, sha256_(token));
    if (!link || link.row[3] === "1" || Date.parse(link.row[2]) <= Date.now()) {
      return fail_(401, "Lien ou code invalide. Ouvre le lien reçu et réessaie.");
    }
    var voter = findBy_("Voters", 0, link.row[1]);
    if (!voter || voter.row[3] !== "1" || voter.row[4] === "1") {
      return fail_(401, "Lien ou code invalide. Ouvre le lien reçu et réessaie.");
    }
    var otp = findBy_("OtpCodes", 0, voter.row[0]);
    if (!otp || !otp.row[1] || Date.parse(otp.row[2]) <= Date.now() || Number(otp.row[3] || 0) >= MAX_OTP_ATTEMPTS) {
      return fail_(401, "Code invalide ou expiré. Demande un nouveau code.");
    }

    if (!safeEqual_(otpHash_(code, voter.row[0]), otp.row[1])) {
      var attempts = Number(otp.row[3] || 0) + 1;
      var nextOtp = otp.row.slice();
      nextOtp[3] = attempts;
      if (attempts >= MAX_OTP_ATTEMPTS) {
        nextOtp[1] = "";
        nextOtp[7] = new Date(Date.now() + OTP_LOCK_MS).toISOString();
      }
      writeRow_("OtpCodes", otp.number, nextOtp);
      return fail_(401, "Code invalide ou expiré. Demande un nouveau code.");
    }

    var session = randomToken_();
    var expires = new Date(Date.now() + OTP_SESSION_MS).toISOString();
    var cleanOtp = otp.row.slice();
    cleanOtp[1] = "";
    cleanOtp[3] = 0;
    cleanOtp[7] = "";
    writeRow_("OtpCodes", otp.number, cleanOtp);
    appendRow_("Sessions", [sha256_(session), voter.row[0], expires, "0", new Date().toISOString()]);
    return { ok: true, session: session, expiresAt: expires };
  });
}

function getBallot_(input) {
  var session = validateSession_(String(input.session || ""));
  if (!session.ok) return fail_(session.status, session.message);
  var settings = settings_();
  var catalog = activeCatalog_();
  if (!isVoteOpen_(settings)) return fail_(410, "Le vote n’est pas ouvert ou sa période est terminée.");
  if (catalog.pending.length) return fail_(503, "Le bulletin est encore en préparation.");
  if (setting_("catalog_locked") !== "1" || setting_("catalog_hash") !== hashCatalog_(catalog)) {
    return fail_(503, "Le catalogue a changé après l’ouverture. Contacte l’organisateur.");
  }
  var voter = findBy_("Voters", 0, session.voterId);
  if (!voter || voter.row[4] === "1" || !activeLinkForVoter_(voter.row[0])) {
    return fail_(409, "Ce lien a déjà servi à voter ou n’est plus actif.");
  }
  return {
    ok: true,
    title: settings.title,
    eyebrow: "Le vote des supporters",
    closesAt: settings.closesAt,
    categories: catalog.categories,
  };
}

function submitBallot_(input) {
  return withLock_(function () {
    var settings = settings_();
    var catalog = activeCatalog_();
    if (!isVoteOpen_(settings)) return fail_(410, "La période de vote est terminée.");
    if (catalog.pending.length) return fail_(503, "Le bulletin doit être finalisé avant l’ouverture.");
    var currentCatalogHash = setting_("catalog_hash");
    if (setting_("catalog_locked") !== "1" || currentCatalogHash !== hashCatalog_(catalog)) {
      return fail_(409, "Le catalogue du bulletin n’est pas verrouillé pour ce scrutin.");
    }
    var selectionError = validateSelections_(input.selections, catalog.categories);
    if (selectionError) return fail_(400, selectionError);

    var session = validateSession_(String(input.session || ""));
    if (!session.ok) return fail_(session.status, session.message);
    var voter = findBy_("Voters", 0, session.voterId);
    if (!voter || voter.row[3] !== "1" || voter.row[4] === "1") return fail_(409, "Ce lien a déjà servi à voter ou n’est plus actif.");
    var activeLink = activeLinkForVoter_(voter.row[0]);
    if (!activeLink) return fail_(409, "Le lien de vote est expiré ou a déjà été utilisé.");

    // Mark participation first while holding the script lock. If the following sheet write
    // fails, the audit will show the discrepancy and the voter must contact the organizer.
    writeCell_("Voters", voter.number, 5, "1");
    writeCell_("Links", activeLink.number, 4, "1");
    writeCell_("Sessions", session.number, 4, "1");
    SpreadsheetApp.flush();
    try {
      appendRow_("Ballots", [
        Utilities.getUuid(), new Date().toISOString(), currentCatalogHash,
        JSON.stringify(input.selections),
      ]);
      appendAudit_("submitBallot", { catalogVersion: CATALOG.version });
      return { ok: true, receipt: Utilities.getUuid() };
    } catch (_error) {
      appendAudit_("submitBallot_storage_error", { message: "Ballot append failed after participation was locked." });
      return fail_(503, "La réception doit être vérifiée par l’organisateur avant toute nouvelle tentative.");
    }
  });
}

function adminState_(input) {
  var auth = requireAdmin_(input);
  if (!auth.ok) return fail_(401, "Accès organisateur refusé.");
  return withLock_(function () {
    var settings = settings_();
    var catalog = activeCatalog_();
    var voters = table_("Voters").map(function (row) {
      var link = latestLinkForVoter_(row[0]);
      return {
        id: row[0], name: row[1], email: row[2], active: row[3] === "1",
        voted: row[4] === "1", invitationSent: Boolean(link && link.row[5]),
      };
    });
    var hasOpened = setting_("has_opened") === "1";
    return {
      ok: true,
      title: settings.title,
      closingDate: settings.closingDate,
      closesAt: settings.closesAt,
      isOpen: isVoteOpen_(settings),
      ballotReady: catalog.pending.length === 0,
      pending: catalog.pending,
      catalogVersion: catalog.version,
      categoryCount: catalog.categories.length,
      nominationCount: nominationCount_(catalog),
      voters: voters,
      audit: auditSummary_(),
      voterRegistryLocked: hasOpened,
      resultsLocked: !hasOpened || isVoteOpen_(settings),
      reportUrl: setting_("results_url") || "",
    };
  });
}

function adminSaveSettings_(input) {
  var auth = requireAdmin_(input);
  if (!auth.ok) return fail_(401, "Accès organisateur refusé.");
  var title = String(input.title || "").trim().slice(0, 100);
  var closingDate = String(input.closingDate || "");
  var closesAt = String(input.closesAt || "");
  var isOpen = input.isOpen === true;
  if (!title || /^[=+\-@]/.test(title)) return fail_(400, "Indique un titre de scrutin valide.");
  if (closingDate && !/^\d{4}-\d{2}-\d{2}$/.test(closingDate)) return fail_(400, "La date de clôture est invalide.");
  if (closesAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(closesAt) || !Number.isFinite(Date.parse(closesAt)))) {
    return fail_(400, "La date et l’heure de clôture sont invalides.");
  }
  if (isOpen) {
    if (!closesAt || Date.parse(closesAt) <= Date.now()) return fail_(400, "Renseigne une heure de clôture future, heure d’Abidjan, avant l’ouverture.");
    if (closingDate && closesAt.slice(0, 10) !== closingDate) return fail_(400, "La date et l’heure de clôture doivent correspondre.");
    var catalog = activeCatalog_();
    if (catalog.pending.length) return fail_(409, "Valide tous les libellés et candidats avant d’ouvrir le vote.");
    if (!table_("Voters").some(function (row) { return row[3] === "1"; })) return fail_(409, "Enregistre les électeurs avant d’ouvrir le vote.");
    var frozen = setting_("catalog_hash");
    if (setting_("catalog_locked") === "1") {
      if (!frozen || frozen !== hashCatalog_(catalog)) return fail_(409, "Le catalogue gelé est indisponible ou incohérent.");
    }
  }

  return withLock_(function () {
    setSetting_("title", title);
    setSetting_("closing_date", closingDate);
    setSetting_("closes_at", closesAt);
    setSetting_("is_open", isOpen ? "1" : "0");
    if (isOpen) setSetting_("has_opened", "1");
    if (isOpen && setting_("catalog_locked") !== "1") {
      var snapshot = { version: CATALOG.version, categories: CATALOG.categories, pending: CATALOG.pending };
      var serializedSnapshot = JSON.stringify(snapshot);
      setSetting_("catalog_hash", sha256_(serializedSnapshot));
      setSetting_("catalog_json", serializedSnapshot);
      setSetting_("catalog_locked", "1");
    }
    appendAudit_("saveSettings", { isOpen: isOpen, closingDate: closingDate, closesAt: closesAt });
    return { ok: true, title: title, closingDate: closingDate, closesAt: closesAt, isOpen: isOpen };
  });
}

function adminRegisterVoters_(input) {
  var auth = requireAdmin_(input);
  if (!auth.ok) return fail_(401, "Accès organisateur refusé.");
  var incoming = Array.isArray(input.voters) ? input.voters : [];
  if (!incoming.length || incoming.length > 500) return fail_(400, "Ajoute entre 1 et 500 électeurs.");
  if (settings_().isOpen) return fail_(409, "Ferme le scrutin avant de modifier le registre.");
  if (setting_("has_opened") === "1") return fail_(409, "Le registre des électeurs est gelé depuis la première ouverture du scrutin.");

  var clean = [];
  var seen = {};
  for (var i = 0; i < incoming.length; i += 1) {
    var name = String(incoming[i].name || "").trim().slice(0, 100);
    var email = String(incoming[i].email || "").trim().toLowerCase();
    if (!name || /^[=+\-@]/.test(name) || !validEmail_(email)) return fail_(400, "Chaque ligne doit contenir un nom et une adresse e-mail valides.");
    if (seen[email]) return fail_(400, "La liste contient une adresse e-mail répétée.");
    seen[email] = true;
    clean.push({ name: name, email: email });
  }

  return withLock_(function () {
    var existing = {};
    table_("Voters").forEach(function (row) { existing[String(row[2]).toLowerCase()] = true; });
    var added = 0;
    clean.forEach(function (voter) {
      if (existing[voter.email]) return;
      appendRow_("Voters", [Utilities.getUuid(), voter.name, voter.email, "1", "0", new Date().toISOString()]);
      existing[voter.email] = true;
      added += 1;
    });
    appendAudit_("registerVoters", { received: clean.length, added: added });
    return { ok: true, added: added, total: table_("Voters").length };
  });
}

function adminSendInvitations_(input) {
  var auth = requireAdmin_(input);
  if (!auth.ok) return fail_(401, "Accès organisateur refusé.");
  var settings = settings_();
  if (!isVoteOpen_(settings)) return fail_(409, "Ouvre le vote avant d’envoyer les invitations.");
  if (activeCatalog_().pending.length) return fail_(409, "Valide le bulletin avant l’envoi des invitations.");
  if (MailApp.getRemainingDailyQuota() < 1) return fail_(429, "Le quota d’envoi d’e-mails est épuisé pour aujourd’hui.");

  return withLock_(function () {
    var voters = table_("Voters").filter(function (row) { return row[3] === "1" && row[4] !== "1"; });
    var sent = 0;
    var skipped = 0;
    var errors = 0;
    var baseUrl = String(input.publicBaseUrl || "").replace(/\/$/, "");
    if (!/^https:\/\//i.test(baseUrl)) return fail_(400, "Indique l’URL HTTPS du site Cloudflare Pages.");
    var quota = MailApp.getRemainingDailyQuota();

    for (var i = 0; i < voters.length && sent < MAX_INVITATIONS_PER_CALL && quota > 0; i += 1) {
      var voter = voters[i];
      var latest = latestLinkForVoter_(voter[0]);
      if (latest && latest.row[5] && latest.row[3] !== "1" && Date.parse(latest.row[2]) > Date.now()) {
        skipped += 1;
        continue;
      }
      var rawToken = randomToken_();
      var linkRow = appendRow_("Links", [sha256_(rawToken), voter[0], settings.closesAt, "0", new Date().toISOString(), ""]);
      var url = baseUrl + "/#t=" + encodeURIComponent(rawToken);
      try {
        MailApp.sendEmail({
          to: voter[2],
          subject: "Ton invitation — MPL Ballin’ d’Or 2026",
          body: "Bonjour " + voter[1] + ",\n\nLe vote MPL Ballin’ d’Or 2026 est ouvert. Utilise ce lien personnel pour voter :\n" + url + "\n\nUn code de vérification sera envoyé à cette adresse. Le lien ne peut servir qu’à un seul bulletin et expire à la clôture du vote.\n\nMerci !",
          name: "MPL Ballin’ d’Or 2026",
        });
        writeCell_("Links", linkRow, 6, new Date().toISOString());
        sent += 1;
        quota -= 1;
      } catch (_error) {
        writeCell_("Links", linkRow, 3, new Date().toISOString());
        errors += 1;
      }
    }
    appendAudit_("sendInvitations", { sent: sent, skipped: skipped, errors: errors });
    return { ok: true, sent: sent, skipped: skipped, errors: errors, remaining: Math.max(0, voters.length - sent - skipped - errors) };
  });
}

function adminCloseVote_(input) {
  var auth = requireAdmin_(input);
  if (!auth.ok) return fail_(401, "Accès organisateur refusé.");
  return withLock_(function () {
    setSetting_("is_open", "0");
    appendAudit_("closeVote", {});
    return { ok: true, isOpen: false };
  });
}

function adminAudit_(input) {
  var auth = requireAdmin_(input);
  if (!auth.ok) return fail_(401, "Accès organisateur refusé.");
  return withLock_(function () {
    var summary = auditSummary_();
    appendAudit_("manualAudit", summary);
    return { ok: true, audit: summary };
  });
}

function adminSyncResults_(input) {
  var auth = requireAdmin_(input);
  if (!auth.ok) return fail_(401, "Accès organisateur refusé.");
  var settings = settings_();
  if (setting_("has_opened") !== "1" || isVoteOpen_(settings)) return fail_(409, "Les résultats sont disponibles après la clôture d’un scrutin ouvert.");
  var emails = Array.isArray(input.organizerEmails) ? input.organizerEmails : [];
  var cleanEmails = [];
  var seen = {};
  for (var i = 0; i < emails.length; i += 1) {
    var email = String(emails[i] || "").trim().toLowerCase();
    if (!email) continue;
    if (!validEmail_(email)) return fail_(400, "Vérifie la liste des e-mails des organisateurs.");
    if (!seen[email]) cleanEmails.push(email);
    seen[email] = true;
  }
  if (!cleanEmails.length) return fail_(400, "Ajoute au moins un e-mail d’organisateur autorisé à lire le rapport.");

  return withLock_(function () {
    var results = calculateResults_();
    var reportId = setting_("results_spreadsheet_id");
    var report;
    if (reportId) report = SpreadsheetApp.openById(reportId);
    else report = SpreadsheetApp.create("MPL Ballin’ d’Or 2026 — Résultats agrégés");
    var file = DriveApp.getFileById(report.getId());
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
    var owner = file.getOwner();
    var ownerEmail = owner ? owner.getEmail().toLowerCase() : "";
    file.getEditors().forEach(function (editor) {
      var editorEmail = editor.getEmail().toLowerCase();
      if (editorEmail && editorEmail !== ownerEmail) file.removeEditor(editor);
    });

    var previousEmails = (setting_("results_emails") || "").split(",").filter(Boolean);
    previousEmails.forEach(function (oldEmail) {
      if (cleanEmails.indexOf(oldEmail) === -1) {
        try { file.removeViewer(oldEmail); } catch (_error) { /* already removed */ }
      }
    });
    var currentViewers = file.getViewers().map(function (viewer) { return viewer.getEmail().toLowerCase(); });
    cleanEmails.forEach(function (email) {
      if (email !== ownerEmail && currentViewers.indexOf(email) === -1) file.addViewer(email);
    });

    var sheet = report.getSheetByName("Résultats") || report.getSheets()[0];
    sheet.setName("Résultats");
    sheet.clear();
    var rows = [
      [settings.title],
      ["Clôture (heure d’Abidjan)", settings.closesAt ? Utilities.formatDate(new Date(settings.closesAt), "Africa/Abidjan", "dd/MM/yyyy HH:mm") : "Non définie"],
      ["Bulletins valides", results.totalBallots],
      [],
      ["Catégorie", "Nominé", "Voix", "Pourcentage", "Rang", "Égalité"],
    ];
    results.categories.forEach(function (category) {
      category.nominees.forEach(function (nominee) {
        rows.push([
          safeSheetText_(category.title), safeSheetText_(nominee.name), nominee.votes,
          nominee.percentage, nominee.rank, nominee.tied ? "Oui" : "Non",
        ]);
      });
    });
    sheet.getRange(1, 1, rows.length, 6).setValues(rows.map(function (row) {
      var normalized = row.slice();
      while (normalized.length < 6) normalized.push("");
      return normalized;
    }));
    sheet.setFrozenRows(5);
    sheet.autoResizeColumns(1, 6);
    sheet.getRange(1, 1, 1, 6).merge().setFontSize(16).setFontWeight("bold");
    sheet.getRange(5, 1, 1, 6).setFontWeight("bold").setBackground("#e9efde");
    setSetting_("results_spreadsheet_id", report.getId());
    setSetting_("results_emails", cleanEmails.join(","));
    setSetting_("results_url", report.getUrl());
    appendAudit_("syncResults", { totalBallots: results.totalBallots, authorizedReaders: cleanEmails.length });
    return { ok: true, reportUrl: report.getUrl(), totalBallots: results.totalBallots, authorizedReaders: cleanEmails.length };
  });
}

function requireAdmin_(input) {
  var secret = PropertiesService.getScriptProperties().getProperty("ADMIN_SECRET") || "";
  return Boolean(secret && safeEqual_(String(input.adminSecret || ""), secret));
}

function validateSession_(token) {
  if (!token || token.length < 40 || token.length > 200) return { ok: false, status: 401, message: "Session expirée. Ouvre à nouveau ton lien de vote." };
  var session = findBy_("Sessions", 0, sha256_(token));
  if (!session || session.row[3] === "1" || Date.parse(session.row[2]) <= Date.now()) {
    return { ok: false, status: 401, message: "Session expirée. Ouvre à nouveau ton lien de vote." };
  }
  return { ok: true, number: session.number, voterId: session.row[1], row: session.row };
}

function validateSelections_(selections, categories) {
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return "Le bulletin est incomplet.";
  categories = categories || activeCatalog_().categories;
  var ids = Object.keys(selections);
  if (ids.length !== categories.length) return "Choisis un nominé dans chaque catégorie.";
  for (var i = 0; i < categories.length; i += 1) {
    var category = categories[i];
    if (typeof selections[category.id] !== "string" || !category.nominees.some(function (nominee) { return nominee.id === selections[category.id]; })) {
      return "Le choix de « " + category.title + " » est invalide.";
    }
  }
  return "";
}

function calculateResults_() {
  var catalog = activeCatalog_();
  var activeHash = hashCatalog_(catalog);
  var categories = catalog.categories.map(function (category) {
    return {
      id: category.id,
      title: category.title,
      nominees: category.nominees.map(function (nominee) { return { id: nominee.id, name: nominee.name, votes: 0 }; }),
    };
  });
  var byId = {};
  categories.forEach(function (category) { byId[category.id] = category; });
  var valid = 0;
  table_("Ballots").forEach(function (row) {
    var answers;
    try { answers = JSON.parse(row[3]); } catch (_error) { return; }
    if (row[2] !== activeHash || validateSelections_(answers, catalog.categories)) return;
    valid += 1;
    Object.keys(answers).forEach(function (categoryId) {
      var category = byId[categoryId];
      var nominee = category && category.nominees.find(function (item) { return item.id === answers[categoryId]; });
      if (nominee) nominee.votes += 1;
    });
  });

  categories.forEach(function (category) {
    var sorted = category.nominees.slice().sort(function (left, right) { return right.votes - left.votes; });
    var lastVotes = null;
    var currentRank = 0;
    sorted.forEach(function (nominee, index) {
      if (nominee.votes !== lastVotes) currentRank = index + 1;
      nominee.rank = currentRank;
      nominee.tied = sorted.filter(function (item) { return item.votes === nominee.votes; }).length > 1;
      nominee.percentage = valid ? Math.round((nominee.votes / valid) * 10000) / 100 : 0;
      lastVotes = nominee.votes;
    });
    category.nominees = sorted;
  });
  return { totalBallots: valid, categories: categories };
}

function auditSummary_() {
  var catalog = activeCatalog_();
  var activeHash = hashCatalog_(catalog);
  var ballotRows = table_("Ballots");
  var voterRows = table_("Voters");
  var ids = {};
  var duplicates = 0;
  var valid = 0;
  var invalid = 0;
  ballotRows.forEach(function (row) {
    if (ids[row[0]]) duplicates += 1;
    ids[row[0]] = true;
    var answers;
    try { answers = JSON.parse(row[3]); } catch (_error) { invalid += 1; return; }
    if (row[2] !== activeHash || validateSelections_(answers, catalog.categories)) invalid += 1;
    else valid += 1;
  });
  var votersMarked = voterRows.filter(function (row) { return row[4] === "1"; }).length;
  return {
    validBallots: valid,
    invalidBallots: invalid,
    duplicateBallotIds: duplicates,
    votersMarkedAsVoted: votersMarked,
    ballotStatusDifference: votersMarked - ballotRows.length,
    checkedAt: new Date().toISOString(),
  };
}

function settings_() {
  var title = setting_("title") || DEFAULT_SETTINGS.title;
  var closingDate = setting_("closing_date") || DEFAULT_SETTINGS.closing_date;
  var closesAt = setting_("closes_at") || "";
  var isOpen = setting_("is_open") === "1";
  if (!closesAt || !Number.isFinite(Date.parse(closesAt)) || Date.parse(closesAt) <= Date.now()) isOpen = false;
  return { title: title, closingDate: closingDate, closesAt: closesAt, isOpen: isOpen };
}

function isVoteOpen_(settings) {
  return Boolean(settings.isOpen && settings.closesAt && Date.parse(settings.closesAt) > Date.now());
}

function activeLinkForVoter_(voterId) {
  var links = tableWithNumbers_("Links");
  for (var i = links.length - 1; i >= 0; i -= 1) {
    var link = links[i];
    if (link.row[1] === voterId && link.row[3] !== "1" && Date.parse(link.row[2]) > Date.now()) return link;
  }
  return null;
}

function latestLinkForVoter_(voterId) {
  var links = tableWithNumbers_("Links");
  for (var i = links.length - 1; i >= 0; i -= 1) if (links[i].row[1] === voterId) return links[i];
  return null;
}

function table_(name) {
  var sheet = sheet_(name);
  var last = sheet.getLastRow();
  return last < 2 ? [] : sheet.getRange(2, 1, last - 1, SHEET_HEADERS[name].length).getDisplayValues();
}

function tableWithNumbers_(name) {
  return table_(name).map(function (row, index) { return { row: row, number: index + 2 }; });
}

function findBy_(name, columnIndex, value) {
  var rows = tableWithNumbers_(name);
  for (var i = 0; i < rows.length; i += 1) if (rows[i].row[columnIndex] === value) return rows[i];
  return null;
}

function sheet_(name) {
  var id = PropertiesService.getScriptProperties().getProperty("MASTER_SPREADSHEET_ID");
  if (!id) throw new Error("MASTER_SPREADSHEET_ID is not configured.");
  var sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet " + name);
  return sheet;
}

function setting_(key) {
  var row = findBy_("Settings", 0, key);
  return row ? row.row[1] : null;
}

function setSetting_(key, value) {
  var existing = findBy_("Settings", 0, key);
  if (existing) writeCell_("Settings", existing.number, 2, String(value));
  else appendRow_("Settings", [key, String(value)]);
}

function appendRow_(name, values) {
  var sheet = sheet_(name);
  var row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  return row;
}

function writeRow_(name, rowNumber, values) {
  sheet_(name).getRange(rowNumber, 1, 1, values.length).setValues([values]);
}

function writeCell_(name, rowNumber, columnNumber, value) {
  sheet_(name).getRange(rowNumber, columnNumber).setValue(value);
}

function appendAudit_(action, details) {
  appendRow_("Audit", [Utilities.getUuid(), new Date().toISOString(), action, JSON.stringify(details || {})]);
}

function withLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var result = callback();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function catalogHash_() {
  return sha256_(JSON.stringify(CATALOG));
}

function activeCatalog_() {
  if (setting_("catalog_locked") !== "1") return CATALOG;
  var serialized = setting_("catalog_json");
  if (!serialized) throw new Error("Le catalogue gelé n’est pas disponible.");
  var snapshot = JSON.parse(serialized);
  if (!snapshot || !Array.isArray(snapshot.categories) || !Array.isArray(snapshot.pending)) {
    throw new Error("Le catalogue gelé est invalide.");
  }
  return snapshot;
}

function hashCatalog_(catalog) {
  return sha256_(JSON.stringify(catalog));
}

function nominationCount_(catalog) {
  catalog = catalog || activeCatalog_();
  return catalog.categories.reduce(function (sum, category) { return sum + category.nominees.length; }, 0);
}

function sha256_(value) {
  return digestHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8));
}

function otpHash_(code, voterId) {
  var pepper = PropertiesService.getScriptProperties().getProperty("OTP_HASH_PEPPER") || "";
  if (!pepper) throw new Error("OTP_HASH_PEPPER is not configured.");
  return digestHex_(Utilities.computeHmacSha256Signature(voterId + ":" + code, pepper));
}

function digestHex_(bytes) {
  return bytes.map(function (byte) { return (byte & 255).toString(16).padStart(2, "0"); }).join("");
}

function safeEqual_(left, right) {
  var a = sha256_(left);
  var b = sha256_(right);
  var difference = 0;
  for (var i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").toLowerCase();
}

function randomDigits_(length) {
  var digits = "";
  while (digits.length < length) digits += Utilities.getUuid().replace(/\D/g, "");
  return digits.slice(0, length);
}

function validEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function safeSheetText_(value) {
  var text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function fail_(status, message) {
  return { ok: false, __status: status, message: message };
}

function output_(payload, status) {
  var body = payload || {};
  body.__status = status || 200;
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
