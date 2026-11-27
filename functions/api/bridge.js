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

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function tokenEncryptionKey(secret) {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mpl-official-invite-token-v1:' + secret));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptInviteToken(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await tokenEncryptionKey(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { tokenCiphertext: base64UrlEncode(new Uint8Array(ciphertext)), tokenIv: base64UrlEncode(iv) };
}

async function decryptInviteToken(ciphertext, iv, secret) {
  const key = await tokenEncryptionKey(secret);
  const cleartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(iv) }, key, base64UrlDecode(ciphertext));
  return new TextDecoder().decode(cleartext);
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
      created_at TEXT NOT NULL,
      token_ciphertext TEXT,
      token_iv TEXT
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
    `CREATE TABLE IF NOT EXISTS nominee_photos (
      nominee_id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
`CREATE TABLE IF NOT EXISTS photo_library (
      id TEXT PRIMARY KEY,
      source_key TEXT UNIQUE,
      display_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      original_mime_type TEXT,
      original_data_base64 TEXT,
      assigned_alias TEXT,
      created_at TEXT NOT NULL
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

  const photoColumns = await db.prepare('PRAGMA table_info(nominee_photos)').all();
  const existingPhotoColumns = new Set((photoColumns.results || []).map((column) => column.name));
  if (!existingPhotoColumns.has('library_photo_id')) await db.prepare('ALTER TABLE nominee_photos ADD COLUMN library_photo_id TEXT').run();

  const libraryColumns = await db.prepare('PRAGMA table_info(photo_library)').all();
  const existingLibraryColumns = new Set((libraryColumns.results || []).map((column) => column.name));
  if (!existingLibraryColumns.has('original_mime_type')) await db.prepare('ALTER TABLE photo_library ADD COLUMN original_mime_type TEXT').run();
  if (!existingLibraryColumns.has('original_data_base64')) await db.prepare('ALTER TABLE photo_library ADD COLUMN original_data_base64 TEXT').run();

  const linkColumns = await db.prepare('PRAGMA table_info(invite_links)').all();
  const existingColumns = new Set((linkColumns.results || []).map((column) => column.name));
  if (!existingColumns.has('token_ciphertext')) await db.prepare('ALTER TABLE invite_links ADD COLUMN token_ciphertext TEXT').run();
  if (!existingColumns.has('token_iv')) await db.prepare('ALTER TABLE invite_links ADD COLUMN token_iv TEXT').run();

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

function catalogFromSettings(settings) {
  try {
    const catalog = JSON.parse(settings.catalog_json || '');
    if (catalog && Array.isArray(catalog.categories) && catalog.catalogVersion === ballot.catalogVersion) return catalog;
  } catch {}
  return ballot;
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
  const catalog = catalogFromSettings(settings);
  const [testStats, liveStats, linkStats, latestLive, linkRows, photoRows, libraryRows] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS total FROM ballots WHERE is_test = 1').first(),
    db.prepare('SELECT COUNT(*) AS total FROM ballots WHERE is_test = 0').first(),
    db.prepare("SELECT COUNT(*) AS total FROM invite_links l JOIN voters v ON v.id = l.voter_id WHERE v.is_test = 0 AND v.active = 1 AND v.voted = 0 AND l.used = 0 AND l.expires_at > ? AND (SELECT value FROM settings WHERE key = 'is_open') = '1'").bind(new Date().toISOString()).first(),
    db.prepare('SELECT MAX(created_at) AS created_at FROM ballots WHERE is_test = 0').first(),
    db.prepare('SELECT v.id AS id, v.name AS name, v.active AS active, v.voted AS voted, l.used AS used, l.expires_at AS expires_at, l.created_at AS created_at, l.token_ciphertext AS token_ciphertext, l.token_iv AS token_iv FROM invite_links l JOIN voters v ON v.id = l.voter_id WHERE v.is_test = 0 ORDER BY l.created_at DESC').all(),
    db.prepare('SELECT nominee_id, updated_at, mime_type, data_base64 FROM nominee_photos').all(),
    db.prepare('SELECT id, source_key, display_name, mime_type, data_base64, original_mime_type, original_data_base64, assigned_alias, created_at FROM photo_library ORDER BY created_at DESC').all(),
  ]);
  const now = Date.now();
  const origin = new URL(request.url).origin;
  const photoVersions = new Map((photoRows.results || []).map((row) => [row.nominee_id, row.updated_at]));
  const categories = catalog.categories.map((category) => ({
    ...category,
    nominees: category.nominees.map((nominee) => {
      const version = photoVersions.get(nominee.id);
      return { ...nominee, photoUrl: version ? '/api/nominee-photo?id=' + encodeURIComponent(nominee.id) + '&v=' + encodeURIComponent(version) : null };
    }),
  }));
  const aliasesMap = new Map();
  for (const category of categories) for (const nominee of category.nominees) {
    const key = String(nominee.name || '').trim().normalize('NFC').toLocaleLowerCase('fr');
    const record = aliasesMap.get(key) || { key, name: nominee.name, nomineeIds: [], categoryIds: [], photoUrl: null };
    record.nomineeIds.push(nominee.id);
    record.categoryIds.push(category.id);
    if (!record.photoUrl && nominee.photoUrl) record.photoUrl = nominee.photoUrl;
    aliasesMap.set(key, record);
  }
  const participants = [...aliasesMap.values()].map((item) => ({ ...item, categoryIds: [...new Set(item.categoryIds)] }));
  const originalPhotos = photoRows.results || [];
  const originalById = new Map(originalPhotos.map((row) => [row.nominee_id, row]));
  const aliasNames = new Map();
  for (const category of catalog.categories) for (const nominee of category.nominees) {
    const key = String(nominee.name || '').trim().normalize('NFC').toLocaleLowerCase('fr');
    if (!aliasNames.has(key)) aliasNames.set(key, nominee.name);
  }
  const libraryAliasKeys = new Set((libraryRows.results || []).map((row) =>
    String(row.assigned_alias || '').trim().normalize('NFC').toLocaleLowerCase('fr')));
  const migratedOriginals = [];
  const migratedKeys = new Set(libraryAliasKeys);
  for (const category of catalog.categories) for (const nominee of category.nominees) {
    const key = String(nominee.name || '').trim().normalize('NFC').toLocaleLowerCase('fr');
    const original = originalById.get(nominee.id);
    if (!original || migratedKeys.has(key)) continue;
    const id = 'original-' + nominee.id;
    migratedOriginals.push(db.prepare(
      'INSERT OR IGNORE INTO photo_library (id, source_key, display_name, mime_type, data_base64, assigned_alias, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, 'existing-' + nominee.id, 'Photo originale ' + nominee.name, original.mime_type, original.data_base64, nominee.name, original.updated_at));
    migratedKeys.add(key);
  }
  if (migratedOriginals.length) await db.batch(migratedOriginals);
  const refreshedLibrary = migratedOriginals.length
    ? await db.prepare('SELECT id, source_key, display_name, mime_type, data_base64, original_mime_type, original_data_base64, assigned_alias, created_at FROM photo_library ORDER BY created_at DESC').all()
    : { results: libraryRows.results || [] };
  const photoLibrary = (refreshedLibrary.results || []).map((row) => ({
    id: row.id, sourceKey: row.source_key, name: row.display_name, assignedAlias: row.assigned_alias,
    createdAt: row.created_at, photoData: 'data:' + row.mime_type + ';base64,' + row.data_base64,
    originalData: 'data:' + (row.original_mime_type || row.mime_type) + ';base64,' + (row.original_data_base64 || row.data_base64),
    needsPixelation: !row.original_data_base64,
  }));
  const assignedParticipants = participants.filter((person) => person.photoUrl).length;
  const officialLinkItems = await Promise.all((linkRows.results || []).map(async (row) => {
    let status = 'available';
    if (Number(row.voted) === 1) status = 'used';
    else if (Number(row.active) !== 1) status = 'disabled';
    else if (Number(row.used) === 1) status = 'used';
    else if (Date.parse(row.expires_at) <= now) status = 'expired';
    else if (settings.is_open !== '1') status = 'closed';
    let url = null;
    if (status === 'available' && row.token_ciphertext && row.token_iv) {
      try {
        const token = await decryptInviteToken(row.token_ciphertext, row.token_iv, String(env.ADMIN_SECRET || ''));
        url = origin + '/#t=' + encodeURIComponent(token);
      } catch { status = 'unrecoverable'; }
    } else if (status === 'available') status = 'unrecoverable';
    return { id: row.id, name: row.name, status, url, expiresAt: row.expires_at, createdAt: row.created_at };
  }));
  const nominationCount = categories.reduce((count, category) => count + category.nominees.length, 0);
  return reply({
    ok: true, title: settings.title || catalog.title || ballot.title,
    isOpen: settings.is_open === '1' && Date.parse(settings.closes_at || '') > Date.now(),
    testMode: settings.test_mode === '1', closesAt: settings.closes_at || ballot.closesAt,
    categoryCount: categories.length, nominationCount, categories, participants, photoLibrary,
    participantCount: participants.length, assignedParticipantCount: assignedParticipants,
    remainingPhotoCount: Math.max(0, participants.length - assignedParticipants), pending: catalog.pending || [],
    testBallots: Number(testStats?.total || 0), officialBallots: Number(liveStats?.total || 0),
    officialLinks: Number(linkStats?.total || 0), links: officialLinkItems, lastOfficialBallotAt: latestLive?.created_at || null,
  });
}
async function createTestLink(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const liveActivity = await db.prepare("SELECT (SELECT COUNT(*) FROM ballots WHERE is_test = 0) + (SELECT COUNT(*) FROM voters WHERE is_test = 0 AND active = 1) AS total").first();
  if (Number(liveActivity?.total || 0) > 0) return fail(409, "Des liens officiels existent déjà; le mode test est désactivé.");
  const token = randomToken();
  const tokenHash = await digest(token);
  const voterId = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + TEST_LINK_LIFETIME_MS).toISOString();
  const voterName = String(input.name || "Vote test").trim().slice(0, 100) || "Vote test";
  const email = `test-${voterId}@invalid.local`;
  await db.batch([
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
  const url = new URL(request.url);
  return reply({ ok: true, testUrl: `${url.origin}/#t=${encodeURIComponent(token)}`, expiresAt });
}

async function createOfficialLinks(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const requestedCount = Number(input.count ?? 7);
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > 1000) {
    return fail(400, 'Choisis entre 1 et 1 000 liens par création. Tu peux en ajouter autant de fois que nécessaire.');
  }
  const settings = await getSettings(db);
  const closesAtMs = Date.parse(settings.closes_at || ballot.closesAt || '');
  if (!Number.isFinite(closesAtMs) || closesAtMs <= Date.now()) return fail(409, 'La date de clôture du bulletin est passée ou invalide.');
  const totalExisting = await db.prepare('SELECT COUNT(*) AS total FROM invite_links l JOIN voters v ON v.id = l.voter_id WHERE v.is_test = 0').first();
  const existingCount = Number(totalExisting?.total || 0);
  if (existingCount > 0 && settings.is_open !== '1') return fail(409, 'Le scrutin est fermé. Aucun lien supplémentaire ne peut être activé.');
  const firstNumber = existingCount + 1;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(closesAtMs).toISOString();
  const links = [];
  for (let index = 0; index < requestedCount; index += 1) {
    const token = randomToken();
    const encrypted = await encryptInviteToken(token, String(env.ADMIN_SECRET || ''));
    links.push({
      token, tokenHash: await digest(token), tokenCiphertext: encrypted.tokenCiphertext, tokenIv: encrypted.tokenIv,
      voterId: crypto.randomUUID(), name: 'Bulletin ' + String(firstNumber + index).padStart(3, '0'),
    });
  }
  for (let start = 0; start < links.length; start += 100) {
    const chunk = links.slice(start, start + 100);
    const inserts = chunk.flatMap((link) => [
      db.prepare('INSERT INTO voters (id, name, email, active, voted, is_test, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)')
        .bind(link.voterId, link.name, 'bulletin-' + link.voterId + '@invalid.local', createdAt),
      db.prepare('INSERT INTO invite_links (token_hash, voter_id, expires_at, used, created_at, token_ciphertext, token_iv) VALUES (?, ?, ?, 0, ?, ?, ?)')
        .bind(link.tokenHash, link.voterId, expiresAt, createdAt, link.tokenCiphertext, link.tokenIv),
    ]);
    await db.batch(inserts);
  }
  await db.batch([
    db.prepare("INSERT INTO settings (key, value) VALUES ('test_mode', '0') ON CONFLICT(key) DO UPDATE SET value = '0'"),
    db.prepare("INSERT INTO settings (key, value) VALUES ('is_open', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"),
    db.prepare("INSERT INTO settings (key, value) VALUES ('closes_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(expiresAt),
    db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'addOfficialLinks', ?)")
      .bind(crypto.randomUUID(), createdAt, JSON.stringify({ count: links.length, expiresAt })),
  ]);
  const origin = new URL(request.url).origin;
  return reply({ ok: true, expiresAt, links: links.map((link) => ({ id: link.voterId, name: link.name, url: origin + '/#t=' + encodeURIComponent(link.token) })) });
}

async function disableOfficialLink(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const id = String(input.linkId || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'Ce lien est invalide.');
  const createdAt = new Date().toISOString();
  const result = await db.batch([
    db.prepare('UPDATE voters SET active = 0 WHERE id = ? AND is_test = 0 AND active = 1 AND voted = 0').bind(id),
    db.prepare('UPDATE invite_links SET used = 1 WHERE voter_id = ? AND used = 0 AND EXISTS (SELECT 1 FROM voters WHERE id = ? AND active = 0 AND voted = 0)').bind(id, id),
    db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) SELECT ?, ?, 'disableOfficialLink', ? WHERE EXISTS (SELECT 1 FROM voters WHERE id = ? AND active = 0 AND voted = 0)")
      .bind(crypto.randomUUID(), createdAt, JSON.stringify({ voterId: id }), id),
  ]);
  if (!result[0]?.meta?.changes) return fail(409, 'Ce lien n’est plus disponible ou a déjà été utilisé.');
  return reply({ ok: true });
}
async function adminUpdateNomineeName(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const categoryId = String(input.categoryId || '');
  const nomineeId = String(input.nomineeId || '');
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) return fail(400, 'Le nom doit contenir entre 1 et 80 caractères.');
  const settings = await getSettings(db);
  const catalog = catalogFromSettings(settings);
  const category = catalog.categories.find((item) => item.id === categoryId);
  const nominee = category?.nominees.find((item) => item.id === nomineeId);
  if (!nominee) return fail(404, 'Ce nominé n’existe pas dans cette catégorie.');
  nominee.name = name;
  const catalogJson = JSON.stringify(catalog);
  const catalogHash = await digest(catalogJson);
  await db.batch([
    db.prepare("UPDATE settings SET value = ? WHERE key = 'catalog_json'").bind(catalogJson),
    db.prepare("UPDATE settings SET value = ? WHERE key = 'catalog_hash'").bind(catalogHash),
    db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'renameNominee', ?)").bind(crypto.randomUUID(), new Date().toISOString(), JSON.stringify({ categoryId, nomineeId, name })),
  ]);
  return reply({ ok: true, nomineeId, name });
}


