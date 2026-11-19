import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { backup, catalog, fixture, keys, MemoryStorage, now, plain, scripts, seed } from './backup-fixtures.mjs';

test('exports a versioned empty backup without changing storage', () => {
  const storage = new MemoryStorage();
  const result = JSON.parse(backup.encode(storage, catalog, new Date(now)));
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.appVersion, '0.5.8');
  assert.deepEqual(result.data, { records: [], prefs: {}, flow: null });
  assert.deepEqual(storage.snapshot(), {});
});

test('round trips proofs, mementos, original photos, preferences and paused flow', () => {
  const source = seed();
  const encoded = backup.encode(source, catalog, new Date(now));
  const destination = new MemoryStorage({ 'unrelated.app': 'untouched' });
  backup.restore(destination, backup.parse(encoded, catalog), catalog, now);
  assert.deepEqual(destination.snapshot(), source.snapshot());
  assert.deepEqual(JSON.parse(backup.encode(destination, catalog, new Date(now))), { ...fixture(), appVersion: backup.version });
});

test('restores running timers paused while retaining their absolute deadline', () => {
  const input = fixture();
  input.data.flow.paused = false;
  input.data.flow.remain = 0;
  const result = plain(backup.restore(new MemoryStorage(), input, catalog, now + 30000));
  assert.equal(result.flow.paused, true);
  assert.equal(result.flow.run, true);
  assert.equal(result.flow.endTs, input.data.flow.endTs);
  assert.equal(result.flow.remain, 90);
  assert.equal(input.data.flow.paused, false);
});

test('expired timers restore paused with no remaining time', () => {
  const input = fixture();
  input.data.flow.paused = false;
  input.data.flow.endTs = now - 1000;
  const restored = backup.restore(new MemoryStorage(), input, catalog, now);
  assert.equal(restored.flow.paused, true);
  assert.equal(restored.flow.remain, 0);
  assert.equal(restored.flow.endTs, now - 1000);
});

test('unstarted steps remain unstarted and legacy run state is supported', () => {
  const input = fixture();
  Object.assign(input.data.flow, { run: false, endTs: null, paused: false, remain: 0 });
  const restored = backup.restore(new MemoryStorage(), input, catalog, now);
  assert.equal(restored.flow.run, false);
  assert.equal(restored.flow.endTs, null);
  delete input.data.flow.run;
  input.data.flow.endTs = now + 10000;
  assert.equal(backup.restore(new MemoryStorage(), input, catalog, now).flow.paused, true);
});

const invalidCases = [
  ['unsupported schema', value => { value.schemaVersion = 2; }],
  ['missing records', value => { delete value.data.records; }],
  ['duplicate IDs', value => { value.data.records[1].id = value.data.records[0].id; }],
  ['unsafe ID', value => { value.data.records[0].id = "r');alert(1)//"; }],
  ['unsafe scene ID', value => { value.data.records[0].sceneId = 'hotel-in"'; }],
  ['invalid timestamp', value => { value.data.records[0].ts = -1; }],
  ['invalid item', value => { value.data.records[0].items[0].done = 'yes'; }],
  ['remote photo', value => { value.data.records[0].items[0].photo = 'https://example.com/photo.png'; }],
  ['SVG photo', value => { value.data.records[0].items[0].photo = 'data:image/svg+xml;base64,PHN2Zz4='; }],
  ['invalid base64', value => { value.data.records[0].items[0].photo = 'data:image/png;base64,@@@@'; }],
  ['wrong photo signature', value => { value.data.records[0].items[0].photo = 'data:image/jpeg;base64,YWJj'; }],
  ['oversized photo', value => { value.data.records[0].items[0].photo = 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'); }],
  ['unknown flow', value => { value.data.flow.fid = 'unknown'; }],
  ['unknown variant', value => { value.data.flow.vid = 'unknown'; }],
  ['invalid step', value => { value.data.flow.idx = 999; }],
  ['inconsistent timer', value => { value.data.flow.run = false; }],
  ['missing paused remainder', value => { delete value.data.flow.remain; }],
  ['invalid preferred variant', value => { value.data.prefs.fv_noodle = 'missing'; }],
  ['prototype preference', value => { value.data.prefs = JSON.parse('{"__proto__":{"polluted":true}}'); }],
];
for (const [name, mutate] of invalidCases) {
  test(`rejects ${name} before touching existing records`, () => {
    const input = fixture(); mutate(input);
    const storage = seed(); const previous = storage.snapshot();
    assert.throws(() => backup.restore(storage, input, catalog, now), { code: 'INVALID' });
    assert.deepEqual(storage.snapshot(), previous);
  });
}

test('rejects malformed JSON and an oversized file', () => {
  assert.throws(() => backup.parse('{', catalog), { code: 'INVALID' });
  assert.throws(() => backup.parse(' '.repeat(backup.maxBytes + 1), catalog), { code: 'INVALID' });
});

for (const failingIndex of [0, 1, 2]) {
  test(`rolls back byte-exact original values when write ${failingIndex + 1} exceeds quota`, () => {
    const storage = seed();
    storage.setItem(keys[0], ' [ ] ');
    storage.removeItem(keys[1]);
    const previous = storage.snapshot();
    const set = storage.setItem.bind(storage); let failed = false;
    storage.setItem = (key, value) => {
      if (key === keys[failingIndex] && !failed) { failed = true; throw new Error('Quota exceeded'); }
      set(key, value);
    };
    assert.throws(() => backup.restore(storage, fixture(), catalog, now), { code: 'STORAGE' });
    assert.deepEqual(storage.snapshot(), previous);
  });
}

test('does not hide corrupted local data in an apparently complete export', () => {
  const storage = seed(); storage.setItem(keys[0], '{');
  const previous = storage.snapshot();
  assert.throws(() => backup.encode(storage, catalog), { code: 'STORAGE' });
  assert.deepEqual(storage.snapshot(), previous);
});

test('clears an old flow only after a valid null-flow import', () => {
  const storage = seed(); const input = fixture(); input.data.flow = null;
  backup.restore(storage, input, catalog, now);
  assert.equal(storage.getItem(keys[2]), null);
  assert.equal(storage.getItem('unrelated.app'), 'untouched');
});

test('all inline scripts parse and the service worker follows the PRD version', () => {
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const prd = readFileSync(new URL('../docs/Memo_PRD.md', import.meta.url), 'utf8');
  assert.match(sw, /memo-v0\.5\.8/);
  assert.match(prd, /\| V0\.5\.8 \|/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /rel=["'](?:manifest|apple-touch-icon)|name=["']apple-mobile-web-app-/);
  assert.doesNotMatch(html, /hideA2hs|添加到主屏幕/);
});
