import { ballot } from "../../public/data.js";

const SESSION_LIFETIME_MS = 20 * 60 * 1000;
const TEST_LINK_LIFETIME_MS = 60 * 60 * 1000;

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function fail(status, message) {
  return reply({ ok: false, message }, status);
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function ensureSchema(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS voters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      voted INTEGER NOT NULL DEFAULT 0,
      is_test INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS invite_links (
      token_hash TEXT PRIMARY KEY,
      voter_id TEXT NOT NULL REFERENCES voters(id),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      session_hash TEXT PRIMARY KEY,
      voter_id TEXT NOT NULL REFERENCES voters(id),
      link_hash TEXT NOT NULL REFERENCES invite_links(token_hash),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ballots (
      ballot_id TEXT PRIMARY KEY,
      voter_id TEXT NOT NULL UNIQUE REFERENCES voters(id),
      created_at TEXT NOT NULL,
      catalog_hash TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      is_test INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS audit (
      event_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_links_voter ON invite_links(voter_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_voter ON sessions(voter_id)",
    "CREATE INDEX IF NOT EXISTS idx_ballots_test ON ballots(is_test, created_at)",
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));

  const catalogHash = await digest(JSON.stringify(ballot));
  const defaults = [
    ["title", ballot.title],
    ["closing_date", ballot.closingDate],
    ["closes_at", ballot.closesAt],
    ["is_open", "0"],
    ["test_mode", "0"],
    ["catalog_hash", catalogHash],
    ["catalog_json", JSON.stringify(ballot)],
  ];
  await db.batch(defaults.map(([key, value]) => db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  ).bind(key, value)));
}

async function getSettings(db) {
  const result = await db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries((result.results || []).map(({ key, value }) => [key, value]));
}

function validateSelections(selections, categories) {
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return "Le bulletin est incomplet.";
  if (Object.keys(selections).length !== categories.length) return "Choisis un nominé dans chaque catégorie.";
  for (const category of categories) {
    if (typeof selections[category.id] !== "string" || !category.nominees.some((nominee) => nominee.id === selections[category.id])) {
      return `Le choix de « ${category.title} » est invalide.`;
    }
  }
  return "";
}

async function requireAdmin(request, env, input) {
  const expected = String(env.ADMIN_SECRET || "");
  if (expected.length < 32) return { error: fail(503, "La clé organisateur doit être configurée dans Cloudflare avant le test.") };
  if (!safeEqual(input.adminSecret || "", expected)) return { error: fail(401, "Clé organisateur incorrecte.") };
  return { ok: true };
}

async function adminState(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const settings = await getSettings(db);
  const stats = await db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent FROM ballots WHERE is_test = 1",
  ).bind(new Date(Date.now() - TEST_LINK_LIFETIME_MS).toISOString()).first();
  const last = await db.prepare(
    "SELECT ballot_id, created_at, answers_json FROM ballots WHERE is_test = 1 ORDER BY created_at DESC LIMIT 1",
  ).first();
  return reply({
    ok: true,
    title: settings.title || ballot.title,
    isOpen: settings.is_open === "1" && Date.parse(settings.closes_at || "") > Date.now(),
    testMode: settings.test_mode === "1",
    closesAt: settings.closes_at || ballot.closesAt,
    categoryCount: ballot.categories.length,
    nominationCount: ballot.categories.reduce((count, category) => count + category.nominees.length, 0),
    pending: ballot.pending || [],
    testBallots: Number(stats?.total || 0),
    lastTestBallot: last ? { id: last.ballot_id, createdAt: last.created_at } : null,
  });
}

async function createTestLink(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const token = randomToken();
  const tokenHash = await digest(token);
  const voterId = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + TEST_LINK_LIFETIME_MS).toISOString();
  const voterName = String(input.name || "Vote test").trim().slice(0, 100) || "Vote test";
  const email = `test-${voterId}@invalid.local`;
  const batch = await db.batch([
    db.prepare("INSERT INTO voters (id, name, email, active, voted, is_test, created_at) VALUES (?, ?, ?, 1, 0, 1, ?)")
      .bind(voterId, voterName, email, createdAt),
    db.prepare("INSERT INTO invite_links (token_hash, voter_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)")
      .bind(tokenHash, voterId, expiresAt, createdAt),
    db.prepare("INSERT INTO settings (key, value) VALUES ('test_mode', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"),
    db.prepare("INSERT INTO settings (key, value) VALUES ('is_open', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"),
    db.prepare("INSERT INTO settings (key, value) VALUES ('closes_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(expiresAt),
    db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'createTestLink', ?)")
      .bind(crypto.randomUUID(), createdAt, JSON.stringify({ voterId, expiresAt })),
  ]);
  if (!batch) return fail(503, "Impossible de créer le lien test.");
  const url = new URL(request.url);
  const testUrl = `${url.origin}/#t=${encodeURIComponent(token)}`;
  return reply({ ok: true, testUrl, expiresAt });
}

