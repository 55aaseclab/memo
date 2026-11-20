# Memo

English · [简体中文 · 完整操作和历史说明](README.zh-CN.md)

Memo combines checklists, timed routines, timestamped photos and private
records. Open **Travel**, **Cooking** or **Consumer rights** to browse the
built-in guidance. Completed records and personal guides retain their
original language. Select **简体中文** or **English** on the home screen to
change the interface language.

## Run

Use Node.js 22.13 or newer and run `npm start`. Open
`http://localhost:4325`, or open **Memo** in an authorized Praxis workbench.
The browser interface is plain HTML and JavaScript. The Node server uses SQLite.

## Storage and recovery

Set `MEMO_DATA_DIR` to a private directory outside the image. The server keeps
the records, photos and guides in `memo.db`. Managed deployments also use
`MEMO_BUSINESS_KEY_FILE` and `MEMO_SPACE_IDS`. Preferences and unfinished
timers live in the browser. First use imports old browser records and
reads them back from the server before removing the old local copy.

Use **My records → Backup and restore** to download a versioned JSON backup
including your records and this browser's settings and routines. On another
device, select the backup and confirm replacement. Resume timers manually.
Keep private backups out of Git. Validate a backup with
`node scripts/validate-backup.mjs /path/to/backup.json`. The validator
reports schema and counts. Use a consistent SQLite snapshot for server
backups.

## Development

The client, built-in scenes and routines are in `index.html`. The service
worker caches the application shell for offline access. The private APIs
require a connection. Run `npm test` and run the browser regressions with
Playwright. Software and PRD versions are aligned with the service-worker
cache version. Update the PRD before changing product behavior.

[Product requirements](docs/PRD.en.md) · [Roadmap](docs/ROADMAP.md)

## Praxis integration

The app-owned [provider contract](docs/PRAXIS-PROVIDER.md) supplies authorized source-backed cards and data-source metadata without exposing a new HTTP endpoint. Run `npm run test:provider` for the isolated provider checks.

## Praxis registration

App release: `0.5.9`. The app owns [`praxis-app.json`](praxis-app.json), its English and Simplified Chinese presentation, the icon at `public/praxis-icon.svg`, the declared PRD locations and any legacy icon aliases. `schemaVersion: 1` identifies the registration format; it is separate from this app release and from data, protocol and document revisions. Package and lockfile release metadata, where present, agree with the declaration.

[`apps.example.json`](apps.example.json) registers a local alias by referencing `./praxis-app.json` and `http://127.0.0.1:4325/`. Start the standalone service described above before using the example; registration does not start a backend or grant account, administrator or business-data access. Installation origins, data locations and access policy remain separately configured.

## App-owned container build

`Dockerfile.praxis` builds this application from its own repository, without a Praxis checkout or an external build context:

```sh
docker build -f Dockerfile.praxis -t praxis-memo:local .
```

Use the application configuration and persistent data locations documented above when running the image. The Praxis installation consumes the same app-owned build and deployment declaration.

## 应用自有容器构建

`Dockerfile.praxis` 可直接从本应用仓库构建，无需 Praxis 源码或额外构建上下文：

```sh
docker build -f Dockerfile.praxis -t praxis-memo:local .
```

运行镜像时沿用上文的应用配置与持久数据位置。Praxis 安装流程使用同一份应用自有构建文件与部署声明。
