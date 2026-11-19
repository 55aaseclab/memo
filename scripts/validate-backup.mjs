import { open, readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function main() {
  const [filename, ...extra] = process.argv.slice(2);
  if (!filename || extra.length) throw new Error('Usage: node scripts/validate-backup.mjs <backup.json>');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const helper = /<script id="memo-backup">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const start = html.indexOf('const FLOWS=[');
  const end = html.indexOf('\n];', start);
  if (!helper || start < 0 || end < start) throw new Error('Memo backup contract is unavailable');
  const context = vm.createContext({ TextEncoder, atob });
  const backup = vm.runInContext(helper + ';MemoBackup', context);
  const catalog = vm.runInContext(html.slice(start, end + 3) + ';FLOWS', context);
  const handle = await open(filename, 'r');
  let source;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > backup.maxBytes) throw new Error('Backup must be a regular file no larger than 10 MiB');
    source = await handle.readFile({ encoding: 'utf8' });
  } finally { await handle.close(); }
  const value = backup.parse(source, catalog);
  const photos = value.data.records.reduce((sum, record) => sum + record.items.filter(item => item.photo).length, 0);
  process.stdout.write(JSON.stringify({
    format: value.format,
    schemaVersion: value.schemaVersion,
    appVersion: value.appVersion,
    exportedAt: value.exportedAt,
    records: value.data.records.length,
    photos,
    hasFlow: value.data.flow !== null,
  }) + '\n');
}

main().catch(error => {
  const message = ['ENOENT', 'EACCES', 'EISDIR'].includes(error.code) ? 'Backup file cannot be read' : error.message;
  process.stderr.write('Invalid Memo backup: ' + message + '\n');
  process.exitCode = 1;
});
