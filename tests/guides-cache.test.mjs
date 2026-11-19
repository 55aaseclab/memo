import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
function worker() {
  const events = new Map(), deleted = [], written = [];
  const caches = {
    keys: async () => ['memo-v0.5.4', 'memo-v0.5.5', 'memo-v0.5.8', 'travel-assets', 'knowledge-shell'],
    delete: async name => { deleted.push(name); return true; },
    open: async name => ({ put: async request => written.push({ name, url: request.url }), match: async () => undefined }),
    match: async () => undefined,
  };
  const self = { registration: { scope: 'https://example.test/apps/memo/' }, addEventListener: (name, handler) => events.set(name, handler), clients: { claim: async () => {} } };
  vm.runInNewContext(source, { self, URL, Set, Promise, caches, fetch: async () => ({ ok: true, type: 'basic', redirected: false, clone: () => ({}) }) });
  return { events, deleted, written };
}
test('service worker never handles private APIs, authentication, query URLs or other apps', async () => {
  const { events, written } = worker();
  for (const path of ['/api/business/catalog', '/api/business/invoke', '/auth/session', '/apps/memo/api/guides?topic=rights', '/apps/memo/api/records', '/api/business/memo-records', '/apps/memo/?memoSpace=private', '/apps/knowledge/', '/apps/memo/private.html']) {
    let handled = false;
    events.get('fetch')({ request: { method: 'GET', url: 'https://example.test' + path }, respondWith: () => { handled = true; } });
    assert.equal(handled, false, path);
  }
  let response;
  events.get('fetch')({ request: { method: 'GET', url: 'https://example.test/apps/memo/' }, respondWith: value => { response = value; } });
  assert.equal((await response).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(written, [{ name: 'memo-v0.5.8', url: 'https://example.test/apps/memo/' }]);
});
test('activation removes old Memo caches without deleting other app caches', async () => {
  const { events, deleted } = worker();
  let completed;
  events.get('activate')({ waitUntil: value => { completed = value; } });
  await completed;
  assert.deepEqual(deleted, ['memo-v0.5.4', 'memo-v0.5.5']);
});
