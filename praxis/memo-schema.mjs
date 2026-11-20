export function createMemoSchema(z, dependencies = {}) {

const memoTopicSchema = z.enum(['rights', 'rental']);
const memoIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const memoRevisionSchema = z.string().max(15).regex(/^(0|[1-9]\d*)$/).refine(value => Number.isSafeInteger(Number(value)), 'Revision must be a safe nonnegative integer string.');
const text = maximum => z.string().min(1).max(maximum).refine(value => value === value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value), 'Text must be trimmed plain text without markup or control characters.');
const sourceUrl = z.string().max(2048).refine(value => {
  if (!value.startsWith('/apps/knowledge/') || /[\\\s?#]/.test(value)) return false;
  try {
    const url = new URL(value, 'https://memo.invalid');
    return url.origin === 'https://memo.invalid' && url.pathname === value && !/%(?:2e|2f|5c|00)/i.test(value);
  } catch { return false; }
}, 'Source URL must be a normalized Knowledge reading path.');
const memoGuideFields = {
  id: memoIdSchema,
  title: text(160),
  blocks: z.array(z.object({ heading: text(160).optional(), items: z.array(text(4000)).min(1).max(100) }).strict()).min(1).max(80),
  source: z.object({ app: z.literal('knowledge'), url: sourceUrl, entryId: memoIdSchema, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
};
const memoGuideSchema = z.object(memoGuideFields).strict().refine(value => Buffer.byteLength(JSON.stringify(value)) <= 200000, 'Guide exceeds the size limit.');
const memoRecordIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const memoPhotoSchema = z.string().max(2796244).refine(value => {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== match[2]) return false;
  return match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}, 'Invalid record photo.').nullable();
const memoRecordSchema = z.object({
  id: memoRecordIdSchema,
  sceneId: z.string().min(1).max(200).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>"']/.test(value)),
  kind: z.enum(['memo', 'proof']).optional(),
  ts: z.number().int().min(0).max(8640000000000000),
  items: z.array(z.object({ t: z.string().min(1).max(2000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)), done: z.boolean(), photo: memoPhotoSchema }).strict()).min(1).max(100),
}).strict();
const memoRecordsSchema = z.array(memoRecordSchema).max(5000).refine(records => new Set(records.map(record => record.id)).size === records.length && Buffer.byteLength(JSON.stringify(records)) <= 10 * 1024 * 1024 - 4096, 'Invalid record collection.');
const MEMO_RECORD_OPERATIONS = Object.freeze(['read_records', 'put_record', 'delete_record', 'import_records', 'replace_records']);
const memoInputs = Object.freeze({
  read_records: z.object({}).strict(),
  put_record: z.object({ record: memoRecordSchema }).strict(),
  delete_record: z.object({ id: memoRecordIdSchema }).strict(),
  import_records: z.object({ records: memoRecordsSchema }).strict(),
  replace_records: z.object({ records: memoRecordsSchema }).strict(),
  list_topics: z.object({}).strict(),
  events: z.object({ after: z.number().int().nonnegative().optional() }).strict(),
  read_topic: z.object({}).strict(),
  set_guide: memoGuideSchema,
  archive_guide: z.object({ id: memoIdSchema }).strict(),
});

return { memoTopicSchema, memoIdSchema, memoRevisionSchema, memoGuideFields, memoGuideSchema, memoRecordIdSchema, memoRecordSchema, memoRecordsSchema, MEMO_RECORD_OPERATIONS, memoInputs };
}