async function adminAddPhoto(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const dataUrl = String(input.photoData || '');
  const match = dataUrl.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/);
  const originalUrl = String(input.originalData || dataUrl);
  const originalMatch = originalUrl.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !originalMatch || match[2].length > 900000 || originalMatch[2].length > 900000) return fail(400, 'Image invalide ou trop volumineuse.');
  const id = String(input.photoId || crypto.randomUUID()).slice(0, 80);
  const sourceKey = input.sourceKey ? String(input.sourceKey).slice(0, 120) : null;
  const displayName = String(input.name || 'Portrait ajouté').slice(0, 120);
  const createdAt = new Date().toISOString();
  await db.prepare('INSERT OR IGNORE INTO photo_library (id, source_key, display_name, mime_type, data_base64, original_mime_type, original_data_base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, sourceKey, displayName, match[1], match[2], originalMatch[1], originalMatch[2], createdAt).run();
  return reply({ ok: true, id, sourceKey });
}


async function adminPixelateLibraryPhoto(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const photoId = String(input.photoId || '');
  const dataUrl = String(input.photoData || '');
  const match = dataUrl.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!photoId || !match || match[2].length > 900000) return fail(400, 'Version pixel art invalide ou trop volumineuse.');
  const photo = await db.prepare('SELECT id, mime_type, data_base64, assigned_alias FROM photo_library WHERE id = ?').bind(photoId).first();
  if (!photo) return fail(404, 'Cette photo n’est plus dans la galerie.');
  const updatedAt = new Date().toISOString();
  const writes = [
    db.prepare('UPDATE photo_library SET original_mime_type = COALESCE(original_mime_type, mime_type), original_data_base64 = COALESCE(original_data_base64, data_base64), mime_type = ?, data_base64 = ? WHERE id = ?')
      .bind(match[1], match[2], photoId),
  ];
  if (photo.assigned_alias) {
    const settings = await getSettings(db);
    const catalog = catalogFromSettings(settings);
    const normalize = (value) => String(value || '').trim().normalize('NFC').toLocaleLowerCase('fr');
    for (const category of catalog.categories) for (const nominee of category.nominees) {
      if (normalize(nominee.name) === normalize(photo.assigned_alias)) {
        writes.push(db.prepare('UPDATE nominee_photos SET mime_type = ?, data_base64 = ?, updated_at = ? WHERE nominee_id = ?')
          .bind(match[1], match[2], updatedAt, nominee.id));
      }
    }
  }
  writes.push(db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'pixelateLibraryPhoto', ?)")
    .bind(crypto.randomUUID(), updatedAt, JSON.stringify({ photoId, assignedAlias: photo.assigned_alias || null })));
  await db.batch(writes);
  return reply({ ok: true, photoId });
}

