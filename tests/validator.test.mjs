import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fixture } from './backup-fixtures.mjs';

const execute = promisify(execFile);
const validator = fileURLToPath(new URL('../scripts/validate-backup.mjs', import.meta.url));

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'memo-backup-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'synthetic.json');
}

test('validator emits metadata without modifying or exposing private content', async t => {
  const filename = await temporary(t); const source = JSON.stringify(fixture());
  await writeFile(filename, source);
  const { stdout, stderr } = await execute(process.execPath, [validator, filename]);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { format: 'memo-backup', schemaVersion: 1, appVersion: '0.5.3', exportedAt: fixture().exportedAt, records: 2, photos: 2, hasFlow: true });
  assert.equal(await readFile(filename, 'utf8'), source);
  assert.equal(stdout.includes('北京午饭'), false);
  assert.equal(stdout.includes('data:image'), false);
});

test('validator rejects malformed and duplicate records without exposing data', async t => {
  const filename = await temporary(t);
  const duplicate = fixture(); duplicate.data.records[1].id = duplicate.data.records[0].id;
  for (const source of ['{', JSON.stringify(duplicate)]) {
    await writeFile(filename, source);
    await assert.rejects(execute(process.execPath, [validator, filename]), error => {
      assert.equal(error.code, 1); assert.equal(error.stdout, '');
      assert.match(error.stderr, /^Invalid Memo backup:/);
      assert.equal(error.stderr.includes('北京午饭'), false);
      return true;
    });
    assert.equal(await readFile(filename, 'utf8'), source);
  }
});

test('validator rejects oversized and missing inputs', async t => {
  const filename = await temporary(t);
  await writeFile(filename, ' '.repeat(10 * 1024 * 1024 + 1));
  await assert.rejects(execute(process.execPath, [validator, filename]), error => {
    assert.match(error.stderr, /no larger than 10 MiB/); return error.code === 1;
  });
  await assert.rejects(execute(process.execPath, [validator]), error => {
    assert.match(error.stderr, /Usage:/); return error.code === 1;
  });
});
