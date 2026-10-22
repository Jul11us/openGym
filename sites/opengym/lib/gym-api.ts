import { stampPut } from './sync-stamps.js';

/** Requests reach this handler only through the Sites dispatcher's trusted identity.
 * There is deliberately no cookie/password/passkey authentication in this flavor. */
type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};
type Database = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<{ meta?: { changes?: number } }[]> };
type Bucket = {
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata: { contentType: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
};
export type GymEnv = { DB?: Database; BUCKET?: Bucket };
type ReadyEnv = GymEnv & { DB: Database };
export type GymIdentity = { id: string; email?: string; name?: string };
export type GymOptions = { identity?: GymIdentity | null; now?: () => number };
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };
type Document = Record<string, JsonValue | undefined>;
type UserRow = { user_id: string; name: string; deleted_at: number | null; media_epoch: number; media_purge: number };
type StateRow = { revision: number; write_id: string | null; document: string | null };
type MediaRow = { hash: string; mime: string; size: number; created_at: number };

const MB = 1024 * 1024;
const MAX_JSON = 1.5 * MB;
const MAX_DOCUMENT = 1.8 * MB;
const QUOTA = 200 * MB;
const MAX_UPLOAD = 16 * MB;
const HASH = /^[a-f0-9]{64}$/;
const MUTATION = /^[A-Za-z0-9_.:-]{8,128}$/;
const MEDIA = { imageMB: 2, gifMB: 8, videoMB: 16, videoSec: 60, quotaMB: 200, workouts: true };

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'bad-request') { super(message); this.status = status; this.code = code; }
}
const record = (value: unknown): value is Document => !!value && typeof value === 'object' && !Array.isArray(value);
const clientState = (state: Document | null) => {
  if (!state) return null;
  const result = { ...state };
  delete result._unstamped;
  delete result._prior;
  return result;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' },
});
function identityOf(request: Request, options: GymOptions): GymIdentity {
  // An explicit null from the trusted wrapper must fail closed rather than fall
  // back to headers supplied by a request that did not pass its authentication.
  const identity = Object.hasOwn(options, 'identity') ? options.identity : {
    id: request.headers.get('oai-authenticated-user-id') || '',
    email: request.headers.get('oai-authenticated-user-email') || undefined,
  };
  if (!identity?.id || identity.id.length > 256 || /[\x00-\x1f]/.test(identity.id)) throw new ApiError(401, 'Sign in to this private Site to continue.', 'unauthorized');
  const expected = request.headers.get('X-OpenGym-User');
  if (expected && expected !== identity.id) throw new ApiError(401, 'Your signed-in account changed. Reload to continue.', 'account-changed');
  return identity;
}
function sameOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  // Requests made by the browser's same-origin client carry Origin on writes.
  // A non-browser caller without Origin is allowed only with an explicit JSON
  // content type; all caller identities still come from the hosting dispatcher.
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === 'cross-site') throw new ApiError(403, 'Use this Site to make changes.', 'origin');
  if (!origin && !request.headers.get('Content-Type')) throw new ApiError(403, 'A same-origin request is required.', 'origin');
}
async function bytes(request: Request, limit: number): Promise<Uint8Array> {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new ApiError(413, 'That request is too large.', 'too-large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) { await reader.cancel(); throw new ApiError(413, 'That request is too large.', 'too-large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}
async function body(request: Request): Promise<Document> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'Send JSON for this request.', 'content-type');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(request, MAX_JSON))); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'Invalid JSON.'); }
  if (!record(value)) throw new ApiError(400, 'A JSON object is required.');
  // Keep recursive merge/stringify bounded, and never feed prototype keys to
  // the upstream merge helper's object maps.
  const pending: [unknown, number][] = [[value, 0]];
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop()!;
    if (!node || typeof node !== 'object') continue;
    if (depth > 80 || ++count > 100000) throw new ApiError(400, 'The document is too deeply nested.', 'invalid-state');
    for (const [key, entry] of Object.entries(node)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new ApiError(400, 'Invalid document key.', 'invalid-state');
      if (entry && typeof entry === 'object') pending.push([entry, depth + 1]);
    }
  }
  return value;
}
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), n => n.toString(16).padStart(2, '0')).join('');
const digest = async (value: string | Uint8Array) => hex(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value as Uint8Array<ArrayBuffer>));
const randomId = () => crypto.randomUUID().replaceAll('-', '');
function parseState(row: StateRow): Document | null {
  if (!row.document) return null;
  try { const value = JSON.parse(row.document); if (record(value)) return value; } catch { /* fail closed */ }
  throw new ApiError(503, 'Your saved data could not be read. Please try again later.', 'state-unreadable');
}
async function userFor(db: Database, identity: GymIdentity, now: number): Promise<UserRow> {
  const name = (identity.name || identity.email?.split('@')[0] || 'Gym friend').trim().slice(0, 40) || 'Gym friend';
  await db.prepare('INSERT OR IGNORE INTO gym_users (user_id, name, created_at) VALUES (?, ?, ?)').bind(identity.id, name, now).run();
  const user = await accountFor(db, identity.id);
  if (!user) throw new ApiError(503, 'Your profile is temporarily unavailable.', 'storage-unavailable');
  return user;
}
const accountFor = (db: Database, uid: string) => db.prepare('SELECT user_id, name, deleted_at, media_epoch, media_purge FROM gym_users WHERE user_id = ?').bind(uid).first<UserRow>();
async function stateFor(db: Database, uid: string, now: number): Promise<StateRow> {
  await db.prepare('INSERT OR IGNORE INTO gym_state (user_id, revision, updated_at) VALUES (?, 0, ?)').bind(uid, now).run();
  const row = await db.prepare('SELECT revision, write_id, document FROM gym_state WHERE user_id = ?').bind(uid).first<StateRow>();
  if (!row) throw new ApiError(503, 'Your saved data is temporarily unavailable.', 'storage-unavailable');
  return row;
}
function validateState(value: unknown): asserts value is Document {
  if (!record(value) || !Object.keys(value).some(key => !['_rev', '_ts', '_wid', '_wids'].includes(key))) throw new ApiError(400, 'state required', 'invalid-state');
  for (const key of ['workouts', 'routines', 'customEx', 'bodyweight', 'measurements', 'gymCards', 'equipProfiles']) {
    if (value[key] != null && !Array.isArray(value[key])) throw new ApiError(400, 'invalid state', 'invalid-state');
    if (Array.isArray(value[key])) value[key] = value[key].filter(record);
  }
}
async function putState(request: Request, env: ReadyEnv, uid: string, now: number): Promise<Response> {
  const incoming = await body(request);
  validateState(incoming.state);
  if (incoming.baseRev != null && (typeof incoming.baseRev !== 'number' || !Number.isSafeInteger(incoming.baseRev) || incoming.baseRev < 0)) throw new ApiError(400, 'Invalid base revision.');
  if (incoming.baseWid != null && (typeof incoming.baseWid !== 'string' || incoming.baseWid.length > 128)) throw new ApiError(400, 'Invalid base write id.');
  const mutationId = request.headers.get('X-Idempotency-Key') || incoming.mutationId;
  if (mutationId != null && (typeof mutationId !== 'string' || !MUTATION.test(mutationId) || mutationId.startsWith('__'))) throw new ApiError(400, 'Invalid mutation id.');
  const fingerprint = mutationId ? await digest(JSON.stringify(incoming)) : '';
  const mutation = async (): Promise<Response | null> => {
    if (!mutationId) return null;
    const saved = await env.DB.prepare('SELECT digest, response FROM gym_mutations WHERE user_id = ? AND mutation_id = ?').bind(uid, mutationId).first<{ digest: string; response: string }>();
    if (!saved) return null;
    if (saved.digest !== fingerprint) throw new ApiError(409, 'That mutation id was already used for a different write.', 'mutation-reused');
    return json(JSON.parse(saved.response));
  };
  const prior = await mutation();
  if (prior) return prior;
  const row = await stateFor(env.DB, uid, now);
  const current = parseState(row);
  const rev = row.revision;
  const conflict = () => json({ error: 'conflict', rev, state: clientState(current) }, 409);
  if ((incoming.baseRev != null && incoming.baseRev !== rev) || (incoming.baseRev != null && typeof incoming.baseWid === 'string' && row.write_id && incoming.baseWid !== row.write_id)) return (await mutation()) || conflict();
  const next = incoming.state;
  delete next.active;
  const reset = Number(current?.resetAt) || 0;
  if (reset > (Number(next.resetAt) || 0)) {
    next.resetAt = current!.resetAt;
    if (record(current!.resetIds)) next.resetIds = current!.resetIds; else delete next.resetIds;
  }
  const report: { changed?: boolean } = {};
  stampPut(current, next, { overRead: incoming.baseRev != null && incoming.baseRev === rev, stamped: incoming.stamped === true, now, report });
  next._rev = rev + (report.changed ? 2 : 1);
  next._wids = [...(Array.isArray(current?._wids) ? current!._wids : []), ...(current?._wid ? [current._wid] : [])].filter(value => typeof value === 'string').slice(-50);
  next._wid = randomId();
  const document = JSON.stringify(next);
  if (new TextEncoder().encode(document).length > MAX_DOCUMENT) throw new ApiError(413, 'Your saved profile is too large. Export a backup before removing older attachments or workouts.', 'state-too-large');
  const response = { ok: true, ts: next._ts || null, rev: rev + 1, wid: next._wid };
  // Both the compare-and-swap and the idempotency receipt commit in one D1
  // transaction. Independent Workers never overwrite a revision they did not read.
  const statements = [env.DB.prepare('UPDATE gym_state SET revision = ?, write_id = ?, document = ?, updated_at = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM gym_users WHERE user_id = ? AND deleted_at IS NULL AND media_purge = 0)').bind(next._rev, next._wid, document, now, uid, rev, uid)];
  if (mutationId) statements.push(env.DB.prepare('INSERT OR IGNORE INTO gym_mutations (user_id, mutation_id, digest, response, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM gym_state WHERE user_id = ? AND write_id = ?)').bind(uid, mutationId, fingerprint, JSON.stringify(response), now, uid, next._wid));
  const results = await env.DB.batch(statements);
  if (results[0].meta?.changes === 1) return json(response);
  const receipt = await mutation();
  if (receipt) return receipt;
  const latestUser = await env.DB.prepare('SELECT deleted_at FROM gym_users WHERE user_id = ?').bind(uid).first<{ deleted_at: number | null }>();
  if (latestUser?.deleted_at) throw new ApiError(410, 'This gym profile was deleted.', 'profile-deleted');
  const account = await accountFor(env.DB, uid);
  if (account?.media_purge) throw new ApiError(423, 'Photo cleanup is in progress. Try again in a moment.', 'media-cleanup-pending');
  const latest = await stateFor(env.DB, uid, now);
  return json({ error: 'conflict', rev: latest.revision, state: clientState(parseState(latest)) }, 409);
}