async function adminDeletePhoto(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const photoId = String(input.photoId || '');
  const photo = await db.prepare('SELECT id, assigned_alias FROM photo_library WHERE id = ?').bind(photoId).first();
  if (!photo) return fail(404, 'Cette photo n’est plus dans la galerie.');
  const writes = [];
  if (photo.assigned_alias) {
    const settings = await getSettings(db);
    const catalog = catalogFromSettings(settings);
    const normalize = (value) => String(value || '').trim().normalize('NFC').toLocaleLowerCase('fr');
    for (const category of catalog.categories) for (const nominee of category.nominees) {
      if (normalize(nominee.name) === normalize(photo.assigned_alias)) {
        writes.push(db.prepare('DELETE FROM nominee_photos WHERE nominee_id = ?').bind(nominee.id));
      }
    }
  }
  writes.push(db.prepare('DELETE FROM nominee_photos WHERE library_photo_id = ?').bind(photoId));
  writes.push(db.prepare('DELETE FROM photo_library WHERE id = ?').bind(photoId));
  writes.push(db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'deletePhoto', ?)")
    .bind(crypto.randomUUID(), new Date().toISOString(), JSON.stringify({ photoId, assignedAlias: photo.assigned_alias || null })));
  await db.batch(writes);
  return reply({ ok: true, photoId });
}

