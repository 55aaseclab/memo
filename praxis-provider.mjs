import { createHash } from 'node:crypto';

// This module has no store, filesystem, credential or network access. The host
// supplies narrowly bound reads after resolving the current user's authority.
const metadata = {
  "version": 1,
  "appId": "memo",
  "name": "Memo",
  "cards": {
    "supported": true
  },
  "readOperations": [
    "list_topics",
    "read_topic",
    "read_records"
  ],
  "nativeReads": [],
  "dataSources": [
    {
      "id": "database",
      "label": "Guides, records and photos",
      "labels": {
        "zh": "指南、记录与照片"
      },
      "kind": "sqlite",
      "location": {
        "env": "MEMO_DATA_DIR",
        "relative": "memo.db"
      }
    },
    {
      "id": "device-records",
      "label": "Unimported device records",
      "labels": {
        "zh": "尚未导入的设备记录"
      },
      "kind": "browser",
      "location": {
        "kind": "browser",
        "storageKey": "memo.records.v1"
      },
      "description": "Device-only records are not proven covered by a server backup."
    },
    {
      "id": "device-preferences",
      "label": "Device preferences",
      "labels": {
        "zh": "设备偏好"
      },
      "kind": "browser",
      "location": {
        "kind": "browser",
        "storageKey": "memo.prefs.v1"
      }
    },
    {
      "id": "device-flow",
      "label": "Device timer state",
      "labels": {
        "zh": "设备计时状态"
      },
      "kind": "browser",
      "location": {
        "kind": "browser",
        "storageKey": "memo.flow.v1"
      }
    }
  ]
};
export function describe() { return structuredClone(metadata); }
const text = (value, limit = 800) => typeof value === 'string' ? value.slice(0, limit) : '';
const encode = value => encodeURIComponent(String(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const array = (value, key) => { if (!Array.isArray(value?.[key])) throw new Error('INVALID_SOURCE_RESPONSE'); return value[key]; };
const issue = state => state.errors.push({ code: 'SOURCE_UNAVAILABLE' });
function result(state) {
  const items = [...new Map(state.items.map(item => [item.id, item])).values()];
  return { status: state.errors.length ? state.reads ? 'partial' : 'unavailable' : items.length ? 'ready' : 'empty', items, ...(state.errors.length ? { errors: state.errors } : {}) };
}
function card({ spaceId = 'native-view', resourceId, objectId = resourceId, revision, title, preview, href, reason, reasonZh, kind = 'result', evidence = [], dueDate, updatedAt }) {
  if (!resourceId || !title || revision === undefined || revision === null || !String(revision) || typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) throw new Error('INVALID_SOURCE_PROJECTION');
  const version = String(revision);
  return { id: `${metadata.appId}:${encode(spaceId)}:${encode(objectId)}`, appId: metadata.appId, spaceId, resourceId, revision: version, kind,
    title: text(title, 240), ...(text(preview) ? { preview: text(preview) } : {}), reason,
    labels: { zh: { reason: reasonZh } },
    source: { name: metadata.name, appId: metadata.appId, spaceId, resourceId, revision: version, href },
    primaryAction: { label: `Open in ${metadata.name}`, labels: { zh: `在 ${metadata.name} 中打开` }, href },
    evidence: [{ label: 'Source record', labels: { zh: '原始记录' }, href, revision: version }, ...evidence],
    ...(dueDate ? { dueDate } : {}), ...(updatedAt ? { updatedAt } : {}) };
}
async function scoped(context, project) {
  const state = { items: [], errors: [], reads: 0 };
  if (!Array.isArray(context?.spaces) || typeof context?.invoke !== 'function') return { status: 'unavailable', items: [], errors: [{ code: 'READ_CONTEXT_UNAVAILABLE' }] };
  const read = async request => {
    try { const value = await context.invoke(request); if (!value || typeof value !== 'object') throw new Error('INVALID_SOURCE_RESPONSE'); state.reads++; return value; }
    catch { issue(state); return null; }
  };
  for (const spaceId of new Set(context.spaces)) {
    if (typeof spaceId !== 'string' || !spaceId) { issue(state); continue; }
    try { await project(spaceId, read, state); } catch { issue(state); }
  }
  return result(state);
}
async function native(context, project) {
  if (typeof context?.readNative !== 'function') return { status: 'unavailable', items: [], errors: [{ code: 'READ_CONTEXT_UNAVAILABLE' }] };
  const state = { items: [], errors: [], reads: 0 };
  try { const value = await context.readNative({ path: metadata.nativeReads[0], resourceId: metadata.nativeResourceId }); if (!value || typeof value !== 'object') throw new Error('INVALID_SOURCE_RESPONSE'); state.reads++; await project(value, state); }
  catch { issue(state); }
  return result(state);
}
export async function getDataInventory(context) {
  if (typeof context?.resolveDataSource !== 'function') return { status: 'unavailable', items: [], errors: [{ code: 'DATA_CONTEXT_UNAVAILABLE' }] };
  const items = [], errors = [];
  for (const source of metadata.dataSources) {
    try {
      const resolved = await context.resolveDataSource(structuredClone(source));
      if (!resolved) throw new Error('UNRESOLVED_SOURCE');
      for (const [index, value] of (Array.isArray(resolved) ? resolved : [resolved]).entries()) {
        const { applicationPath, hostPath, containerPath, volumeName, storageKey, status, description } = value;
        items.push({ id: Array.isArray(resolved) ? `${source.id}:${value.id || index}` : source.id, appId: metadata.appId, label: source.label, labels: source.labels, kind: source.kind, status: status || 'ready',
          ...(applicationPath ? { applicationPath } : {}), ...(hostPath ? { hostPath } : {}), ...(containerPath ? { containerPath } : {}), ...(volumeName ? { volumeName } : {}), ...(storageKey ? { storageKey } : {}), ...(description || source.description ? { description: description || source.description } : {}) });
      }
    } catch { errors.push({ id: source.id, code: 'DATA_SOURCE_UNAVAILABLE' }); items.push({ id: source.id, appId: metadata.appId, label: source.label, labels: source.labels, kind: source.kind, status: 'unavailable' }); }
  }
  return { status: errors.length ? items.some(item => item.status !== 'unavailable') ? 'partial' : 'unavailable' : items.length ? 'ready' : 'empty', items, ...(errors.length ? { errors } : {}) };
}

export async function getCards(context) {
  return scoped(context, async (spaceId, read, state) => {
    const listing = await read({ spaceId, operation: 'list_topics', input: {} }); if (!listing) return;
    for (const topic of array(listing, 'topics')) {
      const snapshot = await read({ spaceId, operation: 'read_topic', resourceId: topic.topicId, input: {} }); if (!snapshot) continue;
      for (const guide of array(snapshot, 'guides')) {
        if (guide.archived) continue;
        const href = `/apps/memo/#/g/${encode(topic.topicId)}/${encode(guide.id)}`;
        const revision = `${snapshot.revision}:${guide.version}`;
        const preview = guide.blocks?.flatMap(block => [block.heading, ...(block.items || [])]).filter(Boolean).join('\n');
        state.items.push(card({ spaceId, resourceId: topic.topicId, objectId: `${topic.topicId}/${guide.id}`, revision, title: guide.title, preview, href, reason: 'Saved situation guide', reasonZh: '已保存的场景指南', updatedAt: guide.updatedAt,
          evidence: [...(preview ? [{ label: 'Guide text', labels: { zh: '指南原文' }, excerpt: text(preview), href, revision }] : []), ...(guide.source?.url ? [{ label: 'Guide source', labels: { zh: '指南来源' }, href: guide.source.url, revision: String(guide.source.version) }] : [])] }));
      }
    }
    // 'records' is a distinct resource. A topic grant must not imply access.
    let records;
    try { records = await context.invoke({ spaceId, operation: 'read_records', resourceId: 'records', input: {} }); state.reads++; }
    catch (error) { if (![403, 404].includes(error.status)) issue(state); }
    if (!records) return;
    for (const record of array(records, 'records')) {
      const href = `/apps/memo/#/r/${encode(record.id)}`;
      const preview = record.items?.map(item => item.t).filter(Boolean).join('\n');
      state.items.push(card({ spaceId, resourceId: 'records', objectId: `records/${record.id}`, revision: digest(record), title: record.sceneId, preview, href, reason: 'Saved personal record', reasonZh: '已保存的个人记录', updatedAt: Number.isFinite(record.ts) ? new Date(record.ts).toISOString() : undefined,
        evidence: preview ? [{ label: 'Recorded checklist', labels: { zh: '记录中的清单' }, excerpt: text(preview), href, revision: String(records.revision) }] : [] }));
    }
  });
}
