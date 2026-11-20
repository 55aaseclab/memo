import { projectInventory } from './inventory.mjs';
function validateMemo(document) { if(!document||document.format!=='memo-backup'||document.schemaVersion!==1||!/^\d+\.\d+\.\d+$/.test(document.appVersion??'')||!Number.isFinite(Date.parse(document.exportedAt))||!document.data||!Array.isArray(document.data.records)||!document.data.prefs||typeof document.data.prefs!=='object'||Array.isArray(document.data.prefs)||!(document.data.flow===null||typeof document.data.flow==='object'))throw Error('Invalid Memo backup document'); }
export function createStorageIntegration() { return {
  inventory: { project: projectInventory },
  "rootId": "memo",
  "paths": {
    "memo": ""
  },
  "sources": [
    {
      "kind": "sqlite",
      "path": "memo",
      "relative": "memo.db",
      "target": "memo.db"
    }
  ],
  "omissions": [
    "Memo browser localStorage and photos require a full JSON export; a server volume does not include them."
  ],
  validators: {"memo-backup-v1": validateMemo},
  relocation: {
  "businessBindings": {
    "dataDir": "memo"
  }
},
  registrations: [
  {
    "command": "register-memo-export",
    "kind": "json",
    "schema": "memo-backup-v1",
    "target": "browser-export.json",
    "fileValidation": {
      "script": "scripts/validate-backup.mjs",
      "summaryFields": [
        "exportedAt"
      ]
    },
    "message": "Browser export registered. Export again after browser changes to update the backup source."
  }
],
  recovery: { configFields: ['dataDir'], async collect(ctx) { await ctx.register({ kind: 'sqlite', source: ctx.path('dataDir', 'memo.db'), target: 'memo.db' }); } }
}; }