async function adminDeleteAllPhotos(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const photoRows = await db.prepare('SELECT id, assigned_alias FROM photo_library').all();
  const photos = photoRows.results || [];
  const settings = await getSettings(db);
  const catalog = catalogFromSettings(settings);
  const normalize = (value) => String(value || '').trim().normalize('NFC').toLocaleLowerCase('fr');
  const aliases = new Set(photos.map((photo) => normalize(photo.assigned_alias)).filter(Boolean));
  const nomineeIds = new Set();
  for (const category of catalog.categories) for (const nominee of category.nominees) {
    if (aliases.has(normalize(nominee.name))) nomineeIds.add(nominee.id);
  }
  const writes = [
    ...[...nomineeIds].map((id) => db.prepare('DELETE FROM nominee_photos WHERE nominee_id = ?').bind(id)),
    db.prepare('DELETE FROM nominee_photos WHERE library_photo_id IS NOT NULL'),
    db.prepare('DELETE FROM photo_library'),
    db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'deleteAllPhotos', ?)")
      .bind(crypto.randomUUID(), new Date().toISOString(), JSON.stringify({ count: photos.length })),
  ];
  await db.batch(writes);
  return reply({ ok: true, deletedCount: photos.length });
}


async function adminUnassignPhotoFromAlias(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const photoId = String(input.photoId || '');
  const photo = await db.prepare('SELECT id, assigned_alias FROM photo_library WHERE id = ?').bind(photoId).first();
  if (!photo) return fail(404, 'Cette photo n’est plus dans la galerie.');
  if (!photo.assigned_alias) return reply({ ok: true, photoId, unassigned: true });
  const settings = await getSettings(db);
  const catalog = catalogFromSettings(settings);
  const normalize = (value) => String(value || '').trim().normalize('NFC').toLocaleLowerCase('fr');
  const writes = [db.prepare('DELETE FROM nominee_photos WHERE library_photo_id = ?').bind(photoId)];
  for (const category of catalog.categories) for (const nominee of category.nominees) {
    if (normalize(nominee.name) === normalize(photo.assigned_alias)) {
      writes.push(db.prepare('DELETE FROM nominee_photos WHERE nominee_id = ?').bind(nominee.id));
    }
  }
  writes.push(db.prepare('UPDATE photo_library SET assigned_alias = NULL WHERE id = ?').bind(photoId));
  writes.push(db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'unassignPhotoFromAlias', ?)")
    .bind(crypto.randomUUID(), new Date().toISOString(), JSON.stringify({ photoId, aliasName: photo.assigned_alias })));
  await db.batch(writes);
  return reply({ ok: true, photoId, aliasName: photo.assigned_alias });
}

