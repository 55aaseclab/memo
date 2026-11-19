import { RECORD_OPERATIONS, validateRecordInput } from './records-schema.mjs';
export const TOPICS = Object.freeze({ rights: '维权', rental: '租房' });
export const ACTIONS = Object.freeze({ list_topics: 'read', events: 'read', read_topic: 'read', set_guide: 'update', archive_guide: 'update', ...RECORD_OPERATIONS });
export const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
export const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
export const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
export function fields(value, required, optional = []) {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('INVALID_INPUT');
}
function text(value, maximum = 4000) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value)) fail('INVALID_INPUT');
}
export function validateGuide(input) {
  fields(input, ['id', 'title', 'blocks', 'source']);
  if (!slug(input.id)) fail('INVALID_INPUT');
  text(input.title, 160);
  if (Buffer.byteLength(JSON.stringify(input)) > 200000) fail('INVALID_INPUT');
  if (!Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length > 80) fail('INVALID_INPUT');
  for (const block of input.blocks) {
    fields(block, ['items'], ['heading']);
    if (block.heading !== undefined) text(block.heading, 160);
    if (!Array.isArray(block.items) || !block.items.length || block.items.length > 100) fail('INVALID_INPUT');
    for (const item of block.items) text(item);
  }
  fields(input.source, ['app', 'url', 'entryId', 'version']);
  if (input.source.app !== 'knowledge' || !slug(input.source.entryId) || !Number.isSafeInteger(input.source.version) || input.source.version < 1) fail('INVALID_INPUT');
  const url = input.source.url;
  if (typeof url !== 'string' || url.length > 2048 || !url.startsWith('/apps/knowledge/') || /[\\\s?#]/.test(url)) fail('INVALID_INPUT');
  const parsed = new URL(url, 'https://memo.invalid');
  if (parsed.origin !== 'https://memo.invalid' || !parsed.pathname.startsWith('/apps/knowledge/') || parsed.pathname !== url.split('#')[0] || /%2f|%5c|%2e|%00/i.test(url)) fail('INVALID_INPUT');
  return input;
}
export function validateRequest(request) {
  fields(request, ['operation', 'spaceId'], ['resourceId', 'input', 'expectedRevision', 'idempotencyKey']);
  const { operation, resourceId, input } = request;
  if (!Object.hasOwn(ACTIONS, operation) || !identifier(request.spaceId)) fail('INVALID_REQUEST');
  if (['list_topics', 'events'].includes(operation) ? resourceId !== undefined : !(Object.hasOwn(RECORD_OPERATIONS, operation) ? resourceId === 'records' : Object.hasOwn(TOPICS, resourceId))) fail('INVALID_RESOURCE');
  if (Object.hasOwn(RECORD_OPERATIONS, operation)) validateRecordInput(operation, input);
  if (operation === 'events') {
    fields(input || {}, [], ['after']);
    if (input?.after !== undefined && (!Number.isSafeInteger(input.after) || input.after < 0)) fail('INVALID_INPUT');
    if (request.expectedRevision !== undefined || request.idempotencyKey !== undefined) fail('INVALID_REQUEST');
    return 'read';
  }
  if (ACTIONS[operation] === 'read') {
    if (request.expectedRevision !== undefined || request.idempotencyKey !== undefined || input !== undefined && (!object(input) || Object.keys(input).length)) fail('INVALID_REQUEST');
  } else {
    if (typeof request.expectedRevision !== 'string' || !/^(0|[1-9]\d{0,14})$/.test(request.expectedRevision) || !Number.isSafeInteger(Number(request.expectedRevision))) fail('INVALID_REVISION');
    if (!identifier(request.idempotencyKey)) fail('IDEMPOTENCY_REQUIRED');
    if (!Object.hasOwn(RECORD_OPERATIONS, operation)) {
      if (operation === 'set_guide') validateGuide(input);
      else { fields(input, ['id']); if (!slug(input.id)) fail('INVALID_INPUT'); }
    }
  }
  return ACTIONS[operation];
}
