const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const fields = (value, required, optional = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('INVALID_INPUT');
};
export const RECORD_OPERATIONS = Object.freeze({ read_records: 'read', put_record: 'update', delete_record: 'update', import_records: 'update', replace_records: 'update' });
export const MAX_RECORD_BYTES = 10 * 1024 * 1024;
const recordId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function validateRecord(record) {
  fields(record, ['id', 'sceneId', 'ts', 'items'], ['kind']);
  if (!recordId(record.id) || !text(record.sceneId, 200) || /[<>"']/.test(record.sceneId) || !timestamp(record.ts) || record.kind !== undefined && !['memo', 'proof'].includes(record.kind)) fail('INVALID_RECORD');
  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 100) fail('INVALID_RECORD');
  for (const item of record.items) {
    fields(item, ['t', 'done', 'photo']);
    if (!text(item.t, 2000) || typeof item.done !== 'boolean') fail('INVALID_RECORD');
    if (item.photo === null) continue;
    if (typeof item.photo !== 'string' || item.photo.length > 2796244) fail('INVALID_PHOTO');
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.photo);
    if (!match || match[2].length % 4) fail('INVALID_PHOTO');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== match[2]) fail('INVALID_PHOTO');
    const valid = match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!valid) fail('INVALID_PHOTO');
  }
  return record;
}
export function validateRecords(records) {
  if (!Array.isArray(records) || records.length > 5000 || Buffer.byteLength(JSON.stringify(records)) > MAX_RECORD_BYTES - 4096) fail('INVALID_RECORDS');
  const seen = new Set();
  for (const record of records) { validateRecord(record); if (seen.has(record.id)) fail('DUPLICATE_RECORD'); seen.add(record.id); }
  return records;
}
export function validateRecordInput(operation, input) {
  if (!Object.hasOwn(RECORD_OPERATIONS, operation)) fail('INVALID_REQUEST');
  if (operation === 'read_records') { fields(input || {}, []); return; }
  if (operation === 'put_record') { fields(input, ['record']); validateRecord(input.record); }
  else if (operation === 'delete_record') { fields(input, ['id']); if (!recordId(input.id)) fail('INVALID_RECORD'); }
  else { fields(input, ['records']); validateRecords(input.records); }
}