async function adminRenameAlias(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const oldAlias = String(input.oldAlias || '').trim();
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  if (!oldAlias || !name || name.length > 80) return fail(400, 'Saisis un alias valide (1 à 80 caractères).');
  const settings = await getSettings(db);
  const catalog = catalogFromSettings(settings);
  const normalize = (value) => String(value || '').trim().normalize('NFC').toLocaleLowerCase('fr');
  let changed = 0;
  for (const category of catalog.categories) for (const nominee of category.nominees) {
    if (normalize(nominee.name) === normalize(oldAlias)) { nominee.name = name; changed++; }
  }
  if (!changed) return fail(404, 'Cet alias n’existe plus dans le catalogue.');
  const catalogJson = JSON.stringify(catalog);
  const catalogHash = await digest(catalogJson);
  await db.batch([
    db.prepare("UPDATE settings SET value = ? WHERE key = 'catalog_json'").bind(catalogJson),
    db.prepare("UPDATE settings SET value = ? WHERE key = 'catalog_hash'").bind(catalogHash),
    db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'renameAlias', ?)").bind(crypto.randomUUID(), new Date().toISOString(), JSON.stringify({ oldAlias, name, changed })),
  ]);
  return reply({ ok: true, name, changed });
}

async function adminAssignPhotoToAlias(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const photoId = String(input.photoId || '');
  const aliasName = String(input.aliasName || '').trim();
  const photo = await db.prepare('SELECT id, mime_type, data_base64, assigned_alias FROM photo_library WHERE id = ?').bind(photoId).first();
  if (!photo) return fail(404, 'La photo sélectionnée n’est plus disponible.');
  const settings = await getSettings(db);
  const catalog = catalogFromSettings(settings);
  const normalize = (value) => String(value || '').trim().normalize('NFC').toLocaleLowerCase('fr');
  const nominees = catalog.categories.flatMap((category) => category.nominees
    .filter((nominee) => normalize(nominee.name) === normalize(aliasName))
    .map((nominee) => ({ ...nominee, categoryId: category.id })));
  if (!nominees.length) return fail(404, 'Cet alias n’existe plus dans le catalogue.');
  const updatedAt = new Date().toISOString();
  const writes = [];
  if (photo.assigned_alias && normalize(photo.assigned_alias) !== normalize(nominees[0].name)) {
    writes.push(db.prepare('DELETE FROM nominee_photos WHERE library_photo_id = ?').bind(photoId));
    for (const category of catalog.categories) for (const oldNominee of category.nominees) {
      if (normalize(oldNominee.name) === normalize(photo.assigned_alias)) {
        writes.push(db.prepare('DELETE FROM nominee_photos WHERE nominee_id = ?').bind(oldNominee.id));
      }
    }
  }
  writes.push(db.prepare('UPDATE photo_library SET assigned_alias = NULL WHERE assigned_alias = ?').bind(nominees[0].name));
  if (photo.assigned_alias && normalize(photo.assigned_alias) !== normalize(nominees[0].name)) {
    writes.push(db.prepare('UPDATE photo_library SET assigned_alias = NULL WHERE assigned_alias = ?').bind(photo.assigned_alias));
  }
  const upsertSql = 'INSERT INTO nominee_photos (nominee_id, category_id, mime_type, data_base64, updated_at, library_photo_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(nominee_id) DO UPDATE SET category_id = excluded.category_id, mime_type = excluded.mime_type, data_base64 = excluded.data_base64, updated_at = excluded.updated_at, library_photo_id = excluded.library_photo_id';
  writes.push(...nominees.map((nominee) => db.prepare(upsertSql).bind(nominee.id, nominee.categoryId, photo.mime_type, photo.data_base64, updatedAt, photoId)));
  writes.push(db.prepare('UPDATE photo_library SET assigned_alias = ? WHERE id = ?').bind(nominees[0].name, photoId));
  writes.push(db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'assignPhotoToAlias', ?)").bind(crypto.randomUUID(), updatedAt, JSON.stringify({ photoId, aliasName: nominees[0].name, nominations: nominees.length })));
  await db.batch(writes);
  return reply({ ok: true, aliasName: nominees[0].name, nominations: nominees.length });
}

