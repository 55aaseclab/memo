import { access, lstat, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
const isWithin = (parent, child) => { const path = relative(resolve(parent), resolve(child)); return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)); };
const bind = (source, target, read_only) => ({ type: 'bind', source, target, read_only, bind: { create_host_path: false } });
export async function resolveMemoRuntime(app, { uid, workspace, protectedPaths = [], privateFiles = [] } = {}) {
  if (app === undefined) return null;
  if (!app || app.url !== 'http://127.0.0.1:4325/api/business' || !Array.isArray(app.spaces) || !app.spaces.length || new Set(app.spaces).size !== app.spaces.length || app.spaces.some(space => typeof space !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(space))) throw new Error('Memo requires explicit spaces and its fixed local adapter.');
  const paths = [app.dataDir, app.keyFile];
  if (paths.some(path => typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\\\0\r\n$]/.test(path))) throw new Error('Memo paths must be canonical absolute paths.');
  const [dataDir, keyFile] = paths;
  const overlaps = (left, right) => isWithin(left, right) || isWithin(right, left);
  if (dataDir.split('/').filter(Boolean).length < 3 || paths.some(path => isWithin(workspace, path)) || protectedPaths.filter(Boolean).some(path => overlaps(dataDir, resolve(path))) || privateFiles.filter(Boolean).some(path => isWithin(dataDir, resolve(path))) || overlaps(dataDir, dirname(keyFile)) || privateFiles.includes(keyFile)) throw new Error('Memo data and credentials must remain separate from source, controls and other applications.');
  const data = await lstat(dataDir), key = await lstat(keyFile), parent = await lstat(dirname(keyFile));
  if (!data.isDirectory() || data.isSymbolicLink() || data.uid !== Number(uid) || (data.mode & 0o777) !== 0o700 || await realpath(dataDir) !== dataDir) throw new Error('Memo requires a canonical private mode700 data directory.');
  if (!key.isFile() || key.isSymbolicLink() || key.nlink !== 1 || key.uid !== Number(uid) || (key.mode & 0o777) !== 0o600 || key.size < 32 || key.size > 4096 || !parent.isDirectory() || parent.uid !== Number(uid) || parent.mode & 0o077 || await realpath(keyFile) !== keyFile) throw new Error('Memo requires a canonical private mode600 signing key.');
  await access(dataDir, constants.R_OK | constants.W_OK);
  await access(keyFile, constants.R_OK);
  return { dataDir, keyFile, spaces: [...app.spaces] };
}

export function memoComposeService(runtime) {
  return {
    environment: { MEMO_DATA_DIR: '/data/memo', MEMO_BUSINESS_KEY_FILE: '/run/secrets/memo-key', MEMO_SPACE_IDS: runtime.spaces.join(',') },
    volumes: [
      { source: runtime.dataDir, target: '/data/memo', read_only: false },
      { source: runtime.keyFile, target: '/run/secrets/memo-key', read_only: true },
    ].map(binding => ({ type: 'bind', ...binding, bind: { create_host_path: false } })),
  };
}

export function createStackIntegration() { return {
services: [{ name: 'memo', port: 4325 }],
order: 30,
async resolveRuntime(ctx) { const runtime = await resolveMemoRuntime(ctx.business?.apps?.memo, { uid: ctx.uid, workspace: ctx.workspace, protectedPaths: ctx.protectedFor({ excludeSources: [{ id: 'memo' }], otherBusinessData: 'memo' }), privateFiles: ctx.privateFor({ except: 'memo', fields: ['keyFile','spacesFile','businessConfigFile'] }) }); return { settings: { memoBusiness: runtime }, sourceMap: runtime ? { memo: join(runtime.dataDir, 'memo.db') } : {} }; },
compose: ({ settings }) => ({ services: settings.memoBusiness ? { memo: memoComposeService(settings.memoBusiness) } : {} })
}; }