async function claimInvite(db, input) {
  const token = String(input.token || "");
  if (!/^[a-f0-9]{64}$/i.test(token)) return fail(401, "Lien de test invalide ou expiré.");
  const tokenHash = await digest(token);
  const row = await db.prepare(`
    SELECT l.token_hash, l.expires_at, l.used, v.id AS voter_id, v.voted, v.active, v.is_test
    FROM invite_links l JOIN voters v ON v.id = l.voter_id
    WHERE l.token_hash = ?
  `).bind(tokenHash).first();
  const settings = await getSettings(db);
  if (!row || row.is_test !== 1 || row.active !== 1 || row.voted === 1 || row.used === 1
      || Date.parse(row.expires_at) <= Date.now() || settings.test_mode !== "1"
      || settings.is_open !== "1" || Date.parse(settings.closes_at || "") <= Date.now()) {
    return fail(410, "Ce lien de test a expiré ou a déjà servi à voter.");
  }

  const session = randomToken();
  const sessionHash = await digest(session);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  const created = await db.prepare(`
    INSERT INTO sessions (session_hash, voter_id, link_hash, expires_at, used, created_at)
    SELECT ?, ?, ?, ?, 0, ?
    WHERE EXISTS (
      SELECT 1 FROM invite_links l JOIN voters v ON v.id = l.voter_id
      WHERE l.token_hash = ? AND l.used = 0 AND l.expires_at > ? AND v.voted = 0 AND v.active = 1 AND v.is_test = 1
    )
  `).bind(sessionHash, row.voter_id, tokenHash, expiresAt, new Date().toISOString(), tokenHash, new Date().toISOString()).run();
  if (!created.meta?.changes) return fail(410, "Ce lien de test a expiré ou a déjà servi à voter.");
  return reply({ ok: true, session, expiresAt });
}

async function getBallot(db, input) {
  const sessionHash = await digest(String(input.session || ""));
  const row = await db.prepare(`
    SELECT s.expires_at AS session_expires, s.used AS session_used,
      l.expires_at AS link_expires, l.used AS link_used,
      v.voted, v.active, v.is_test
    FROM sessions s
    JOIN invite_links l ON l.token_hash = s.link_hash
    JOIN voters v ON v.id = s.voter_id
    WHERE s.session_hash = ?
  `).bind(sessionHash).first();
  const settings = await getSettings(db);
  if (!row || row.is_test !== 1 || row.active !== 1 || row.voted === 1 || row.link_used === 1 || row.session_used === 1
      || Date.parse(row.session_expires) <= Date.now() || Date.parse(row.link_expires) <= Date.now()) {
    return fail(401, "La session de vote a expiré. Ouvre à nouveau le lien de test.");
  }
  if (settings.test_mode !== "1" || settings.is_open !== "1" || Date.parse(settings.closes_at || "") <= Date.now()) {
    return fail(410, "La période du test est terminée.");
  }
  return reply({ ok: true, title: ballot.title, closesAt: settings.closes_at, categories: ballot.categories });
}