async function adminSetNomineePhoto(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const categoryId = String(input.categoryId || '');
  const nomineeId = String(input.nomineeId || '');
  const settings = await getSettings(db);
  const catalog = catalogFromSettings(settings);
  const category = catalog.categories.find((item) => item.id === categoryId);
  if (!category?.nominees.some((item) => item.id === nomineeId)) return fail(404, 'Ce nominé n’existe pas dans cette catégorie.');
  const dataUrl = String(input.photoData || '');
  const match = dataUrl.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length > 1300000) return fail(400, 'Image invalide ou trop volumineuse. Choisis une image de moins de 1 Mo.');
  const encoded = match[2];
  const updatedAt = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT INTO nominee_photos (nominee_id, category_id, mime_type, data_base64, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(nominee_id) DO UPDATE SET category_id = excluded.category_id, mime_type = excluded.mime_type, data_base64 = excluded.data_base64, updated_at = excluded.updated_at').bind(nomineeId, categoryId, match[1], encoded, updatedAt),
    db.prepare("INSERT INTO audit (event_id, created_at, action, details_json) VALUES (?, ?, 'setNomineePhoto', ?)").bind(crypto.randomUUID(), updatedAt, JSON.stringify({ categoryId, nomineeId })),
  ]);
  return reply({ ok: true, nomineeId, updatedAt, photoUrl: '/api/nominee-photo?id=' + encodeURIComponent(nomineeId) + '&v=' + encodeURIComponent(updatedAt) });
}
async function adminResults(db, env, input, request) {
  const auth = await requireAdmin(request, env, input);
  if (auth.error) return auth.error;
  const settings = await getSettings(db);
  const catalog = catalogFromSettings(settings);
  const rows = await db.prepare('SELECT answers_json FROM ballots WHERE is_test = 0').all();
  const counts = new Map();
  for (const category of catalog.categories) counts.set(category.id, new Map(category.nominees.map((nominee) => [nominee.id, 0])));
  for (const row of rows.results || []) {
    let selections;
    try { selections = JSON.parse(row.answers_json); } catch { continue; }
    for (const [categoryId, nomineeId] of Object.entries(selections || {})) {
      const categoryCounts = counts.get(categoryId);
      if (categoryCounts?.has(nomineeId)) categoryCounts.set(nomineeId, categoryCounts.get(nomineeId) + 1);
    }
  }
  return reply({
    ok: true, totalBallots: (rows.results || []).length,
    categories: catalog.categories.map((category) => ({
      id: category.id, title: category.title,
      nominees: category.nominees.map((nominee) => ({ id: nominee.id, name: nominee.name, votes: counts.get(category.id)?.get(nominee.id) || 0 })),
    })),
  });
}
async function claimInvite(db, input) {
  const token = String(input.token || "");
  if (!/^[a-f0-9]{64}$/i.test(token)) return fail(401, "Lien invalide ou expiré.");
  const tokenHash = await digest(token);
  const row = await db.prepare(`
    SELECT l.token_hash, l.expires_at, l.used, v.id AS voter_id, v.voted, v.active, v.is_test
    FROM invite_links l JOIN voters v ON v.id = l.voter_id
    WHERE l.token_hash = ?
  `).bind(tokenHash).first();
  const settings = await getSettings(db);
  if (!row || row.active !== 1 || row.voted === 1 || row.used === 1
      || Date.parse(row.expires_at) <= Date.now()
      || settings.test_mode !== String(row.is_test)
      || settings.is_open !== "1" || Date.parse(settings.closes_at || "") <= Date.now()) {
    return fail(410, "Ce lien a expiré ou a déjà servi à voter.");
  }

  const session = randomToken();
  const sessionHash = await digest(session);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  const created = await db.prepare(`
    INSERT INTO sessions (session_hash, voter_id, link_hash, expires_at, used, created_at)
    SELECT ?, ?, ?, ?, 0, ?
    WHERE EXISTS (
      SELECT 1 FROM invite_links l JOIN voters v ON v.id = l.voter_id
      WHERE l.token_hash = ? AND l.used = 0 AND l.expires_at > ? AND v.voted = 0 AND v.active = 1 AND v.is_test = ?
    )
  `).bind(sessionHash, row.voter_id, tokenHash, expiresAt, now, tokenHash, now, Number(row.is_test)).run();
  if (!created.meta?.changes) return fail(410, "Ce lien a expiré ou a déjà servi à voter.");
  return reply({ ok: true, session, expiresAt });
}

