import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoStore } from '../src/store.mjs';
import { createMemoServer } from '../src/server.mjs';
const key = Buffer.alloc(32, 7);
const guide = { id: 'rental-checklist', title: '租房', blocks: [{ heading: '签字前', items: ['核实身份，保留合同。', '押金凭证'] }], source: { app: 'knowledge', url: '/apps/knowledge/fixture/', entryId: 'doc-fixture', version: 1 } };
const claims = (action = 'read', spaceId = 's1', resources = ['rental']) => ({ spaceId, action, resources });
const write = (expectedRevision = '0', idempotencyKey = 'key1', input = guide) => ({ operation: 'set_guide', spaceId: 's1', resourceId: 'rental', input, expectedRevision, idempotencyKey });
const read = (spaceId = 's1', resourceId = 'rental') => ({ operation: 'read_topic', spaceId, resourceId });
function fixture(t) { const store = new MemoStore({ file: ':memory:' }); t.after(() => store.close()); return store; }
function code(expected) { return error => error.code === expected; }
function signed(request, changes = {}) {
  const raw = JSON.stringify(request);
  const payload = Buffer.from(JSON.stringify({ v: 1, appId: 'memo', userId: 'u1', clientId: 'c1', grantId: 'g1', spaceId: request.spaceId, action: request.operation === 'set_guide' || request.operation === 'archive_guide' ? 'update' : 'read', resources: ['rental'], expiresAt: Date.now() + 20000, requestId: 'request1', method: 'POST', path: '/api/business', bodyHash: createHash('sha256').update(raw).digest('hex'), ...changes })).toString('base64url');
  return { raw, assertion: `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}` };
}
test('guide create update archive retains immutable history and source', t => {
  const store = fixture(t);
  const created = store.execute(write(), claims('update'));
  assert.equal(created.revision, '1'); assert.equal(created.guide.version, 1);
  assert.deepEqual(created.guide.blocks, guide.blocks);
  assert.equal(store.execute(read(), claims()).guides.length, 1);
  const updated = store.execute(write('1', 'key2', { ...guide, title: '入住验收' }), claims('update'));
  assert.equal(updated.guide.version, 2);
  const archived = store.execute({ operation: 'archive_guide', spaceId: 's1', resourceId: 'rental', input: { id: guide.id }, expectedRevision: '2', idempotencyKey: 'key3' }, claims('update'));
  assert.equal(archived.guide.archived, true);
  assert.deepEqual(store.execute(read(), claims()).guides, []);
  assert.deepEqual(store.history('s1', 'rental', guide.id).map(g => g.version), [1, 2, 3]);
  assert.deepEqual(store.history('s1', 'rental', guide.id)[0].source, guide.source);
});
test('idempotent retries precede revision checks and reject payload reuse', t => {
  const store = fixture(t);
  const one = store.execute(write(), claims('update'));
  assert.deepEqual(store.execute(write(), claims('update')), one);
  assert.throws(() => store.execute(write('1', 'key1', { ...guide, title: 'Changed' }), claims('update')), code('IDEMPOTENCY_CONFLICT'));
  assert.equal(store.execute(read(), claims()).revision, '1');
});
test('revision conflicts rollback writes without consuming idempotency keys', t => {
  const store = fixture(t);
  store.execute(write(), claims('update'));
  assert.throws(() => store.execute(write('0', 'key2'), claims('update')), code('REVISION_CONFLICT'));
  assert.equal(store.execute(write('1', 'key2'), claims('update')).revision, '2');
  assert.equal(store.history('s1', 'rental', guide.id).length, 2);
});
test('spaces and topic authorization isolate list reads and writes', t => {
  const store = fixture(t);
  store.execute(write(), claims('update'));
  assert.deepEqual(store.execute(read('s2'), claims('read', 's2')).guides, []);
  assert.throws(() => store.execute(read(), claims('read', 's2')), code('FORBIDDEN'));
  assert.throws(() => store.execute(write(), claims('read')), code('FORBIDDEN'));
  assert.throws(() => store.execute(read('s1', 'rights'), claims()), code('FORBIDDEN'));
  const catalog = store.execute({ operation: 'list_topics', spaceId: 's1' }, claims());
  assert.deepEqual(catalog.topics.map(row => row.topicId), ['rental']);
});
test('typed guide contract rejects code markup paths invalid versions and extra fields', t => {
  const store = fixture(t);
  for (const input of [
    { ...guide, title: '<img src=x>' },
    { ...guide, extra: true },
    { ...guide, blocks: [{ items: ['x'], html: 'no' }] },
    { ...guide, source: { ...guide.source, url: '/apps/knowledge/../memo/' } },
    { ...guide, source: { ...guide.source, url: '/apps/knowledge/x/#secret' } },
    { ...guide, source: { ...guide.source, url: 'https://external.invalid/' } },
    { ...guide, source: { ...guide.source, version: 0 } },
  ]) assert.throws(() => store.execute(write('0', 'bad', input), claims('update')), code('INVALID_INPUT'));
  assert.throws(() => store.execute(write('00'), claims('update')), code('INVALID_REVISION'));
  assert.throws(() => store.execute({ ...read(), input: { arbitrary: true } }, claims()), code('INVALID_REQUEST'));
  assert.equal(store.execute(read(), claims()).revision, '0');
});
test('private SQLite file survives reopen with source and history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-guides-'));
  try {
    const file = join(dir, 'memo.db'); let store = new MemoStore({ file });
    store.execute(write(), claims('update')); store.close();
    store = new MemoStore({ file });
    assert.equal(store.execute(read(), claims()).guides[0].title, '租房');
    assert.equal(store.history('s1', 'rental', guide.id).length, 1);
    assert.equal(store.execute({ operation: 'events', spaceId: 's1', input: { after: 0 } }, claims()).events[0].revision, '1'); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
async function serverFixture(t, options = {}) {
  const store = fixture(t);
  const server = createMemoServer({ store, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { store, base: `http://127.0.0.1:${server.address().port}` };
}
test('standalone server exposes local read only guide data and unchanged shell', async t => {
  const { store, base } = await serverFixture(t);
  store.execute({ ...write(), spaceId: 'local' }, claims('update', 'local'));
  assert.equal((await (await fetch(`${base}/api/config`)).json()).managed, false);
  const result = await fetch(`${base}/api/guides?topic=rental`);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).guides[0].title, '租房');
  assert.equal((await fetch(`${base}/api/guides?topic=rental&spaceId=s1`)).status, 400);
  assert.equal((await fetch(`${base}/api/business`, { method: 'POST' })).status, 503);
  assert.match(await (await fetch(base)).text(), /Memo/);
});
test('managed Memo serves static shell but rejects unsigned private data and writes', async t => {
  const { base } = await serverFixture(t, { key, spaces: ['s1'] });
  assert.equal((await fetch(`${base}/api/guides?topic=rental`)).status, 403);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);
  assert.equal((await fetch(`${base}/api/business`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(write()) })).status, 401);
  assert.equal((await fetch(`${base}/api/invoke`, { method: 'POST' })).status, 405);
});
test('signed adapter authenticates body scope expiry and handles CRUD', async t => {
  const { base } = await serverFixture(t, { key, spaces: ['s1'] });
  const call = async (request, changes = {}, suffix = '') => { const { raw, assertion } = signed(request, changes); return fetch(`${base}/api/business`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Praxis-Assertion': assertion }, body: raw + suffix }); };
  assert.equal((await call(write())).status, 200);
  assert.equal((await (await call(read())).json()).guides.length, 1);
  assert.equal((await call(read(), {}, ' ')).status, 401);
  assert.equal((await call(read(), { expiresAt: Date.now() - 1 })).status, 401);
  assert.equal((await call(read(), { expiresAt: Date.now() + 60000 })).status, 401);
  assert.equal((await call(read(), { appId: 'knowledge' })).status, 401);
  assert.equal((await call(read(), { resources: ['rights'] })).status, 403);
  assert.equal((await call(read('s2'))).status, 403);
});
test('durable outbox is atomic idempotent metadata-only and isolated by space and topic', t => {
  const store = fixture(t);
  const events = (spaceId = 's1', resources = ['*'], after = 0) => store.execute({ operation: 'events', spaceId, input: { after } }, claims('read', spaceId, resources));
  assert.deepEqual(events().events, []);
  store.execute(write(), claims('update'));
  store.execute(write(), claims('update'));
  assert.throws(() => store.execute(write('0', 'failed-write'), claims('update')), code('REVISION_CONFLICT'));
  store.execute({ operation: 'archive_guide', spaceId: 's1', resourceId: 'rental', input: { id: guide.id }, expectedRevision: '1', idempotencyKey: 'archive' }, claims('update'));
  const result = events();
  assert.deepEqual(result.events.map(event => event.operation), ['set_guide', 'archive_guide']);
  assert.deepEqual(result.events.map(event => event.revision), ['1', '2']);
  assert.equal(result.events[0].cursor < result.events[1].cursor, true);
  assert.deepEqual(Object.keys(result.events[0]).sort(), ['committedAt', 'cursor', 'id', 'operation', 'resourceId', 'revision']);
  assert.equal(JSON.stringify(result).includes('签字前'), false);
  assert.deepEqual(events('s2').events, []);
  assert.deepEqual(events('s1', ['rights']).events, []);
  assert.deepEqual(events('s1', ['*'], result.cursor).events, []);
  assert.equal(events('s1', ['*'], result.cursor + 1).resetRequired, true);
  assert.throws(() => events('s1', ['*'], -1), code('INVALID_INPUT'));
});
