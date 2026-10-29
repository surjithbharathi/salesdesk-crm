import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { phoneKeyOf } from './lead-phone.mjs';

// One database is one workspace. Keys belong to an active workspace administrator.
export function createIntegrations({ db, all, get, put, stamp, validate, tx, log, bad, googleKey = '', googleOwner = '' }) {
  db.exec(`CREATE TABLE IF NOT EXISTS integration_keys (
    id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, owner TEXT NOT NULL,
    name TEXT NOT NULL, scopes TEXT NOT NULL, expires TEXT NOT NULL, revoked INTEGER DEFAULT 0
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS integration_receipts (
    source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    record_id TEXT NOT NULL, fingerprint TEXT NOT NULL, received_at TEXT NOT NULL,
    PRIMARY KEY(source,external_id,kind)
  )`);
  db.exec('CREATE TABLE IF NOT EXISTS integration_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const digest = value => createHash('sha256').update(value).digest('hex');
  const available = ['leads:read', 'leads:write', 'leads:edit', 'leads:assign', 'tasks:read', 'tasks:write', 'notes:write', 'reports:read', 'insights:read', 'transcription:run'];
  const sources = ['website', 'google-ads', 'meta', 'indiamart', 'tradeindia', 'twenty', 'frappe', 'calendar', 'email', 'telephony', 'n8n'];
  function receipt(source, externalId, kind, payload, create) {
    if (!sources.includes(source) || typeof externalId !== 'string' || !externalId.trim() || externalId.length > 200)
      bad('Known source and stable externalId required');
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
    const fingerprint = digest(JSON.stringify(canonical(payload)));
    return tx(() => {
      const previous = db.prepare('SELECT * FROM integration_receipts WHERE source=? AND external_id=? AND kind=?').get(source, externalId, kind);
      if (previous) {
        if (previous.fingerprint !== fingerprint) bad('External ID already used with different data', 409);
        const record = get(kind, previous.record_id);
        if (!record) bad('Imported record was deleted; manual review required', 409);
        return { record, duplicate: true };
      }
      const record = create();
      db.prepare('INSERT INTO integration_receipts VALUES(?,?,?,?,?,?)')
        .run(source, externalId, kind, record.id, fingerprint, new Date().toISOString());
      return { record, duplicate: false };
    });
  }
  function checkOwner(payload) {
    if (payload.owner && !get('users', payload.owner)?.active) bad('Active owner required');
  }
  function createRecord(kind, payload, key, source) {
    checkOwner(payload);
    const record = stamp(validate(kind, payload));
    if(kind==='leads'){const phoneIdentity=phoneKeyOf(record),existing=phoneIdentity&&all('leads').find(l=>phoneKeyOf(l)===phoneIdentity);if(existing){log(existing.id,'Integration',`Repeat enquiry from ${source}`,{integrationKeyId:key?.id||'integration',integrationSource:source});return existing;}}
    put(kind, record);
    log(kind === 'leads' ? record.id : record.leadId, 'Integration', `${kind === 'leads' ? 'Lead' : 'Task'} imported from ${source}`,
      { integrationKeyId: key?.id || 'google-ads-webhook' });
    return record;
  }
  function ingest(header, payload) {
    const key = checkRequest(header, 'leads:write');
    if (!payload.lead || typeof payload.lead !== 'object' || Array.isArray(payload.lead)) bad('Mapped lead object required');
    return receipt(payload.source, payload.externalId, 'leads', payload.lead,
      () => createRecord('leads', payload.lead, key, payload.source));
  }
  function importNative(source, externalId, lead, enquiry = '') {
    if (!['indiamart', 'tradeindia'].includes(source)) bad('Unknown native lead provider');
    return receipt(source, externalId, 'leads', { lead, enquiry }, () => {
      const record = createRecord('leads', lead, { id: 'native:' + source }, source);
      if (enquiry) log(record.id, 'Note', enquiry, { integrationSource: source });
      return record;
    });
  }
  function tasks(header, method, payload, search) {
    const key = checkRequest(header, method === 'GET' ? 'tasks:read' : 'tasks:write');
    if (method === 'GET') return page('tasks', search);
    if (!payload.task || typeof payload.task !== 'object' || Array.isArray(payload.task)) bad('Task object required');
    return receipt(payload.source, payload.externalId, 'tasks', payload.task,
      () => createRecord('tasks', payload.task, key, payload.source));
  }
  function note(header, payload) {
    const key = checkRequest(header, 'notes:write');
    if (typeof payload.leadId !== 'string' || !get('leads', payload.leadId)) bad('Known lead required');
    if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 10000) bad('Note text required (maximum 10000 characters)');
    return receipt(payload.source, payload.externalId, 'activities', { leadId: payload.leadId, text: payload.text }, () =>
      log(payload.leadId, 'Note', payload.text.trim(), { integrationKeyId: key.id, integrationSource: payload.source }));
  }
  function page(kind, search) {
    const offset = Number(search.get('offset') || 0), limit = Number(search.get('limit') || 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) bad('Invalid pagination');
    const rows = all(kind);
    return { data: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null };
  }
  function google(payload) {
    rateLimit();
    if (googleKey.length < 32 || !googleOwner || !get('users', googleOwner)?.active) bad('Google Ads webhook is not configured', 503);
    const supplied = typeof payload.google_key === 'string' ? payload.google_key : '';
    if (!timingSafeEqual(Buffer.from(digest(supplied)), Buffer.from(digest(googleKey)))) bad('Invalid Google Ads webhook key', 401);
    if ('is_test' in payload && typeof payload.is_test !== 'boolean') bad('Invalid Google Ads test flag');
    if (payload.is_test === true) return { accepted: true, test: true };
    if (!Array.isArray(payload.user_column_data) || payload.user_column_data.length > 100) bad('Invalid Google Ads fields');
    const fields = Object.fromEntries(payload.user_column_data.filter(v => v && typeof v.column_id === 'string' && typeof v.string_value === 'string').map(v => [v.column_id, v.string_value]));
    const lead = { name: fields.FULL_NAME || [fields.FIRST_NAME, fields.LAST_NAME].filter(Boolean).join(' '),
      phone: fields.PHONE_NUMBER || fields.WORK_PHONE || '', email: fields.EMAIL || fields.WORK_EMAIL || '',
      company: fields.COMPANY_NAME || '', city: fields.CITY || '', source: 'Google Ads', owner: googleOwner };
    return receipt('google-ads', payload.lead_id, 'leads', lead, () => createRecord('leads', lead, null, 'google-ads'));
  }
  function status(identity) {
    admin(identity);
    return { mode: 'external-n8n', sources, scopes: available,
      n8n: { url: db.prepare("SELECT value FROM integration_settings WHERE key='n8n_url'").get()?.value || '', connectionVerified: false },
      googleAds: { configured: googleKey.length >= 32 && !!googleOwner && !!get('users', googleOwner)?.active, endpoint: '/integrations/webhooks/google-ads' },
      receipts: db.prepare('SELECT source,kind,count(*) AS count,max(received_at) AS lastReceived FROM integration_receipts GROUP BY source,kind').all() };
  }
  function saveWorkspace(identity, payload) {
    admin(identity);
    if (typeof payload.url !== 'string' || payload.url.length > 1000) bad('HTTPS n8n URL required');
    let url;
    try { url = new URL(payload.url); } catch { bad('HTTPS n8n URL required'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) bad('Use an HTTPS n8n URL without credentials, query or fragment');
    db.prepare("INSERT INTO integration_settings VALUES('n8n_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(url.href);
    // Saved link only: no network request or claim of API connectivity.
    return status(identity);
  }
  let windowStart = Date.now(), requests = 0;
  function rateLimit() {
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
    // Workspace-wide bound also limits random invalid-key attempts without unbounded maps.
    if (++requests > 600) bad('Integration rate limit reached; retry after one minute', 429);
  }
  function checkRequest(header, scope) {
    return authenticate(header, scope);
  }
  const admin = identity => {
    if (!identity || identity.user.role !== 'admin') bad('Workspace administrator required', 403);
  };
  function list(identity) {
    admin(identity);
    return db.prepare('SELECT id, owner, name, scopes, expires, revoked FROM integration_keys').all()
      .map(k => ({ ...k, scopes: JSON.parse(k.scopes) }));
  }
  function issue(identity, p) {
    admin(identity);
    if (db.prepare('SELECT count(*) AS count FROM integration_keys WHERE revoked=0 AND expires>?')
      .get(new Date().toISOString()).count >= 50) bad('Revoke an existing integration key first', 409);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 ||
        !Array.isArray(p.scopes) || !p.scopes.length || p.scopes.length > available.length || p.scopes.some(s => !available.includes(s)))
      bad('Name and valid scopes required');
    const token = 'sd_' + randomBytes(32).toString('base64url');
    const id = randomUUID(), expires = new Date(Date.now() + 90 * 86400000).toISOString();
    db.prepare('INSERT INTO integration_keys(id,digest,owner,name,scopes,expires) VALUES(?,?,?,?,?,?)')
      .run(id, digest(token), identity.user.id, p.name.trim(), JSON.stringify([...new Set(p.scopes)]), expires);
    return { id, token, expires }; // Never persist or return the raw key again.
  }
  function revoke(identity, id) {
    admin(identity);
    db.prepare('UPDATE integration_keys SET revoked=1 WHERE id=?').run(id);
    return { revoked: true };
  }
  function authenticate(header, scope) {
    rateLimit();
    const token = /^Bearer (sd_[A-Za-z0-9_-]{43})$/.exec(header || '')?.[1];
    if (!token) bad('Integration key required', 401);
    const key = db.prepare('SELECT * FROM integration_keys WHERE digest=?').get(digest(token));
    if (!key || key.revoked || key.expires <= new Date().toISOString()) bad('Invalid or expired integration key', 401);
    const account = db.prepare('SELECT role FROM auth_accounts WHERE user_id=?').get(key.owner);
    if (account?.role !== 'admin' || !get('users', key.owner)?.active) bad('Integration administrator inactive', 403);
    if (scope && !JSON.parse(key.scopes).includes(scope)) bad('Integration scope denied', 403);
    return key;
  }
  function leads(header, method, payload, search) {
    const key = checkRequest(header, method === 'GET' ? 'leads:read' : 'leads:write');
    if (method === 'GET') {
      return page('leads', search);
    }
    // Reuse CRM validation and distribution-independent ownership rules, not arbitrary record writes.
    return tx(() => {
      return createRecord('leads', payload, key, 'n8n');
    });
  }
  return { list, issue, revoke, leads, authenticate, ingest, tasks, note, google, status, saveWorkspace, importNative };
}
