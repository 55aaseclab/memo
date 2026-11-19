import assert from 'node:assert/strict';
import { createMemoServer } from '../src/server.mjs';
import { MemoStore } from '../src/store.mjs';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { fixture, keys } from './backup-fixtures.mjs';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
let browser, server, origin;

before(async () => {
  server = createMemoServer({ store: new MemoStore({ file: ':memory:' }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
});

after(async () => {
  await browser?.close();
  if (server) { await new Promise(resolve => server.close(resolve)); server.memoStore.close(); }
});

async function pageFor(t) {
  server.memoStore.db.exec("DELETE FROM record_sets; DELETE FROM record_versions; DELETE FROM mutations; DELETE FROM memo_events;");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  await context.addInitScript(() => {
    localStorage.setItem("memo.locale", "zh");
    window.__beeps = 0; window.__locks = 0;
    navigator.vibrate = () => { window.__beeps++; return true; };
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__locks++; return { release: async () => {} }; } } });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(origin + '/#/r');
  await page.evaluate(({ data, keys }) => {
    for (const [index, value] of [data.records, data.prefs, data.flow].entries()) localStorage.setItem(keys[index], JSON.stringify(value));
    localStorage.setItem('unrelated.app', 'untouched');
  }, { data: fixture().data, keys });
  await page.reload();
  await page.waitForFunction(() => recordStore.ready && getRecs().length === 2);
  return page;
}

async function snapshot(page) {
  return page.evaluate(keys => Object.fromEntries([...keys, 'unrelated.app'].map(key => [key, localStorage.getItem(key)])), keys);
}

async function enterBackup(page) {
  await page.goto(origin + '/#/r');
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  await page.getByRole('heading', { name: '导出完整备份', exact: true }).waitFor();
}

async function select(page, value, name = 'memo-backup.json') {
  await page.locator('#backup-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
}

test('browser downloads and restores a complete backup after an explicit preview', async t => {
  const page = await pageFor(t);
  await enterBackup(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载备份文件' }).click(),
  ]);
  assert.match(download.suggestedFilename(), /^memo-backup-.*\.json$/);
  const source = await readFile(await download.path(), 'utf8');
  const data = JSON.parse(source).data;
  assert.deepEqual(data, fixture().data);
  await page.evaluate(keys => {
    localStorage.setItem(keys[1], '{}'); localStorage.removeItem(keys[2]);
  }, keys);
  const previous = await snapshot(page);
  await select(page, source);
  await page.getByText('2 条记录 · 2 张照片', { exact: false }).waitFor();
  assert.deepEqual(await snapshot(page), previous);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.MEMO_SCREENSHOT) await page.screenshot({ path: process.env.MEMO_SCREENSHOT, fullPage: true });
  await page.getByRole('button', { name: '导入并替换数据' }).click();
  await page.waitForURL('**/#/r');
  const restored = await snapshot(page);
  assert.equal(restored[keys[0]], null);
  assert.deepEqual(await page.evaluate(() => getRecs()), data.records);
  assert.deepEqual(JSON.parse(restored[keys[1]]), data.prefs);
  assert.deepEqual(JSON.parse(restored[keys[2]]), data.flow);
  assert.equal(restored['unrelated.app'], 'untouched');
  await page.locator('.rec').first().click();
  const image = page.locator('.photogrid img').first();
  await image.waitFor();
  assert.equal(await image.getAttribute('src'), data.records[0].items[0].photo);
  await page.waitForFunction(() => document.querySelector('.photogrid img').naturalWidth > 0);
});

test('browser rejects malformed, duplicate, unsafe and oversized files without changing data', async t => {
  const page = await pageFor(t); await enterBackup(page);
  const original = await snapshot(page);
  const duplicate = fixture(); duplicate.data.records[1].id = duplicate.data.records[0].id;
  const unsafe = fixture(); unsafe.data.records[0].items[0].photo = 'data:image/svg+xml;base64,PHN2Zy8+';
  for (const value of ['{', duplicate, unsafe]) {
    await select(page, value);
    await page.getByRole('status').filter({ hasText: '内容无效' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '导入并替换数据' }).count(), 0);
    assert.deepEqual(await snapshot(page), original);
  }
  await select(page, ' '.repeat(10 * 1024 * 1024 + 1), 'oversized.json');
  await page.getByRole('status').filter({ hasText: '文件过大' }).waitFor();
  assert.deepEqual(await snapshot(page), original);
});

test('browser rolls back all original values after a partial quota failure', async t => {
  const page = await pageFor(t); await enterBackup(page);
  const original = await snapshot(page);
  const serverBefore = await page.evaluate(() => getRecs());
  const input = fixture(); input.data.records[0].items[0].t = '恢复的新内容';
  await select(page, input);
  await page.getByRole('button', { name: '导入并替换数据' }).waitFor();
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) { Storage.prototype.setItem = original; throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); }
      return original.call(this, name, value);
    };
  }, keys[1]);
  await page.getByRole('button', { name: '导入并替换数据' }).click();
  await page.getByRole('status').filter({ hasText: '原有数据已保留' }).waitFor();
  assert.deepEqual(await snapshot(page), original);
  assert.deepEqual(await page.evaluate(() => getRecs()), serverBefore);
});

for (const expired of [false, true]) {
  test(`browser does not resume or ring an imported ${expired ? 'expired' : 'running'} timer`, async t => {
    const page = await pageFor(t); await enterBackup(page);
    const input = fixture();
    Object.assign(input.data.flow, { paused: false, remain: 0, endTs: Date.now() + (expired ? -1000 : 1000) });
    const deadline = input.data.flow.endTs;
    await select(page, input);
    await page.getByRole('button', { name: '导入并替换数据' }).click();
    await page.waitForURL('**/#/r');
    await page.goto(origin + '/#/f/noodle');
    await page.getByRole('button', { name: '▶ 继续', exact: true }).waitFor();
    await page.waitForTimeout(1200);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      const state = await page.evaluate(key => ({ flow: JSON.parse(localStorage.getItem(key)), beeps: window.__beeps, locks: window.__locks }), keys[2]);
      assert.equal(state.flow.paused, true);
      assert.equal(state.flow.endTs, deadline);
      assert.equal(state.beeps, 0);
      assert.equal(state.locks, 0);
    }
    await page.getByRole('button', { name: '▶ 继续', exact: true }).click();
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).paused, keys[2]), false);
    if (expired) assert.ok(await page.evaluate(() => window.__beeps > 0));
    else assert.ok(await page.evaluate(() => window.__locks > 0));
  });
}

test('browser keeps an unstarted imported timer idle until the user starts it', async t => {
  const page = await pageFor(t); await enterBackup(page);
  const input = fixture();
  Object.assign(input.data.flow, { run: false, paused: false, remain: 0, endTs: null });
  await select(page, input);
  await page.getByRole('button', { name: '导入并替换数据' }).click();
  await page.waitForURL('**/#/r');
  await page.goto(origin + '/#/f/noodle'); await page.reload();
  await page.getByRole('button', { name: '▶ 开始这一步', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(key => ({ run: JSON.parse(localStorage.getItem(key)).run, beeps: window.__beeps, locks: window.__locks }), keys[2]), { run: false, beeps: 0, locks: 0 });
  await page.getByRole('button', { name: '▶ 开始这一步', exact: true }).click();
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).run, keys[2]), true);
});