const objectPrefix = async (uid: string, epoch: number) => `gym/${await digest(uid)}/${epoch}/`;
async function removeObjects(bucket: Bucket, prefix: string, rows: MediaRow[]) {
  // R2 delete accepts at most 1000 keys per call. Retain D1 rows until every
  // batch succeeds, so another request can repeat cleanup after an R2 failure.
  for (let index = 0; index < rows.length; index += 1000) await bucket.delete(rows.slice(index, index + 1000).map(row => prefix + row.hash));
}
const mediaRows = async (env: ReadyEnv, uid: string) => (await env.DB.prepare('SELECT hash, mime, size, created_at FROM gym_media WHERE user_id = ?').bind(uid).all<MediaRow>()).results;
const usage = (rows: MediaRow[]) => ({ bytes: rows.reduce((sum, row) => sum + row.size, 0), count: rows.length, quotaBytes: QUOTA });
function referencedHashes(state: Document | null): Set<string> {
  const hashes = new Set<string>();
  const ref = (value: unknown) => {
    if (!record(value)) return;
    if (typeof value.hash === 'string' && HASH.test(value.hash)) hashes.add(value.hash);
    if (record(value.poster) && typeof value.poster.hash === 'string' && HASH.test(value.poster.hash)) hashes.add(value.poster.hash);
  };
  for (const exercise of Array.isArray(state?.customEx) ? state.customEx : []) if (record(exercise)) ref(exercise.media);
  for (const workout of Array.isArray(state?.workouts) ? state.workouts : []) if (record(workout) && Array.isArray(workout.media)) for (const media of workout.media) ref(media);
  return hashes;
}
function sniff(data: Uint8Array): { mime: string; ext: string; category: 'image' | 'gif' | 'video' } | null {
  const ascii = (offset: number, size: number) => String.fromCharCode(...data.slice(offset, offset + size));
  const at = (offset: number, ...values: number[]) => values.every((value, index) => data[offset + index] === value);
  if (at(0, 0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg', category: 'image' };
  if (at(0, 137, 80, 78, 71, 13, 10, 26, 10)) return { mime: 'image/png', ext: 'png', category: 'image' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif', category: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp', category: 'image' };
  if (ascii(4, 4) === 'ftyp' && ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VP', 'dash', 'mmp4', 'MSNV', '3gp4', '3gp5', '3gp6', '3g2a', 'qt  '].includes(ascii(8, 4))) return ascii(8, 4) === 'qt  ' ? { mime: 'video/quicktime', ext: 'mov', category: 'video' } : { mime: 'video/mp4', ext: 'mp4', category: 'video' };
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3) && ascii(0, Math.min(data.length, 128)).includes('webm')) return { mime: 'video/webm', ext: 'webm', category: 'video' };
  return null;
}
// MP4/MOV mvhd and WebM Info Duration use container metadata only, without a
// decoder. Refuse missing/unknown duration rather than silently skipping a cap.
function videoSeconds(data: Uint8Array, mime: string): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (mime === 'video/webm') {
    const vint = (offset: number) => {
      if (offset >= data.length || !data[offset]) return null;
      let length = 1;
      while (length <= 8 && !(data[offset] & (0x80 >> (length - 1)))) length++;
      if (length > 8 || offset + length > data.length) return null;
      let value = data[offset] & (0xff >> length);
      for (let index = 1; index < length; index++) value = value * 256 + data[offset + index];
      return { length, value };
    };
    let scale = 1000000;
    let duration: number | null = null;
    // Metadata occurs near the start. Limiting the scan avoids parsing media
    // payload bytes as element tags throughout a large uploaded video.
    const end = Math.min(data.length - 12, 1024 * 1024);
    for (let offset = 0; offset < end; offset++) {
      if (data[offset] === 0x2a && data[offset + 1] === 0xd7 && data[offset + 2] === 0xb1) {
        const size = vint(offset + 3);
        if (size && size.value > 0 && size.value <= 8) {
          let value = 0;
          for (let index = 0; index < size.value; index++) value = value * 256 + data[offset + 3 + size.length + index];
          scale = value;
        }
      }
      if (data[offset] === 0x44 && data[offset + 1] === 0x89) {
        const size = vint(offset + 2);
        const at = size && offset + 2 + size.length;
        if (size && at != null && at + size.value <= data.length) {
          if (size.value === 4) duration = view.getFloat32(at);
          if (size.value === 8) duration = view.getFloat64(at);
        }
      }
    }
    return duration != null && Number.isFinite(duration) && duration > 0 ? duration * scale / 1e9 : null;
  }
  const scan = (start: number, end: number, depth = 0): number | null => {
    if (depth > 4) return null;
    let count = 0;
    for (let at = start; at + 8 <= end && ++count < 10000;) {
      let size = view.getUint32(at);
      const type = String.fromCharCode(...data.slice(at + 4, at + 8));
      let header = 8;
      if (size === 1) { if (at + 16 > end) return null; size = view.getUint32(at + 8) * 4294967296 + view.getUint32(at + 12); header = 16; }
      if (size === 0) size = end - at;
      if (size < header || at + size > end) return null;
      if (type === 'moov') { const value = scan(at + header, at + size, depth + 1); if (value != null) return value; }
      if (type === 'mvhd') {
        const payload = at + header;
        const version = data[payload];
        const scaleAt = payload + (version === 1 ? 20 : 12);
        if ((version !== 0 && version !== 1) || scaleAt + (version === 1 ? 12 : 8) > at + size) return null;
        const scale = view.getUint32(scaleAt);
        const length = version === 1 ? view.getUint32(scaleAt + 4) * 4294967296 + view.getUint32(scaleAt + 8) : view.getUint32(scaleAt + 4);
        return scale > 0 && length > 0 ? length / scale : null;
      }
      at += size;
    }
    return null;
  };
  return scan(0, data.length);
}
async function mediaRoute(request: Request, env: ReadyEnv, uid: string, pathname: string, now: number): Promise<Response> {
  if (!env.BUCKET) throw new ApiError(503, 'Photo storage is temporarily unavailable.', 'media-unavailable');
  const account = await accountFor(env.DB, uid);
  if (!account) throw new ApiError(401, 'Sign in to continue.', 'unauthorized');
  if (account.deleted_at) throw new ApiError(410, 'This gym profile was deleted.', 'profile-deleted');
  if (account.media_purge && request.method !== 'GET' && !['/api/media/sweep', '/api/media/missing'].includes(pathname)) throw new ApiError(423, 'Retry the confirmed reset to finish photo cleanup.', 'media-cleanup-pending');
  const prefix = await objectPrefix(uid, account.media_epoch - (account.media_purge ? 1 : 0));
  const match = pathname.match(/^\/api\/media\/([a-f0-9]{64})$/);
  if (match && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT hash, mime, size, created_at FROM gym_media WHERE user_id = ? AND hash = ?').bind(uid, match[1]).first<MediaRow>();
    const object = row && await env.BUCKET.get(prefix + match[1]);
    if (!row || !object) throw new ApiError(404, 'no such file', 'media-missing');
    return new Response(object.body, { headers: {
      'Content-Type': row.mime, 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Disposition': `inline; filename="${match[1]}.${sniffExtension(row.mime)}"`, 'X-Robots-Tag': 'noindex',
    } });
  }
  if (match && request.method === 'PUT') {
    const data = await bytes(request, MAX_UPLOAD);
    const type = sniff(data);
    if (!type) throw new ApiError(415, 'that file type is not accepted', 'media-type');
    const declared = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!(type.category === 'video' ? declared.startsWith('video/') : declared.startsWith('image/'))) throw new ApiError(415, 'The content type does not match this file.', 'media-type');
    const cap = (type.category === 'video' ? MEDIA.videoMB : type.category === 'gif' ? MEDIA.gifMB : MEDIA.imageMB) * MB;
    if (!data.length || data.length > cap) throw new ApiError(413, 'that file is too large', 'media-too-large');
    if (type.category === 'video') {
      const seconds = videoSeconds(data, type.mime);
      if (seconds == null) throw new ApiError(400, 'that video could not be read', 'media-invalid');
      if (seconds > MEDIA.videoSec + 0.25) throw new ApiError(413, 'that video is too long', 'media-too-long');
    }
    if (await digest(data) !== match[1]) throw new ApiError(400, 'the file does not match its name', 'hash-mismatch');
    // Reserving metadata in an atomic conditional insert prevents simultaneous
    // uploads from both passing a read-then-write quota check.
    const old = await env.DB.prepare('SELECT hash, mime, size, created_at FROM gym_media WHERE user_id = ? AND hash = ?').bind(uid, match[1]).first<MediaRow>();
    await env.DB.prepare('INSERT OR IGNORE INTO gym_media (user_id, hash, mime, size, created_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT COALESCE(SUM(size), 0) FROM gym_media WHERE user_id = ?) + ? <= ? AND EXISTS (SELECT 1 FROM gym_users WHERE user_id = ? AND deleted_at IS NULL AND media_purge = 0 AND media_epoch = ?)').bind(uid, match[1], type.mime, data.length, now, uid, data.length, QUOTA, uid, account.media_epoch).run();
    const row = await env.DB.prepare('SELECT hash, mime, size, created_at FROM gym_media WHERE user_id = ? AND hash = ?').bind(uid, match[1]).first<MediaRow>();
    if (!row) throw new ApiError(413, 'your space for photos and videos is full', 'media-quota');
    await env.BUCKET.put(prefix + match[1], data.buffer as ArrayBuffer, { httpMetadata: { contentType: type.mime } });
    const after = await accountFor(env.DB, uid);
    if (!after || after.deleted_at || after.media_purge || after.media_epoch !== account.media_epoch) {
      // Epochs are part of object keys: a pre-reset upload can only recreate an
      // old-epoch object, and cannot delete a newer upload of the same hash.
      await env.BUCKET.delete(prefix + match[1]);
      if (after?.deleted_at) throw new ApiError(410, 'This gym profile was deleted.', 'profile-deleted');
      throw new ApiError(409, 'Your photos were reset while this upload was running.', 'media-reset');
    }
    return json({ ok: true, hash: match[1], mime: type.mime, size: data.length, existed: !!old, usage: usage(await mediaRows(env, uid)) }, old ? 200 : 201);
  }
  if (pathname === '/api/media/missing' && request.method === 'POST') {
    const incoming = await body(request);
    if (!Array.isArray(incoming.hashes) || incoming.hashes.length > 1000 || !incoming.hashes.every(value => typeof value === 'string' && HASH.test(value))) throw new ApiError(400, 'hashes must be a list of at most 1000 lowercase sha256 hex strings');
    const rows = await mediaRows(env, uid);
    const have = new Set(rows.map(row => row.hash));
    const hashes = [...new Set(incoming.hashes as string[])];
    const missing: string[] = [];
    // A quota reservation can outlive a failed R2 put. Check actual objects so
    // the next sync repairs those uploads instead of treating them as complete.
    for (let index = 0; index < hashes.length; index += 10) {
      const chunk = hashes.slice(index, index + 10);
      const present = await Promise.all(chunk.map(async hash => have.has(hash) && !!(await env.BUCKET!.head(prefix + hash))));
      for (let item = 0; item < chunk.length; item++) if (!present[item]) missing.push(chunk[item]);
    }
    return json({ missing, usage: usage(rows) });
  }
  if (pathname === '/api/media/sweep' && request.method === 'POST') {
    const incoming = await body(request);
    const row = await stateFor(env.DB, uid, now);
    const state = parseState(row);
    if (!state) return json({ removed: 0, freedBytes: 0, skipped: true, usage: usage(await mediaRows(env, uid)) });
    const refs = referencedHashes(state);
    if (incoming.purge === true) {
      const receiptId = `__purge:${incoming.baseWid}`;
      const receipt = await env.DB.prepare('SELECT digest, response FROM gym_mutations WHERE user_id = ? AND mutation_id = ?').bind(uid, receiptId).first<{ digest: string; response: string }>();
      if (receipt?.digest === 'media-purge') return json(JSON.parse(receipt.response));
      if (incoming.baseRev !== row.revision || typeof incoming.baseWid !== 'string' || incoming.baseWid !== row.write_id || refs.size) throw new ApiError(409, 'The saved profile changed. Finish syncing before removing photos.', 'conflict');
      if (!account.media_purge) {
        const locked = await env.DB.prepare('UPDATE gym_users SET media_epoch = media_epoch + 1, media_purge = 1 WHERE user_id = ? AND deleted_at IS NULL AND media_purge = 0 AND EXISTS (SELECT 1 FROM gym_state WHERE user_id = ? AND revision = ? AND write_id = ?)').bind(uid, uid, row.revision, row.write_id).run();
        if (locked.meta?.changes !== 1) throw new ApiError(409, 'The saved profile changed. Finish syncing before removing photos.', 'conflict');
      }
      const lockedAccount = await accountFor(env.DB, uid);
      if (!lockedAccount?.media_purge || lockedAccount.deleted_at) throw new ApiError(409, 'The profile changed during cleanup.', 'conflict');
      const files = await mediaRows(env, uid);
      try { await removeObjects(env.BUCKET, await objectPrefix(uid, lockedAccount.media_epoch - 1), files); }
      catch { throw new ApiError(503, 'Your reset is saved. Photo cleanup did not finish; try Reset everything again to finish removing them.', 'media-cleanup-pending'); }
      const result = { removed: files.length, freedBytes: files.reduce((total, file) => total + file.size, 0), usage: usage([]), purged: true };
      await env.DB.batch([
        env.DB.prepare('DELETE FROM gym_media WHERE user_id = ? AND EXISTS (SELECT 1 FROM gym_users WHERE user_id = ? AND media_epoch = ? AND media_purge = 1)').bind(uid, uid, lockedAccount.media_epoch),
        env.DB.prepare('INSERT OR IGNORE INTO gym_mutations (user_id, mutation_id, digest, response, created_at) VALUES (?, ?, ?, ?, ?)').bind(uid, receiptId, 'media-purge', JSON.stringify(result), now),
        env.DB.prepare('UPDATE gym_users SET media_purge = 0 WHERE user_id = ? AND media_epoch = ? AND deleted_at IS NULL').bind(uid, lockedAccount.media_epoch),
      ]);
      return json(result);
    }
    if (account.media_purge) throw new ApiError(423, 'Retry the confirmed reset to finish photo cleanup.', 'media-cleanup-pending');
    const rows = await mediaRows(env, uid);
    let removed = 0, freedBytes = 0;
    // A new file can be in flight before the state that references it. Preserve
    // the last hour, and stop if the user's document changed during the sweep.
    for (const file of rows.filter(file => !refs.has(file.hash) && file.created_at < now - 3600000)) {
      const result = await env.DB.prepare('DELETE FROM gym_media WHERE user_id = ? AND hash = ? AND EXISTS (SELECT 1 FROM gym_state WHERE user_id = ? AND revision = ?)').bind(uid, file.hash, uid, row.revision).run();
      if (result.meta?.changes !== 1) continue;
      await env.BUCKET.delete(prefix + file.hash);
      removed++; freedBytes += file.size;
    }
    return json({ removed, freedBytes, usage: usage(await mediaRows(env, uid)) });
  }
  throw new ApiError(404, 'No such API route.', 'not-found');
}
const sniffExtension = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[mime] || 'bin');

