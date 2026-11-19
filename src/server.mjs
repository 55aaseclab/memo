import { createServer as httpServer } from 'node:http';
import { readFileSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { MemoStore } from './store.mjs';
import { MemoBusinessService } from './business.mjs';
import { RECORD_OPERATIONS, MAX_RECORD_BYTES } from './records-schema.mjs';
import { TOPICS, fail, identifier } from './schema.mjs';
const defaultPublic = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
function json(request, response, status, result) {
  const body = JSON.stringify(result);
  response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  response.end(request.method === 'HEAD' ? undefined : body);
}
export function loadMemoOptions(env = process.env) {
  const managed = Boolean(env.MEMO_BUSINESS_KEY_FILE);
  if (managed && (!isAbsolute(env.MEMO_DATA_DIR || '') || !isAbsolute(env.MEMO_BUSINESS_KEY_FILE))) throw new Error('Managed Memo requires absolute data and key paths.');
  let key;
  if (managed) {
    const info = lstatSync(env.MEMO_BUSINESS_KEY_FILE);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.size > 4096) throw new Error('The Memo signing key must be a private regular file.');
    key = readFileSync(env.MEMO_BUSINESS_KEY_FILE);
  }
  const spaces = env.MEMO_SPACE_IDS ? env.MEMO_SPACE_IDS.split(',') : undefined;
  return { dataDir: env.MEMO_DATA_DIR || join(homedir(), '.local/share/memo'), managed, key, spaces };
}
export function createMemoServer({ store, dataDir = join(homedir(), '.local/share/memo'), key, spaces, managed = Boolean(key), localSpace = 'local', publicDir = defaultPublic, now } = {}) {
  if (!identifier(localSpace) || typeof managed !== 'boolean' || managed && !key) throw new Error('Memo requires a valid local space and managed configuration.');
  const ownsStore = !store;
  store ||= new MemoStore({ file: join(dataDir, 'memo.db'), ...(now ? { now } : {}) });
  let business;
  try { business = managed ? new MemoBusinessService({ store, key, spaces, ...(now ? { now } : {}) }) : null; }
  catch (error) { if (ownsStore) store.close(); throw error; }
  const staticFiles = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']], ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']], ['/records-client.js', ['records-client.js', 'text/javascript; charset=utf-8']]]);
  const server = httpServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 }, async (request, response) => {
    try {
      const raw = request.url || '/';
      if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u0020]/.test(raw) || /%(?:2f|5c|2e|00)/i.test(raw)) fail('NOT_FOUND', 404);
      const url = new URL(raw, 'http://memo.local');
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (url.pathname === '/health') return json(request, response, 200, { status: 'ok', managed });
        if (url.pathname === '/api/config') return json(request, response, 200, { managed, spaces: managed ? [] : [{ id: localSpace, name: '本地' }] });
        if (url.pathname === '/api/records') {
          if (managed) fail('BUSINESS_AUTH_REQUIRED', 403);
          if (url.search) fail('INVALID_REQUEST');
          return json(request, response, 200, store.execute({ operation: 'read_records', spaceId: localSpace, resourceId: 'records' }, { spaceId: localSpace, action: 'read', resources: ['records'] }));
        }
        if (url.pathname === '/api/guides') {
          if (managed) fail('BUSINESS_AUTH_REQUIRED', 403);
          const topic = url.searchParams.get('topic');
          if (!Object.hasOwn(TOPICS, topic) || [...url.searchParams.keys()].some(name => name !== 'topic') || url.searchParams.getAll('topic').length !== 1) fail('INVALID_RESOURCE');
          return json(request, response, 200, store.execute({ operation: 'read_topic', spaceId: localSpace, resourceId: topic }, { spaceId: localSpace, action: 'read', resources: [topic] }));
        }
        const file = staticFiles.get(url.pathname);
        if (!file) fail('NOT_FOUND', 404);
        const body = await readFile(join(publicDir, file[0]));
        response.writeHead(200, { ...headers, 'Cache-Control': 'no-cache', 'Content-Type': file[1], 'Content-Length': body.length });
        response.end(request.method === 'HEAD' ? undefined : body); return;
      }
      const records = url.pathname === '/api/records';
      if (request.method !== 'POST' || !records && url.pathname !== '/api/business' || url.search) fail('METHOD_NOT_ALLOWED', 405);
      if (records && managed) fail('BUSINESS_AUTH_REQUIRED', 403);
      if (!records && !business) fail('BUSINESS_UNAVAILABLE', 503);
      if (records) {
        const origin = request.headers.origin;
        if (request.headers['sec-fetch-site'] === 'cross-site' || origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) fail('FORBIDDEN', 403);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) fail('JSON_REQUIRED', 415);
      if (Number(request.headers['content-length']) > MAX_RECORD_BYTES) { request.resume(); fail('REQUEST_TOO_LARGE', 413); }
      const parts = []; let length = 0;
      for await (const part of request) { length += part.length; if (length > MAX_RECORD_BYTES) { request.resume(); fail('REQUEST_TOO_LARGE', 413); } parts.push(part); }
      const rawBody = Buffer.concat(parts);
      let result;
      if (records) {
        let input; try { input = JSON.parse(rawBody.toString('utf8')); } catch { fail('INVALID_REQUEST'); }
        if (!Object.hasOwn(RECORD_OPERATIONS, input?.operation) || input.spaceId !== localSpace || input.resourceId !== 'records') fail('INVALID_REQUEST');
        result = store.execute(input, { spaceId: localSpace, action: RECORD_OPERATIONS[input.operation], resources: ['records'] });
      } else {
        if (length > 262144) {
          let input; try { input = JSON.parse(rawBody.toString('utf8')); } catch { fail('INVALID_REQUEST'); }
          if (!Object.hasOwn(RECORD_OPERATIONS, input?.operation) || input.resourceId !== 'records') fail('REQUEST_TOO_LARGE', 413);
        }
        result = business.handle(rawBody, request.headers['x-praxis-assertion']);
      }
      json(request, response, 200, result);
    } catch (error) { json(request, response, error.status || 500, { code: error.code || 'MEMO_UNAVAILABLE', message: error.status ? error.message : 'Memo is unavailable.' }); }
  });
  server.memoStore = store;
  if (ownsStore) server.on('close', () => store.close());
  return server;
}
