import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createIntegrations } from './integrations.mjs';
import { createCrmMcp } from './crm-mcp.mjs';

function fixture(scopes = ['leads:read', 'leads:edit', 'leads:assign', 'reports:read', 'insights:read']) {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE auth_accounts(user_id TEXT,role TEXT); INSERT INTO auth_accounts VALUES('admin','admin'); CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id));");
  const get = (kind, id) => { const r = db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id); return r ? JSON.parse(r.body) : null; };
  const put = (kind, value) => db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, value.id, JSON.stringify(value));
  const all = kind => db.prepare('SELECT body FROM records WHERE kind=?').all(kind).map(r => JSON.parse(r.body));
  const now = () => Date.parse('2026-10-27T12:00:00Z');
  const stamp = value => ({ ...value, id: randomUUID(), createdAt: new Date(now()).toISOString() });
  const bad = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
  const validate = (kind, patch, old = {}) => ({ ...old, ...patch });
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const log = (leadId, type, text, extra) => { const row = stamp({ leadId, type, text, ...extra }); put('activities', row); return row; };
  put('users', { id: 'admin', active: true }); put('users', { id: 'sales', active: true });
  put('leads', { id: 'lead', name: 'Synthetic Customer', owner: 'admin', createdAt: '2026-10-27T06:00:00Z', updatedAt: '2026-10-27T06:00:00Z' });
  const identity = { user: { id: 'admin', role: 'admin' } };
  const integrations = createIntegrations({ db, all, get, put, stamp, validate, tx, log, bad });
  const key = integrations.issue(identity, { name: 'MCP fixture', scopes });
  const mcp = createCrmMcp({ db, authorize: integrations.authenticate, all, get, put, validate, tx, log, now });
  return { db, get, put, mcp, key, identity, integrations, header: 'Bearer ' + key.token };
}

test('MCP initialize and tool discovery require active scoped workspace keys', async () => {
  const f = fixture(['leads:read']);
  const init = await f.mcp.rpc(f.header, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(init.result.protocolVersion, '2025-11-25');
  const tools = await f.mcp.rpc(f.header, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(tools.result.tools.map(t => t.name), ['leads_list', 'lead_get']);
  await assert.rejects(() => f.mcp.call(f.header, 'lead_assign', { leadId: 'lead', owner: 'sales', expectedUpdatedAt: f.get('leads', 'lead').updatedAt }), /scope/);
  f.integrations.revoke(f.identity, f.key.id);
  await assert.rejects(() => f.mcp.rpc(f.header, { jsonrpc: '2.0', id: 3, method: 'ping' }), /expired/);
  f.db.close();
});

test('MCP edits/assignments require exact one-use browser approval and reject stale versions', async () => {
  const f = fixture();
  const args = { leadId: 'lead', owner: 'sales', expectedUpdatedAt: f.get('leads', 'lead').updatedAt };
  const proposal = await f.mcp.call(f.header, 'lead_assign', args);
  assert.equal(f.get('leads', 'lead').owner, 'admin');
  assert.equal(proposal.approvalRequired, true);
  await assert.rejects(() => f.mcp.call(f.header, 'lead_assign', { ...args, approvalId: proposal.approvalId }), /approved/);
  assert.throws(() => f.mcp.approve({ user: { id: 'sales', role: 'admin' } }, proposal.approvalId), /administrator/);
  f.mcp.approve(f.identity, proposal.approvalId);
  await assert.rejects(() => f.mcp.call(f.header, 'lead_assign', { ...args, owner: 'admin', approvalId: proposal.approvalId }), /approved/);
  const updated = await f.mcp.call(f.header, 'lead_assign', { ...args, approvalId: proposal.approvalId });
  assert.equal(updated.owner, 'sales');
  await assert.rejects(() => f.mcp.call(f.header, 'lead_assign', { ...args, approvalId: proposal.approvalId }), /changed/);
  await assert.rejects(() => f.mcp.call(f.header, 'lead_edit', { leadId: 'lead', expectedUpdatedAt: updated.updatedAt, changes: { owner: 'admin' } }), /Unsupported/);
  f.db.close();
});

test('MCP reports use IST boundaries and do not attribute unknown historic work to lead owners', async () => {
  const f = fixture();
  f.put('activities', { id: 'unattributed', leadId: 'lead', createdAt: '2026-10-27T07:00:00Z' });
  f.put('tasks', { id: 'tomorrow', title: 'Synthetic follow up', owner: 'sales', status: 'Open', due: '2026-10-28T10:00:00+05:30' });
  const report = await f.mcp.call(f.header, 'daily_report', { date: '2026-10-27', owner: 'sales' });
  assert.equal(report.counts.attributedActivities, 0); assert.equal(report.counts.unattributedActivities, 1);
  assert.equal(report.tomorrowFollowUps.length, 1); assert.equal(report.timezone, 'Asia/Kolkata');
  await assert.rejects(() => f.mcp.call(f.header, 'lead_get', { leadId: 'lead', companyId: 'other-company' }), /Unknown/);
  f.db.close();
});

test('one workspace MCP key cannot authorize against another workspace database', async () => {
  const a = fixture(), b = fixture();
  await assert.rejects(() => b.mcp.call(a.header, 'lead_get', { leadId: 'lead' }), /expired/);
  a.db.close(); b.db.close();
});