async function getBallot(db, input) {
  const sessionHash = await digest(String(input.session || ''));
  const row = await db.prepare(`
    SELECT s.expires_at AS session_expires, s.used AS session_used,
      l.expires_at AS link_expires, l.used AS link_used, v.voted, v.active, v.is_test
    FROM sessions s JOIN invite_links l ON l.token_hash = s.link_hash
    JOIN voters v ON v.id = s.voter_id WHERE s.session_hash = ?
  `).bind(sessionHash).first();
  const settings = await getSettings(db);
  if (!row || row.active !== 1 || row.voted === 1 || row.link_used === 1 || row.session_used === 1
      || Date.parse(row.session_expires) <= Date.now() || Date.parse(row.link_expires) <= Date.now()) {
    return fail(401, 'La session de vote a expiré. Ouvre à nouveau ton lien personnel.');
  }
  if (settings.test_mode !== String(row.is_test) || settings.is_open !== '1' || Date.parse(settings.closes_at || '') <= Date.now()) {
    return fail(410, 'La période du scrutin est terminée.');
  }
  const catalog = catalogFromSettings(settings);
  const photoRows = await db.prepare('SELECT nominee_id, updated_at FROM nominee_photos').all();
  const photoVersions = new Map((photoRows.results || []).map((item) => [item.nominee_id, item.updated_at]));
  const categories = catalog.categories.map((category) => ({
    ...category,
    nominees: category.nominees.map((nominee) => {
      const version = photoVersions.get(nominee.id);
      return { ...nominee, photoUrl: version ? '/api/nominee-photo?id=' + encodeURIComponent(nominee.id) + '&v=' + encodeURIComponent(version) : null };
    }),
  }));
  return reply({ ok: true, title: settings.title || catalog.title || ballot.title, closesAt: settings.closes_at, categories });
}
async function submitBallot(db, input) {
  const sessionToken = String(input.session || "");
  if (!/^[a-f0-9]{64}$/i.test(sessionToken)) return fail(401, "La session de vote a expiré.");
  const sessionHash = await digest(sessionToken);
  const sessionInfo = await db.prepare(`
    SELECT v.is_test FROM sessions s
    JOIN invite_links l ON l.token_hash = s.link_hash
    JOIN voters v ON v.id = s.voter_id
    WHERE s.session_hash = ?
  `).bind(sessionHash).first();
  if (!sessionInfo) return fail(401, "La session de vote a expiré.");
  const isTest = Number(sessionInfo.is_test);
  const settings = await getSettings(db);
  if (settings.test_mode !== String(isTest) || settings.is_open !== "1" || Date.parse(settings.closes_at || "") <= Date.now()) {
    return fail(410, "La période du scrutin est terminée.");
  }
  const catalog = catalogFromSettings(settings);
  const selectionError = validateSelections(input.selections, catalog.categories);
  if (selectionError) return fail(400, selectionError);
  const ballotId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const catalogHash = await digest(JSON.stringify(catalog));
  const auditAction = isTest ? "submitTestBallot" : "submitOfficialBallot";
  const result = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO ballots (ballot_id, voter_id, created_at, catalog_hash, answers_json, is_test)
      SELECT ?, v.id, ?, ?, ?, v.is_test
      FROM sessions s JOIN invite_links l ON l.token_hash = s.link_hash JOIN voters v ON v.id = s.voter_id
      WHERE s.session_hash = ? AND s.used = 0 AND s.expires_at > ?
        AND l.used = 0 AND l.expires_at > ? AND v.active = 1 AND v.voted = 0
        AND v.is_test = ?
        AND (SELECT value FROM settings WHERE key = 'test_mode') = ?
        AND (SELECT value FROM settings WHERE key = 'is_open') = '1'
        AND (SELECT value FROM settings WHERE key = 'closes_at') > ?
    `).bind(ballotId, createdAt, catalogHash, JSON.stringify(input.selections), sessionHash, createdAt, createdAt, isTest, String(isTest), createdAt),
    db.prepare("UPDATE voters SET voted = 1 WHERE id = (SELECT voter_id FROM ballots WHERE ballot_id = ?) AND voted = 0").bind(ballotId),
    db.prepare("UPDATE invite_links SET used = 1 WHERE token_hash = (SELECT link_hash FROM sessions WHERE session_hash = ?) AND EXISTS (SELECT 1 FROM ballots WHERE ballot_id = ?)").bind(sessionHash, ballotId),
    db.prepare("UPDATE sessions SET used = 1 WHERE session_hash = ? AND EXISTS (SELECT 1 FROM ballots WHERE ballot_id = ?)").bind(sessionHash, ballotId),
    db.prepare(`INSERT INTO audit (event_id, created_at, action, details_json) SELECT ?, ?, '${auditAction}', ? WHERE EXISTS (SELECT 1 FROM ballots WHERE ballot_id = ?)`)
      .bind(crypto.randomUUID(), createdAt, JSON.stringify({ ballotId, catalogHash }), ballotId),
  ]);
  if (!result[0]?.meta?.changes) return fail(409, "Ce lien a déjà servi à voter ou le scrutin est fermé.");
  return reply({ ok: true, receipt: ballotId });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, "Origine de requête refusée.");
  if (!env.DB) return fail(503, "La base D1 n’est pas reliée au site.");

  let input;
  try {
    const body = await request.text();
    if (body.length > 1400000) return fail(413, "Image trop volumineuse. Réduis sa taille puis réessaie.");
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
      case "adminCreateOfficialLinks": return await createOfficialLinks(env.DB, env, input, request);
      case "adminDisableOfficialLink": return await disableOfficialLink(env.DB, env, input, request);
      case "adminUpdateNomineeName": return await adminUpdateNomineeName(env.DB, env, input, request);
      case "adminSetNomineePhoto": return await adminSetNomineePhoto(env.DB, env, input, request);
      case "adminAddPhoto": return await adminAddPhoto(env.DB, env, input, request);
      case "adminPixelateLibraryPhoto": return await adminPixelateLibraryPhoto(env.DB, env, input, request);
      case "adminDeletePhoto": return await adminDeletePhoto(env.DB, env, input, request);
      case "adminDeleteAllPhotos": return await adminDeleteAllPhotos(env.DB, env, input, request);
      case "adminRenameAlias": return await adminRenameAlias(env.DB, env, input, request);
      case "adminUnassignPhotoFromAlias": return await adminUnassignPhotoFromAlias(env.DB, env, input, request);
      case "adminAssignPhotoToAlias": return await adminAssignPhotoToAlias(env.DB, env, input, request);
      case "adminResults": return await adminResults(env.DB, env, input, request);
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
