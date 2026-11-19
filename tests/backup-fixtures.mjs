import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
export const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const main = scripts.at(-1);
const start = main.indexOf('const FLOWS=[');
const end = main.indexOf('\n];', start) + 3;
export const catalog = vm.runInNewContext(main.slice(start, end) + ';FLOWS');
const context = vm.createContext({ TextEncoder, atob });
export const backup = vm.runInContext(scripts[0] + ';MemoBackup', context);
export const plain = value => JSON.parse(JSON.stringify(value));
export const keys = [...backup.keys];
export const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
export const now = Date.parse('2026-11-12T12:00:00.000Z');

export function fixture() {
  return {
    format: 'memo-backup', schemaVersion: 1, appVersion: '0.5.3', exportedAt: new Date(now).toISOString(),
    data: {
      records: [
        { id: 'r100x1', sceneId: 'hotel-in', ts: now - 5000, items: [
          { t: '汉字任务：北京午饭', done: true, photo },
          { t: '行李检查', done: false, photo: null },
        ] },
        { id: 'r100x2', sceneId: 'flow-煮面-方便面', kind: 'memo', ts: now, items: [
          { t: '留念', done: true, photo },
        ] },
      ],
      prefs: { a2hsHide: now, fv_noodle: 'instant', fv_wash: 'dw', future: { enabled: true } },
      flow: { fid: 'noodle', vid: 'instant', idx: 0, run: true, endTs: now + 120000, paused: true, remain: 120, startedTs: now - 60000 },
    },
  };
}

export class MemoryStorage {
  constructor(data = {}) { this.values = new Map(Object.entries(data)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  snapshot() { return Object.fromEntries(this.values); }
}

export function seed(data = fixture().data) {
  return new MemoryStorage({
    [keys[0]]: JSON.stringify(data.records),
    [keys[1]]: JSON.stringify(data.prefs),
    [keys[2]]: JSON.stringify(data.flow),
    'unrelated.app': 'untouched',
  });
}
