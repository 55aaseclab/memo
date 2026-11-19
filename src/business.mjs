import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { TOPICS, fail, identifier, object } from './schema.mjs';
export function verifyAssertion(raw, assertion, key, now = Date.now()) {
  const invalid = () => fail('INVALID_ASSERTION', 401);
  if (typeof assertion !== 'string' || assertion.length > 32768) invalid();
  const parts = assertion.split('.');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) invalid();
  const actual = Buffer.from(parts[1], 'base64url');
  const expected = createHmac('sha256', key).update(parts[0]).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) invalid();
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { invalid(); }
  const keys = ['v', 'appId', 'userId', 'clientId', 'grantId', 'spaceId', 'action', 'resources', 'expiresAt', 'requestId', 'method', 'path', 'bodyHash'];
  if (!object(claims) || keys.some(name => !Object.hasOwn(claims, name)) || Object.keys(claims).some(name => !keys.includes(name))) invalid();
  if (claims.v !== 1 || claims.appId !== 'memo' || claims.method !== 'POST' || claims.path !== '/api/business' || claims.bodyHash !== createHash('sha256').update(raw).digest('hex') || !['read', 'update'].includes(claims.action)) invalid();
  if (!['userId', 'clientId', 'grantId', 'spaceId', 'requestId'].every(name => identifier(claims[name])) || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now || claims.expiresAt > now + 30000) invalid();
  if (!Array.isArray(claims.resources) || !claims.resources.length || claims.resources.length > 3 || new Set(claims.resources).size !== claims.resources.length || claims.resources.some(id => id !== '*' && !Object.hasOwn(TOPICS, id) && id !== 'records') || claims.resources.includes('*') && claims.resources.length !== 1) invalid();
  return claims;
}
export class MemoBusinessService {
  constructor({ store, key, spaces, now = () => Date.now() }) {
    if (!store || !Buffer.isBuffer(key) || key.length < 32 || key.length > 4096 || !Array.isArray(spaces) || !spaces.length || spaces.some(value => !identifier(value)) || new Set(spaces).size !== spaces.length) throw new Error('Memo business configuration is invalid.');
    this.store = store; this.key = Buffer.from(key); this.spaces = new Set(spaces); this.now = now;
  }
  handle(raw, assertion) {
    const claims = verifyAssertion(raw, assertion, this.key, this.now());
    if (!this.spaces.has(claims.spaceId)) fail('FORBIDDEN', 403);
    let request;
    try { request = JSON.parse(raw.toString('utf8')); } catch { fail('INVALID_REQUEST'); }
    return this.store.execute(request, claims);
  }
}
