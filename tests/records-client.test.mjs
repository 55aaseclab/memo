import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fixture, MemoryStorage } from './backup-fixtures.mjs';
import { validateRecords } from '../src/records-schema.mjs';
import { MemoStore } from '../src/store.mjs';
const source = await readFile(new URL('../records-client.js', import.meta.url), 'utf8');
function setup(t, { failure, original = fixture().data.records } = {}) {
  const context = vm.createContext({ structuredClone }); vm.runInContext(source, context);
  const store = new MemoStore({ file: ':memory:' }); t.after(() => store.close());
  const storage = new MemoryStorage({ 'memo.records.v1': JSON.stringify(original), 'memo.prefs.v1': '{"future":true}' });
  let next = 0;
  const request = async (operation, input, expectedRevision, idempotencyKey) => {
    if (failure?.(operation)) throw Object.assign(new Error('Synthetic failure'), { status: 503 });
    return store.execute({ operation, spaceId: 'test', resourceId: 'records', ...(input ? { input } : {}), ...(expectedRevision !== undefined ? { expectedRevision, idempotencyKey } : {}) }, { spaceId: 'test', action: operation === 'read_records' ? 'read' : 'update', resources: ['records'] });
  };
  const client = context.createMemoRecordsClient({ request, storage, validate: validateRecords, uuid: () => String(++next) });
  return { client, storage, store, request };
}
test('legacy photos import once then browser key clears only after server read-back', async t => {
  const { client, storage, store } = setup(t);
  assert.equal(await client.start(), true);
  assert.equal(storage.getItem('memo.records.v1'), null);
  assert.equal(storage.getItem('memo.prefs.v1'), '{"future":true}');
  assert.deepEqual(client.get(), fixture().data.records);
  assert.equal(await client.start(), true);
  assert.equal(store.readRecords('test').revision, '1');
  assert.equal(await client.remove(fixture().data.records[0].id), true);
  assert.equal(client.get().length, 1);
  assert.equal(storage.getItem('memo.records.v1'), null);
});
test('failed import read or permission preserves browser source and never writes browser records', async t => {
  for (const failing of ['read_records', 'import_records']) {
    const { client, storage } = setup(t, { failure: operation => operation === failing });
    const before = storage.getItem('memo.records.v1');
    assert.equal(await client.start(), false); assert.equal(storage.getItem('memo.records.v1'), before);
    assert.equal(await client.put(fixture().data.records[0]), false);
    assert.equal(storage.getItem('memo.records.v1'), before);
  }
});
test('server conflict leaves both copies intact until explicitly resolved', async t => {
  const { client, storage, request } = setup(t);
  await request('put_record', { record: { ...fixture().data.records[0], ts: 1 } }, '0', 'server');
  const before = storage.getItem('memo.records.v1');
  assert.equal(await client.start(), false);
  assert.equal(storage.getItem('memo.records.v1'), before);
  assert.equal((await request('read_records')).records[0].ts, 1);
});
test('failed post-commit read-back retains legacy source and retry recognizes existing data', async t => {
  let reads = 0, failed = false;
  const { client, storage, store } = setup(t, { failure: operation => operation === 'read_records' && ++reads === 2 && !failed && (failed = true) });
  assert.equal(await client.start(), false);
  assert.notEqual(storage.getItem('memo.records.v1'), null);
  assert.equal(store.readRecords('test').revision, '1');
  assert.equal(await client.start(), true);
  assert.equal(storage.getItem('memo.records.v1'), null);
  assert.equal(store.readRecords('test').revision, '1');
});
