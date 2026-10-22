import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handleGymApi } from '../lib/gym-api.ts';

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  async first() { return this.db.prepare(this.sql).get(...this.params) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  execute() { return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) } }; }
  async run() { return this.execute(); }
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const migrationDir = new URL('../drizzle/', import.meta.url);
  const migrations = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length, 'Generate the Drizzle migration before running API tests.');
  for (const name of migrations) sqlite.exec(readFileSync(new URL(name, migrationDir), 'utf8'));
  const DB = {
    prepare(sql) { return new D1Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const objects = new Map();
  const BUCKET = {
    async head(key) { const object = objects.get(key); return object ? { size: object.data.byteLength } : null; },
    async get(key) { const object = objects.get(key); return object ? { body: new Blob([object.data]).stream(), size: object.data.byteLength, httpMetadata: object.httpMetadata } : null; },
    async put(key, data, options) { objects.set(key, { data, httpMetadata: options.httpMetadata }); },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
  };
  const call = async (path, { user = 'alice', method = 'GET', json, raw, headers = {}, now = 1000000 } = {}) => {
    const request = new Request('https://gym.example' + path, {
      method,
      headers: {
        ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.com` } : {}),
        ...(method === 'GET' ? {} : { Origin: 'https://gym.example', 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : raw !== undefined ? { body: raw } : {}),
    });
    const response = await handleGymApi(request, { DB, BUCKET }, { now: () => now });
    const content = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : await response.arrayBuffer();
    return { status: response.status, body: content, headers: response.headers };
  };
  return { call, sqlite, objects, DB, BUCKET };
}
const state = (id = 'workout-a') => ({ workouts: [{ id, d: '2026-10-20', start: 123, entries: [] }], routines: [{ id: 'routine-a', name: 'Strength', ex: [] }], bodyweight: [{ d: '2026-10-20', v: 70, t: 123 }], week: { 1: 'routine-a' }, active: { private: true } });

test('anonymous and foreign-origin writes fail before creating any profile', async () => {
  const { call, sqlite } = fixture();
  assert.equal((await call('/api/me', { user: null })).status, 401);
  assert.equal((await call('/api/data', { user: null, method: 'PUT', json: { state: state() } })).status, 401);
  const foreign = await call('/api/data', { method: 'PUT', json: { state: state() }, headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'origin');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM gym_users').get().n, 0);
});

test('trusted wrapper null identity and stale-tab identity both fail closed', async () => {
  const f = fixture();
  const stale = await f.call('/api/data', { user: 'bob', headers: { 'X-OpenGym-User': 'alice' } });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.code, 'account-changed');
  const response = await handleGymApi(new Request('https://gym.example/api/me', { headers: { 'oai-authenticated-user-id': 'spoofed' } }), { DB: f.DB }, { identity: null });
  assert.equal(response.status, 401);
});

test('workouts, plans and weight sync are scoped to the hosting user', async () => {
  const { call } = fixture();
  assert.deepEqual((await call('/api/data')).body, { state: null, rev: 0 });
  const saved = await call('/api/data', { method: 'PUT', json: { state: state(), baseRev: 0, userId: 'bob', stamped: true } });
  assert.equal(saved.status, 200);
  const alice = await call('/api/data');
  assert.equal(alice.body.rev, 1);
  assert.equal(alice.body.state.workouts[0].id, 'workout-a');
  assert.equal(alice.body.state.bodyweight[0].v, 70);
  assert.equal(alice.body.state.active, undefined);
  assert.equal(alice.body.state._prior, undefined);
  assert.equal(alice.body.state._unstamped, undefined);
  assert.deepEqual((await call('/api/data?userId=alice', { user: 'bob' })).body, { state: null, rev: 0 });
  assert.equal((await call('/api/data/rev')).body.wid, saved.body.wid);
});

test('stale revisions and restored write ids return the current document without overwriting it', async () => {
  const { call } = fixture();
  const saved = await call('/api/data', { method: 'PUT', json: { state: state(), baseRev: 0, stamped: true } });
  const stale = await call('/api/data', { method: 'PUT', json: { state: state('lost-change'), baseRev: 0 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.state.workouts[0].id, 'workout-a');
  const wrongWid = await call('/api/data', { method: 'PUT', json: { state: state('lost-change'), baseRev: 1, baseWid: 'old-restore-id' } });
  assert.equal(wrongWid.status, 409);
  assert.equal((await call('/api/data/rev')).body.wid, saved.body.wid);
});

test('atomic compare-and-swap allows only one of two concurrent writers', async () => {
  const { call } = fixture();
  const responses = await Promise.all(['left', 'right'].map(id => call('/api/data', { method: 'PUT', json: { state: state(id), baseRev: 0, stamped: true } })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal((await call('/api/data')).body.rev, 1);
});

test('a durable mutation receipt retries once, remains scoped to its owner, and rejects key reuse', async () => {
  const { call } = fixture();
  const write = { method: 'PUT', json: { state: state(), baseRev: 0, stamped: true }, headers: { 'X-Idempotency-Key': 'mutation-12345' } };
  const first = await call('/api/data', write);
  assert.equal(first.status, 200);
  const retry = await call('/api/data', write);
  assert.deepEqual(retry, first);
  const reused = await call('/api/data', { ...write, json: { ...write.json, state: state('different') } });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.code, 'mutation-reused');
  assert.equal((await call('/api/data/rev')).body.rev, 1);
  const bob = await call('/api/data', { ...write, user: 'bob' });
  assert.equal(bob.status, 200);
  assert.notEqual(bob.body.wid, first.body.wid);
});

test('concurrent duplicate mutations share one revision and receipt', async () => {
  const { call } = fixture();
  const write = { method: 'PUT', json: { state: state(), baseRev: 0, stamped: true }, headers: { 'X-Idempotency-Key': 'mutation-concurrent' } };
  const responses = await Promise.all([call('/api/data', write), call('/api/data', write)]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.deepEqual(responses[0].body, responses[1].body);
  assert.equal((await call('/api/data/rev')).body.rev, 1);
});

test('upstream deletion/edit stamps and reset ancestry survive writes', async () => {
  const { call } = fixture();
  const initial = { ...state(), deleted: { routines: { removed: 100 } }, edited: { unit: 100 }, resetAt: 50, resetIds: { old: true } };
  await call('/api/data', { method: 'PUT', json: { state: initial, baseRev: 0, stamped: true } });
  const replacement = { ...state(), resetAt: 1, deleted: {}, edited: {}, active: { secret: true } };
  const saved = await call('/api/data', { method: 'PUT', json: { state: replacement, baseRev: 1, stamped: true } });
  assert.equal(saved.status, 200);
  const result = (await call('/api/data')).body.state;
  assert.equal(result.deleted.routines.removed, 100);
  assert.equal(result.edited.unit, 100);
  assert.equal(result.resetAt, 50);
  assert.deepEqual(result.resetIds, { old: true });
  assert.equal(result._wids.length, 1);
});

test('malformed, oversized and prototype-shaped JSON cannot replace saved state', async () => {
  const { call } = fixture();
  await call('/api/data', { method: 'PUT', json: { state: state(), baseRev: 0, stamped: true } });
  for (const bad of [{}, [], { workouts: {} }, { _rev: 5, _ts: 5 }]) assert.equal((await call('/api/data', { method: 'PUT', json: { state: bad } })).status, 400);
  assert.equal((await call('/api/data', { method: 'PUT', raw: '{"state":{"__proto__":{"admin":true}}}' })).status, 400);
  assert.equal((await call('/api/data', { method: 'PUT', raw: '{broken' })).status, 400);
  assert.equal((await call('/api/data', { method: 'PUT', raw: 'x'.repeat(1.5 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await call('/api/data/rev')).body.rev, 1);
});

test('an unreadable saved document returns 503 and is never overwritten', async () => {
  const { call, sqlite } = fixture();
  await call('/api/data');
  sqlite.prepare('UPDATE gym_state SET document = ? WHERE user_id = ?').run('{torn', 'alice');
  assert.equal((await call('/api/data')).status, 503);
  assert.equal((await call('/api/data', { method: 'PUT', json: { state: state() } })).status, 503);
  assert.equal(sqlite.prepare('SELECT document FROM gym_state WHERE user_id = ?').get('alice').document, '{torn');
});

test('profile name changes affect only self and deletion tombstones reject stale tabs', async () => {
  const { call, sqlite } = fixture();
  await call('/api/me', { user: 'bob' });
  const renamed = await call('/api/account/profile', { method: 'PUT', json: { name: 'Alice Gym', userId: 'bob' } });
  assert.equal(renamed.body.user.name, 'Alice Gym');
  assert.equal((await call('/api/me', { user: 'bob' })).body.user.name, 'bob');
  await call('/api/data', { method: 'PUT', json: { state: state(), baseRev: 0 } });
  assert.equal((await call('/api/account/profile', { method: 'DELETE', json: { confirm: true } })).status, 200);
  const resurrect = await call('/api/data', { method: 'PUT', json: { state: state() } });
  assert.equal(resurrect.status, 410);
  assert.equal(resurrect.body.code, 'profile-deleted');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM gym_state WHERE user_id = ?').get('alice').n, 0);
});

test('media verifies hashes, stores private per-user objects, repairs failed uploads and sweeps safely', async () => {
  const { call, objects, sqlite } = fixture();
  const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const hash = createHash('sha256').update(data).digest('hex');
  const uploaded = await call('/api/media/' + hash, { method: 'PUT', raw: data, headers: { 'Content-Type': 'image/png' } });
  assert.equal(uploaded.status, 201);
  assert.equal(objects.size, 1);
  assert.equal((await call('/api/media/' + hash)).status, 200);
  assert.equal((await call('/api/media/' + hash, { user: 'bob' })).status, 404);
  assert.deepEqual((await call('/api/media/missing', { user: 'bob', method: 'POST', json: { hashes: [hash] } })).body.missing, [hash]);
  assert.equal((await call('/api/media/' + 'a'.repeat(64), { method: 'PUT', raw: data, headers: { 'Content-Type': 'image/png' } })).body.code, 'hash-mismatch');
  objects.clear();
  assert.deepEqual((await call('/api/media/missing', { method: 'POST', json: { hashes: [hash] } })).body.missing, [hash]);
  assert.equal((await call('/api/media/' + hash, { method: 'PUT', raw: data, headers: { 'Content-Type': 'image/png' } })).status, 200);
  await call('/api/data', { method: 'PUT', json: { state: state(), baseRev: 0 } });
  const recent = await call('/api/media/sweep', { method: 'POST', json: {} });
  assert.equal(recent.body.removed, 0);
  const old = await call('/api/media/sweep', { method: 'POST', json: {}, now: 5000000 });
  assert.equal(old.body.removed, 1);
  assert.equal(objects.size, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM gym_media').get().n, 0);
});

test('hosted capabilities disable optional services and do not report fake success', async () => {
  const { call } = fixture();
  const config = (await call('/api/config')).body;
  assert.equal(config.allow_guest, false);
  assert.equal(config.coach, null);
  assert.equal(config.capabilities.push, false);
  assert.equal(config.capabilities.passkeys, false);
  assert.equal((await call('/api/push/subscribe', { method: 'POST', json: {} })).status, 501);
  assert.equal((await call('/api/logout', { method: 'POST', json: {} })).status, 501);
  assert.equal((await call('/api/admin/users')).status, 501);
});

test('confirmed reset purges recent uploads and its durable receipt never purges a later upload', async () => {
  const { call, objects } = fixture();
  const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 5]);
  const hash = createHash('sha256').update(data).digest('hex');
  const upload = () => call('/api/media/' + hash, { method: 'PUT', raw: data, headers: { 'Content-Type': 'image/png' } });
  await upload();
  const saved = await call('/api/data', { method: 'PUT', json: { state: { ...state(), resetAt: 123456 }, baseRev: 0, stamped: true } });
  const purge = { method: 'POST', json: { purge: true, baseRev: saved.body.rev, baseWid: saved.body.wid } };
  assert.equal((await call('/api/media/sweep', { ...purge, json: { ...purge.json, baseWid: 'stale' } })).status, 409);
  const result = await call('/api/media/sweep', purge);
  assert.equal(result.status, 200);
  assert.equal(result.body.removed, 1);
  assert.equal(objects.size, 0);
  await upload();
  const repeat = await call('/api/media/sweep', purge);
  assert.deepEqual(repeat.body, result.body);
  assert.equal(objects.size, 1);
  assert.equal((await call('/api/media/' + hash)).status, 200);
});

test('reset purge rejects a document that still references photos', async () => {
  const { call } = fixture();
  const hash = 'a'.repeat(64);
  const saved = await call('/api/data', { method: 'PUT', json: { state: { ...state(), customEx: [{ id: 'custom', media: { hash } }] }, baseRev: 0, stamped: true } });
  const response = await call('/api/media/sweep', { method: 'POST', json: { purge: true, baseRev: saved.body.rev, baseWid: saved.body.wid } });
  assert.equal(response.status, 409);
});

test('an upload completing after reset cannot resurrect old bytes or delete a new upload of the same hash', async () => {
  const { call, BUCKET, objects } = fixture();
  const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 6]);
  const hash = createHash('sha256').update(data).digest('hex');
  const saved = await call('/api/data', { method: 'PUT', json: { state: { ...state(), resetAt: 123456 }, baseRev: 0, stamped: true } });
  let signalEntered, releaseUpload;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const release = new Promise(resolve => { releaseUpload = resolve; });
  const put = BUCKET.put;
  let first = true;
  BUCKET.put = async (...args) => {
    if (first) { first = false; signalEntered(); await release; }
    return put(...args);
  };
  const upload = () => call('/api/media/' + hash, { method: 'PUT', raw: data, headers: { 'Content-Type': 'image/png' } });
  const stale = upload();
  await entered;
  assert.equal((await call('/api/media/sweep', { method: 'POST', json: { purge: true, baseRev: saved.body.rev, baseWid: saved.body.wid } })).status, 200);
  assert.equal((await upload()).status, 201);
  releaseUpload();
  const staleResult = await stale;
  assert.equal(staleResult.status, 409);
  assert.equal(staleResult.body.code, 'media-reset');
  assert.equal(objects.size, 1);
  assert.equal((await call('/api/media/' + hash)).status, 200);
});

test('a failed reset cleanup retains metadata, fences sync writes and can be retried', async () => {
  const { call, BUCKET, sqlite } = fixture();
  const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7]);
  const hash = createHash('sha256').update(data).digest('hex');
  await call('/api/media/' + hash, { method: 'PUT', raw: data, headers: { 'Content-Type': 'image/png' } });
  const saved = await call('/api/data', { method: 'PUT', json: { state: { ...state(), resetAt: 123456 }, baseRev: 0, stamped: true } });
  const remove = BUCKET.delete;
  let signalEntered, releaseDelete;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const release = new Promise(resolve => { releaseDelete = resolve; });
  BUCKET.delete = async () => { signalEntered(); await release; throw new Error('simulated R2 outage'); };
  const purge = { method: 'POST', json: { purge: true, baseRev: saved.body.rev, baseWid: saved.body.wid } };
  const attempt = call('/api/media/sweep', purge);
  await entered;
  assert.equal((await call('/api/data', { method: 'PUT', json: { state: state('resurrect'), baseRev: saved.body.rev, baseWid: saved.body.wid } })).status, 423);
  releaseDelete();
  assert.equal((await attempt).body.code, 'media-cleanup-pending');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM gym_media').get().n, 1);
  assert.equal((await call('/api/me')).status, 200);
  assert.equal((await call('/api/config')).body.media_cleanup_pending, true);
  assert.equal((await call('/api/data')).status, 200);
  assert.equal((await call('/api/data/rev')).body.wid, saved.body.wid);
  BUCKET.delete = remove;
  assert.equal((await call('/api/media/sweep', purge)).status, 200);
  assert.equal((await call('/api/data')).body.state.workouts[0].id, 'workout-a');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM gym_media').get().n, 0);
});

test('profile deletion retries R2 cleanup after tombstoning and chunks more than 1000 objects', async () => {
  const { call, BUCKET, sqlite } = fixture();
  await call('/api/me');
  const insert = sqlite.prepare('INSERT INTO gym_media (user_id, hash, mime, size, created_at) VALUES (?, ?, ?, ?, ?)');
  for (let index = 0; index < 1001; index++) insert.run('alice', index.toString(16).padStart(64, '0'), 'image/png', 5, 100);
  const remove = BUCKET.delete;
  BUCKET.delete = async () => { throw new Error('simulated R2 outage'); };
  const deletion = { method: 'DELETE', json: { confirm: true } };
  const failed = await call('/api/account/profile', deletion);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.code, 'media-cleanup-pending');
  assert.equal((await call('/api/me')).status, 410);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM gym_media').get().n, 1001);
  const batches = [];
  BUCKET.delete = async keys => { batches.push(keys.length); return remove(keys); };
  assert.equal((await call('/api/account/profile', deletion)).status, 200);
  assert.deepEqual(batches, [1000, 1]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM gym_media').get().n, 0);
  assert.equal((await call('/api/account/profile', deletion)).status, 200);
});

test('synchronization helper remains byte-identical to upstream', () => {
  assert.equal(readFileSync(new URL('../lib/sync-stamps.js', import.meta.url), 'utf8'), readFileSync(new URL('../../../api/sync-stamps.js', import.meta.url), 'utf8'));
});
