import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { RECORD_OPERATIONS, validateRecords } from './records-schema.mjs';
import { TOPICS, fail, validateRequest } from './schema.mjs';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export class MemoStore {
  constructor({ file, now = () => Date.now() }) {
    if (typeof file !== 'string' || !file) throw new Error('A Memo database path is required.');
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      try { const info = lstatSync(file); if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077) throw new Error('Memo database must be a private regular file.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    this.now = now; this.db = new DatabaseSync(file);
    if (file !== ':memory:') chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS topics(space TEXT NOT NULL, topic TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(space,topic));
      CREATE TABLE IF NOT EXISTS guides(space TEXT NOT NULL, topic TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(space,topic,id));
      CREATE TABLE IF NOT EXISTS guide_versions(space TEXT NOT NULL, topic TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(space,topic,id,version));
      CREATE TABLE IF NOT EXISTS memo_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, space TEXT NOT NULL, resource TEXT NOT NULL, revision TEXT NOT NULL, operation TEXT NOT NULL, committed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS record_sets(space TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS record_versions(space TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, committed_at INTEGER NOT NULL, PRIMARY KEY(space,revision));
      CREATE TABLE IF NOT EXISTS mutations(space TEXT NOT NULL, topic TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(space,topic,key));`);
  }
  close() { this.db.close(); }
  revision(space, topic) { return String(this.db.prepare('SELECT revision FROM topics WHERE space=? AND topic=?').get(space, topic)?.revision || 0); }
  readTopic(space, topic) {
    return { topicId: topic, title: TOPICS[topic], revision: this.revision(space, topic), guides: this.db.prepare('SELECT payload FROM guides WHERE space=? AND topic=? ORDER BY rowid').all(space, topic).map(row => JSON.parse(row.payload)).filter(guide => !guide.archived), url: `/apps/memo/#/s/${topic}` };
  }
  history(space, topic, id) { return this.db.prepare('SELECT payload FROM guide_versions WHERE space=? AND topic=? AND id=? ORDER BY version').all(space, topic, id).map(row => JSON.parse(row.payload)); }
  events(spaceId, after, resources) {
    const cursor = this.db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM memo_events WHERE space=?').get(spaceId).cursor;
    const resetRequired = after > cursor;
    const rows = resetRequired ? [] : this.db.prepare('SELECT seq AS cursor,resource AS resourceId,revision,operation,committed_at AS committedAt FROM memo_events WHERE space=? AND seq>? ORDER BY seq LIMIT 1000').all(spaceId, after);
    return { spaceId, cursor: !resetRequired && rows.length === 1000 ? rows.at(-1).cursor : cursor, minCursor: 1, resetRequired, events: rows.filter(row => resources.includes('*') || resources.includes(row.resourceId)).map(row => ({ ...row, id: row.cursor })) };
  }
  readRecords(space) {
    const row = this.db.prepare('SELECT revision,payload FROM record_sets WHERE space=?').get(space);
    return { resourceId: 'records', revision: String(row?.revision || 0), records: row ? JSON.parse(row.payload) : [] };
  }
  executeRecords(request) {
    const { operation, spaceId: space, input } = request;
    if (operation === 'read_records') return this.readRecords(space);
    const fingerprint = createHash('sha256').update(JSON.stringify(stable(request))).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT fingerprint,result FROM mutations WHERE space=? AND topic=? AND key=?').get(space, 'records', request.idempotencyKey);
      if (prior) { if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 409); this.db.exec('COMMIT'); return JSON.parse(prior.result); }
      const current = this.readRecords(space);
      if (current.revision !== request.expectedRevision) fail('REVISION_CONFLICT', 409);
      let records = current.records;
      if (operation === 'put_record') {
        const index = records.findIndex(record => record.id === input.record.id);
        if (index === -1) records.push(input.record); else records[index] = input.record;
      } else if (operation === 'delete_record') {
        if (!records.some(record => record.id === input.id)) fail('NOT_FOUND', 404);
        records = records.filter(record => record.id !== input.id);
      } else if (operation === 'replace_records') records = input.records;
      else for (const record of input.records) {
        const existing = records.find(item => item.id === record.id);
        if (existing && JSON.stringify(stable(existing)) !== JSON.stringify(stable(record))) fail('IMPORT_CONFLICT', 409);
        if (!existing) records.push(record);
      }
      validateRecords(records);
      const revision = Number(current.revision) + 1;
      if (!Number.isSafeInteger(revision)) fail('REVISION_LIMIT', 409);
      const payload = JSON.stringify(records), committedAt = this.now();
      this.db.prepare('INSERT INTO record_sets VALUES(?,?,?) ON CONFLICT(space) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(space, revision, payload);
      this.db.prepare('INSERT INTO record_versions VALUES(?,?,?,?)').run(space, revision, payload, committedAt);
      this.db.prepare('INSERT INTO memo_events(space,resource,revision,operation,committed_at) VALUES(?,?,?,?,?)').run(space, 'records', String(revision), operation, committedAt);
      const result = { resourceId: 'records', revision: String(revision), records };
      this.db.prepare('INSERT INTO mutations VALUES(?,?,?,?,?)').run(space, 'records', request.idempotencyKey, fingerprint, JSON.stringify(result));
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); if ([5, 6].includes(error.errcode & 255)) fail('STORE_BUSY', 503); throw error; }
  }
  execute(request, claims) {
    const action = validateRequest(request);
    if (!claims || claims.spaceId !== request.spaceId || claims.action !== action || !Array.isArray(claims.resources) || !claims.resources.length) fail('FORBIDDEN', 403);
    const { spaceId: space, resourceId: topic, operation, input } = request;
    const allowed = topicId => claims.resources.includes('*') || claims.resources.includes(topicId);
    if (operation === 'events') return this.events(space, input?.after || 0, claims.resources);
    if (operation === 'list_topics') return { topics: Object.keys(TOPICS).filter(allowed).map(topicId => { const result = this.readTopic(space, topicId); return { topicId, title: result.title, revision: result.revision, count: result.guides.length, url: result.url }; }) };
    if (!allowed(topic)) fail('FORBIDDEN', 403);
    if (Object.hasOwn(RECORD_OPERATIONS, operation)) return this.executeRecords(request);
    if (operation === 'read_topic') return this.readTopic(space, topic);
    const fingerprint = createHash('sha256').update(JSON.stringify(stable(request))).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT fingerprint,result FROM mutations WHERE space=? AND topic=? AND key=?').get(space, topic, request.idempotencyKey);
      if (prior) { if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 409); this.db.exec('COMMIT'); return JSON.parse(prior.result); }
      if (request.expectedRevision !== this.revision(space, topic)) fail('REVISION_CONFLICT', 409);
      const existing = this.db.prepare('SELECT payload FROM guides WHERE space=? AND topic=? AND id=?').get(space, topic, input.id);
      const previous = existing && JSON.parse(existing.payload);
      if (operation === 'archive_guide' && (!previous || previous.archived)) fail('NOT_FOUND', 404);
      const committedAt = this.now();
      const at = new Date(committedAt).toISOString();
      const guide = { ...(operation === 'set_guide' ? structuredClone(input) : previous), version: (previous?.version || 0) + 1, archived: operation === 'archive_guide', createdAt: previous?.createdAt || at, updatedAt: at };
      const payload = JSON.stringify(guide);
      const revision = Number(this.revision(space, topic)) + 1;
      if (!Number.isSafeInteger(revision)) fail('REVISION_LIMIT', 409);
      this.db.prepare('INSERT INTO topics VALUES(?,?,?) ON CONFLICT(space,topic) DO UPDATE SET revision=excluded.revision').run(space, topic, revision);
      this.db.prepare('INSERT INTO guides VALUES(?,?,?,?,?) ON CONFLICT(space,topic,id) DO UPDATE SET version=excluded.version,payload=excluded.payload').run(space, topic, guide.id, guide.version, payload);
      this.db.prepare('INSERT INTO guide_versions VALUES(?,?,?,?,?)').run(space, topic, guide.id, guide.version, payload);
      this.db.prepare('INSERT INTO memo_events(space,resource,revision,operation,committed_at) VALUES(?,?,?,?,?)').run(space, topic, String(revision), operation, committedAt);
      const result = { topicId: topic, revision: String(revision), guide, url: `/apps/memo/#/g/${topic}/${guide.id}` };
      this.db.prepare('INSERT INTO mutations VALUES(?,?,?,?,?)').run(space, topic, request.idempotencyKey, fingerprint, JSON.stringify(result));
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); if ([5, 6].includes(error.errcode & 255)) fail('STORE_BUSY', 503); throw error; }
  }
}