async function submitBallot(db, input) {
  const settings = await getSettings(db);
  if (settings.test_mode !== "1" || settings.is_open !== "1" || Date.parse(settings.closes_at || "") <= Date.now()) {
    return fail(410, "La période du test est terminée.");
  }
  const selectionError = validateSelections(input.selections, ballot.categories);
  if (selectionError) return fail(400, selectionError);
  const sessionToken = String(input.session || "");
  if (!/^[a-f0-9]{64}$/i.test(sessionToken)) return fail(401, "La session de vote a expiré.");
  const sessionHash = await digest(sessionToken);
  const ballotId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const catalogHash = await digest(JSON.stringify(ballot));
  const result = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO ballots (ballot_id, voter_id, created_at, catalog_hash, answers_json, is_test)
      SELECT ?, v.id, ?, ?, ?, 1
      FROM sessions s JOIN invite_links l ON l.token_hash = s.link_hash JOIN voters v ON v.id = s.voter_id
      WHERE s.session_hash = ? AND s.used = 0 AND s.expires_at > ?
        AND l.used = 0 AND l.expires_at > ? AND v.active = 1 AND v.voted = 0 AND v.is_test = 1
        AND (SELECT value FROM settings WHERE key = 'test_mode') = '1'
        AND (SELECT value FROM settings WHERE key = 'is_open') = '1'
        AND (SELECT value FROM settings WHERE key = 'closes_at') > ?
    `).bind(ballotId, createdAt, catalogHash, JSON.stringify(input.selections), sessionHash, createdAt, createdAt, createdAt),
    db.prepare("UPDATE voters SET voted = 1 WHERE id = (SELECT voter_id FROM ballots WHERE ballot_id = ?) AND voted = 0")
      .bind(ballotId),
    db.prepare("UPDATE invite_links SET used = 1 WHERE token_hash = (SELECT link_hash FROM sessions WHERE session_hash = ?) AND EXISTS (SELECT 1 FROM ballots WHERE ballot_id = ?)")
      .bind(sessionHash, ballotId),
    db.prepare("UPDATE sessions SET used = 1 WHERE session_hash = ? AND EXISTS (SELECT 1 FROM ballots WHERE ballot_id = ?)")
      .bind(sessionHash, ballotId),
    db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) SELECT ?, ?, 'submitTestBallot', ? WHERE EXISTS (SELECT 1 FROM ballots WHERE ballot_id = ?)")
      .bind(crypto.randomUUID(), createdAt, JSON.stringify({ ballotId, catalogHash }), ballotId),
  ]);
  if (!result[0]?.meta?.changes) return fail(409, "Ce lien a déjà servi à voter ou le test est fermé.");
  return reply({ ok: true, receipt: ballotId });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, "Origine de requête refusée.");
  if (!env.DB) return fail(503, "La base D1 n’est pas reliée au site.");

  let input;
  try {
    const body = await request.text();
    if (body.length > 65536) return fail(413, "Requête trop volumineuse.");
    input = JSON.parse(body || "{}");
  } catch {
    return fail(400, "Requête illisible.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail(400, "Requête invalide.");

  try {
    await ensureSchema(env.DB);
    switch (String(input.action || "")) {
      case "claimInvite": return await claimInvite(env.DB, input);
      case "getBallot": return await getBallot(env.DB, input);
      case "submitBallot": return await submitBallot(env.DB, input);
      case "adminState": return await adminState(env.DB, env, input, request);
      case "adminCreateTestLink": return await createTestLink(env.DB, env, input, request);
      case "adminCloseVote": {
        const auth = await requireAdmin(request, env, input);
        if (auth.error) return auth.error;
        await env.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'is_open'").run();
        await env.DB.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'closeTestVote', '{}')")
          .bind(crypto.randomUUID(), new Date().toISOString()).run();
        return reply({ ok: true, isOpen: false });
      }
      default: return fail(400, "Opération inconnue.");
    }
  } catch (error) {
    console.error("D1 vote API error:", error?.message || error);
    return fail(503, "Le service de vote est momentanément indisponible.");
  }
}
