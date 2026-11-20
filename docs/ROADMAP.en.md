# Memo roadmap

V0.5.9 · 19 November 2026 · [简体中文](ROADMAP.md)

## V0.5.4 · Workbench installation

Update the PRD before changing the install experience. Praxis owns the home-screen
entry. Remove Memo's web manifest, Apple installation metadata, app icon and install
prompt. Keep standalone browser access, the WeChat notice, standalone refresh,
offline mode, photos, timers, records and backup. Align the app version, service
worker cache and user guide. Validate V0.5.3 imports and V0.5.4 exports using
backup schema 1 without clearing local data.

Release evidence: 34 focused tests passed. Browser checks covered the existing
home actions and the removed installation prompt. The deployed service worker
reported 0.5.4.

## V0.5.5 · Consumer rights and rental guides

Implement the independent guide store and controlled API. Reuse the existing
card reader for **Consumer rights** and **Renting**. Connect scoped MCP and
its skill. After testing, the independent business agent reads the current
Knowledge sections, saves the content to the two Memo topics, reads it back
and updates the links at their source. Retain source history and existing
local data. Acceptance requires both entries to open and their stored content
to match the read-back.

Release evidence: 46 application tests and two synthetic browser flows
passed. The managed mobile reading endpoint was available. Real content
transfer used a separate scoped identity.

## V0.5.6 · Configurable server-side records

1. Define the record and photo contracts and the independent data directory.
2. Add a per-space SQLite record set, history, revisions and idempotency. Wire
   up the signed managed interface and the standalone interface.
3. Connect the existing save, delete and backup views. On first use, validate
   legacy local records and preserve them if import fails.
4. Test import, photos, access, concurrency and reopening. Mount the app's
   registered data root from the workbench. Confirm each real phone import
   separately after its user opens the app.

Release evidence: 55 tests passed and eight synthetic browser checks covered
old records, photos, complete backup and restore, rollback, manually resumed
timers and guide reading.

## V0.5.7 · Interaction review

Open scenes with the keyboard, check items and verify photo-preview dismissal
and focus restoration. Check that background record loads retain the current
checklist selection. Simulate a guide request failure and retry.

## V0.5.9 · English and Simplified Chinese

Release both languages together with English first. Check the default,
the switch, persistence and user-authored text. The control on the home
screen changes the language of the interface and built-in instructions.

## Built-in distribution

Publish the native application and its scoped data API as a pinned Praxis app. A fresh installation starts with empty private storage. Public source and synthetic tests ship independently of host configuration and records.

## Praxis provider / 工作台供数

Publish the app-owned card and data-source contract. Verify synthetic authorized records, native links, stable revisions, empty/error separation and metadata resolution. Keep storage keys, business records and video provisioning outside this module.

发布由应用维护的卡片与数据源合同，使用合成授权记录验证原生入口、稳定版本、空态与错误区分及元数据解析。供数模块不接触密钥、真实业务记录或视频引擎安装。

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.
