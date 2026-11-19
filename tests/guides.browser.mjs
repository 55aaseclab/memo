import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { fixture, keys } from './backup-fixtures.mjs';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
let server, browser, origin;
const calls = [];
const topics = {
  rights: { topicId: 'rights', revision: '1', guides: [{ id: 'principles', title: '维权原则', blocks: [{ heading: '办事原则', items: ['保留书面记录', '<img src=x onerror="window.__unsafe=true">'] }], version: 1 }] },
  rental: { topicId: 'rental', revision: '1', guides: [{ id: 'rental-process', title: '租房流程', blocks: [{ heading: '交接', items: ['记录表底数', '留存交接凭证'] }], version: 1 }] },
};

before(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const json = value => { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value)); };
    if (url.pathname.endsWith('/api/config')) return json({ managed: url.pathname.startsWith('/apps/'), spaces: [{ id: 'local', name: '本地' }] });
    if (url.pathname.endsWith('/records-client.js')) { response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await readFile(new URL('../records-client.js', import.meta.url))); return; }
    if (url.pathname === '/auth/session') return json({ csrfToken: 'synthetic-csrf' });
    if (url.pathname === '/api/business/catalog') return json({ spaces: [{ id: 'synthetic-space', apps: [{ id: 'memo', actions: ['read'] }] }] });
    if (url.pathname === '/api/business/invoke') {
      let body = ''; for await (const part of request) body += part;
      const invocation = JSON.parse(body); calls.push({ invocation, csrf: request.headers['x-csrf-token'] });
      return json(topics[invocation.resourceId]);
    }
    if (url.pathname.endsWith('/api/guides')) return json(topics[url.searchParams.get('topic')]);
    if (url.pathname === '/standalone/' || url.pathname === '/apps/memo/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(await readFile(new URL('../index.html', import.meta.url))); return;
    }
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

for (const mode of ['managed', 'standalone']) test(`${mode} reuses the guide reader and preserves local records`, async t => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + (mode === 'managed' ? '/apps/memo/' : '/standalone/'));
  const english = mode === 'standalone';
  await page.getByText('Consumer rights', { exact: true }).waitFor();
  if (!english) {
    await page.getByRole('button', { name: '简体中文' }).click();
    await page.reload();
  }
  await page.evaluate(({ data, keys }) => {
    localStorage.setItem(keys[0], JSON.stringify(data.records));
    localStorage.setItem(keys[1], JSON.stringify(data.prefs));
    localStorage.setItem(keys[2], JSON.stringify(data.flow));
    localStorage.setItem('unrelated.app', 'untouched');
  }, { data: fixture().data, keys });
  const snapshot = () => page.evaluate(() => ({ ...localStorage }));
  const original = await snapshot();
  await page.getByText(english ? 'Consumer rights' : '维权', { exact: true }).click();
  await page.getByRole('button', { name: '维权原则' }).click();
  await page.getByRole('heading', { name: '维权原则', exact: true }).waitFor();
  assert.equal(await page.locator('.guide img').count(), 0);
  assert.ok((await page.locator('.guide').innerText()).includes('<img src=x'));
  assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  await page.evaluate(() => { location.hash = '#/t/travel'; });
  await page.getByText(english ? 'Renting' : '租房', { exact: true }).click();
  await page.getByRole('button', { name: '租房流程' }).click();
  await page.getByRole('heading', { name: '租房流程', exact: true }).waitFor();
  assert.equal(await page.locator('.guide').innerText(), '租房流程\n交接\n记录表底数\n留存交接凭证');
  assert.deepEqual(await snapshot(), original);
  await page.evaluate(() => { location.hash = '#/s/hotel'; });
  await page.getByText(english ? 'Room check on arrival' : '进房 60 秒安检', { exact: true }).waitFor();
  await page.evaluate(() => { location.hash = '#/s/cook'; });
  await page.getByText(english ? 'Cook noodles' : '煮面', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  if (mode === 'managed') {
    assert.ok(calls.length >= 2);
    assert.ok(calls.every(call => call.csrf === 'synthetic-csrf' && call.invocation.appId === 'memo' && call.invocation.spaceId === 'synthetic-space' && call.invocation.operation === 'read_topic'));
  }
});