export async function handleGymApi(request: Request, environment: GymEnv, options: GymOptions = {}): Promise<Response> {
  try {
    const identity = identityOf(request, options);
    sameOrigin(request);
    if (!environment?.DB) throw new ApiError(503, 'Database storage is not connected.', 'storage-unavailable');
    const env: ReadyEnv = { ...environment, DB: environment.DB };
    const pathname = new URL(request.url).pathname.replace(/\/$/, '');
    const now = options.now?.() ?? Date.now();
    const route = `${request.method} ${pathname}`;
    if (route === 'GET /api/health') {
      await env.DB.prepare('SELECT 1 AS ok').first();
      return json({ ok: true, storage: 'd1-r2', hosted: true });
    }
    const user = await userFor(env.DB, identity, now);
    if (user.deleted_at && route !== 'DELETE /api/account/profile') throw new ApiError(410, 'This gym profile was deleted.', 'profile-deleted');
    if (user.media_purge && request.method !== 'GET' && !['POST /api/media/sweep', 'POST /api/media/missing', 'DELETE /api/account/profile'].includes(route)) throw new ApiError(423, 'Photo cleanup is in progress. Retry the reset to finish it.', 'media-cleanup-pending');
    if (route === 'GET /api/me') return json({ user: { id: identity.id, name: user.name, admin: false }, hosted_auth: true, media_cleanup_pending: !!user.media_purge });
    if (route === 'GET /api/config') return json({
      invite_only: true, allow_guest: false, password_login: false, hosted_auth: true, default_lang: 'zh', coach: null,
      push: false, admin: false, passkeys: false, pairing: false, activity: false,
      capabilities: { coach: false, push: false, admin: false, passkeys: false, pairing: false, activity: false, profile: true },
      media_cleanup_pending: !!user.media_purge,
      ...(env.BUCKET ? { media: MEDIA } : {}), sync_max_bytes: MAX_JSON,
    });
    if (route === 'GET /api/data') { const row = await stateFor(env.DB, identity.id, now); return json({ state: clientState(parseState(row)), rev: row.revision }); }
    if (route === 'GET /api/data/rev') { const row = await stateFor(env.DB, identity.id, now); return json({ rev: row.revision, ...(row.write_id ? { wid: row.write_id } : {}) }); }
    if (route === 'PUT /api/data') return await putState(request, env, identity.id, now);
    if (route === 'PUT /api/account/profile') {
      const incoming = await body(request);
      if (typeof incoming.name !== 'string' || !incoming.name.trim() || incoming.name.trim().length > 40) throw new ApiError(400, 'Choose a name with 1 to 40 characters.');
      const name = incoming.name.trim();
      await env.DB.prepare('UPDATE gym_users SET name = ? WHERE user_id = ? AND deleted_at IS NULL').bind(name, identity.id).run();
      return json({ ok: true, user: { id: identity.id, name, admin: false } });
    }
    if (route === 'DELETE /api/account/profile') {
      const incoming = await body(request);
      if (incoming.confirm !== true) throw new ApiError(400, 'Confirm deleting your gym profile.');
      if (user.deleted_at && !user.media_purge) return json({ ok: true, deleted: true });
      await env.DB.prepare('UPDATE gym_users SET deleted_at = COALESCE(deleted_at, ?), media_epoch = CASE WHEN media_purge = 0 THEN media_epoch + 1 ELSE media_epoch END, media_purge = 1 WHERE user_id = ?').bind(now, identity.id).run();
      const deleting = await accountFor(env.DB, identity.id);
      const files = await mediaRows(env, identity.id);
      if (files.length && !env.BUCKET) throw new ApiError(503, 'Photo storage is unavailable. Retry deletion to finish cleanup.', 'media-cleanup-pending');
      if (env.BUCKET && files.length) {
        try { await removeObjects(env.BUCKET, await objectPrefix(identity.id, deleting!.media_epoch - 1), files); }
        catch { throw new ApiError(503, 'Your profile is disabled. Retry deletion to finish removing its photos.', 'media-cleanup-pending'); }
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM gym_state WHERE user_id = ?').bind(identity.id),
        env.DB.prepare('DELETE FROM gym_mutations WHERE user_id = ?').bind(identity.id),
        env.DB.prepare('DELETE FROM gym_media WHERE user_id = ?').bind(identity.id),
        env.DB.prepare('UPDATE gym_users SET media_purge = 0 WHERE user_id = ?').bind(identity.id),
      ]);
      return json({ ok: true, deleted: true });
    }
    if (pathname.startsWith('/api/media/')) return await mediaRoute(request, env, identity.id, pathname, now);
    if (/^\/api\/(coach|push|admin|account\/(passkeys|password|email|device-link)|pair|login|register|logout|activity)(\/|$)/.test(pathname)) throw new ApiError(501, 'This feature is unavailable in this private Sites version. Account access is managed by Sites.', 'hosted-feature-unavailable');
    throw new ApiError(404, 'No such API route.', 'not-found');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
    // Never include a user's document, identity, SQL bindings, or storage error
    // text in an API response or a server log.
    return json({ error: 'Storage is temporarily unavailable. Your local changes are still on this device.', code: 'storage-unavailable' }, 503);
  }
}
