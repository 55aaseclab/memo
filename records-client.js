/* Records stay in the server store; the old browser key is an import source only. */
globalThis.createMemoRecordsClient = function ({ request, storage, validate, uuid = () => crypto.randomUUID(), onError = () => {} }) {
  const legacyKey = 'memo.records.v1';
  let records = [], revision = '0', ready = false, starting, busy = false;
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  function accept(result) {
    if (!result || result.resourceId !== 'records' || typeof result.revision !== 'string' || !/^(0|[1-9]\d{0,14})$/.test(result.revision)) throw new Error('Invalid records response.');
    validate(result.records); records = structuredClone(result.records); revision = result.revision;
  }
  async function read() { accept(await request('read_records')); }
  async function start() {
    if (starting) return starting;
    starting = (async () => {
      ready = false;
      try {
        const raw = storage.getItem(legacyKey);
        let legacy = [];
        if (raw !== null) { legacy = JSON.parse(raw); validate(legacy); if (!records.length) records = structuredClone(legacy); }
        await read();
        if (legacy.length) {
          const present = legacy.every(record => records.some(item => item.id === record.id && equal(item, record)));
          if (!present) {
            accept(await request('import_records', { records: legacy }, revision, 'import-' + uuid()));
            await read();
          }
          if (!legacy.every(record => records.some(item => item.id === record.id && equal(item, record)))) throw new Error('Import read-back failed.');
        }
        if (raw !== null && storage.getItem(legacyKey) === raw) storage.removeItem(legacyKey);
        ready = true; return true;
      } catch (error) { if ([401, 403].includes(error.status)) records = []; onError(error); return false; }
      finally { starting = null; }
    })();
    return starting;
  }
  async function mutate(operation, input) {
    if (busy) return false;
    busy = true;
    try {
      if (!ready && !await start()) return false;
      await read();
      const key = 'records-' + uuid();
      accept(await request(operation, input, revision, key));
      return true;
    } catch (error) { ready = false; if ([401, 403].includes(error.status)) records = []; onError(error); return false; }
    finally { busy = false; }
  }
  return {
    start, get: () => structuredClone(records),
    put: record => mutate('put_record', { record }),
    remove: id => mutate('delete_record', { id }),
    replace: next => mutate('replace_records', { records: next }),
    get ready() { return ready; },
  };
};
