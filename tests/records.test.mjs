import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoStore } from '../src/store.mjs';
import { createMemoServer, loadMemoOptions } from '../src/server.mjs';
import { fixture } from './backup-fixtures.mjs';
const records = () => fixture().data.records;
const scope = (action = 'update', spaceId = 's1', resources = ['records']) => ({ action, spaceId, resources });
const read = (spaceId = 's1') => ({ operation: 'read_records', spaceId, resourceId: 'records' });
const write = (operation, input, expectedRevision = '0', idempotencyKey = 'one') => ({ operation, spaceId: 's1', resourceId: 'records', input, expectedRevision, idempotencyKey });
function storeFixture(t) { const store = new MemoStore({ file: ':memory:' }); t.after(() => store.close()); return store; }
test('records import CRUD CAS history and atomic outbox preserve photos', t => {
  const store = storeFixture(t), input = write('import_records', { records: records() });
  const one = store.execute(input, scope());
  assert.deepEqual(one.records, records()); assert.equal(one.revision, '1');
  assert.deepEqual(store.execute(input, scope()), one);
  assert.throws(() => store.execute(write('delete_record', { id: records()[0].id }, '0', 'stale'), scope()), { code: 'REVISION_CONFLICT' });
  const changed = { ...records()[0], items: [{ t: '更新汉字', done: false, photo: null }] };
  store.execute(write('put_record', { record: changed }, '1', 'two'), scope());
  store.execute(write('delete_record', { id: changed.id }, '2', 'three'), scope());
  assert.deepEqual(store.execute(read(), scope('read')).records, [records()[1]]);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM record_versions').get().n, 3);
  const events = store.execute({ operation: 'events', spaceId: 's1' }, scope('read')).events;
  assert.equal(events.length, 3); assert.equal(JSON.stringify(events).includes('image'), false);
});
test('imports merge absent IDs only and rollback on differing existing IDs', t => {
  const store = storeFixture(t);
  store.execute(write('put_record', { record: records()[0] }), scope());
  const conflict = records(); conflict[0].items[0].t = '其他内容';
  assert.throws(() => store.execute(write('import_records', { records: conflict }, '1', 'bad'), scope()), { code: 'IMPORT_CONFLICT' });
  assert.equal(store.execute(read(), scope('read')).revision, '1');
  assert.equal(store.execute(read(), scope('read')).records.length, 1);
  assert.equal(store.execute(write('import_records', { records: records() }, '1', 'good'), scope()).records.length, 2);
});
test('records reject mismatched scope invalid photos duplicate IDs and unknown fields', t => {
  const store = storeFixture(t);
  assert.throws(() => store.execute(read(), scope('read', 'other')), { code: 'FORBIDDEN' });
  assert.throws(() => store.execute(read(), scope('read', 's1', ['rights'])), { code: 'FORBIDDEN' });
  assert.deepEqual(store.execute(read('other'), scope('read', 'other')).records, []);
  for (const value of [
    { ...records()[0], html: '<script>' },
    { ...records()[0], items: [{ t: 'x', done: 'yes', photo: null }] },
    { ...records()[0], items: [{ t: 'x', done: true, photo: 'data:image/png;base64,YWJjZA==' }] },
    { ...records()[0], sceneId: '../<script>' },
  ]) assert.throws(() => store.execute(write('put_record', { record: value }), scope()));
  assert.throws(() => store.execute(write('replace_records', { records: [records()[0], records()[0]] }), scope()), { code: 'DUPLICATE_RECORD' });
  assert.equal(store.execute(read(), scope('read')).revision, '0');
});
test('configured data directory survives reopen and never creates a default store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-records-'));
  try {
    assert.equal(loadMemoOptions({ MEMO_DATA_DIR: dir }).dataDir, dir);
    let store = new MemoStore({ file: join(dir, 'memo.db') });
    store.execute(write('import_records', { records: records() }), scope()); store.close();
    store = new MemoStore({ file: join(dir, 'memo.db') });
    assert.deepEqual(store.execute(read(), scope('read')).records, records()); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('standalone records HTTP is typed same-origin and managed endpoints require assertions', async t => {
  const local = storeFixture(t), server = createMemoServer({ store: local });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ ...write('import_records', { records: records() }), spaceId: 'local' });
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
  assert.equal((await fetch(base + '/api/records', { ...options, headers: { ...options.headers, Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await fetch(base + '/api/records', options)).status, 200);
  assert.deepEqual((await (await fetch(base + '/api/records')).json()).records, records());
  assert.equal((await fetch(base + '/records-client.js')).status, 200);
  const managed = createMemoServer({ store: storeFixture(t), key: Buffer.alloc(32, 4), spaces: ['s1'] });
  await new Promise(resolve => managed.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => managed.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${managed.address().port}/api/records`)).status, 403);
});
