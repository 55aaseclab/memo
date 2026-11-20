# Memo product requirements

English current contract · [简体中文 and detailed requirements](Memo_PRD.md)

Version: V0.5.9

Help people prepare for a situation, follow the relevant checklist, and retrieve the evidence they saved. Organize moment cards, guides and personal archives by the situation a person recognizes.

## Prepare and act

Open a category, select the situation and follow the checklist or timed workflow. Record progress, attach photos where supported and return to the same item after navigation. Keyboard users must be able to operate the same controls and close a photo with Escape.

## Store and recover

Keep server-backed guides, revisions, records and photos scoped to the authorized space. Show an accurate empty/error state, allow local retry, and preserve a recent checklist change when an older response arrives. Support complete JSON export/import of applicable device data and distinguish unimported browser records.

## Content ownership

Guide authors and authorized clients can maintain supported records through the app contract. Keep receipts, photos and other user evidence separate from reusable guidance. Respect source revision and permissions when saving.

This English brief covers the current product contract. The linked specification retains the detailed feature definitions, original acceptance records and release history.

The interface defaults to English, with a persistent Simplified Chinese choice. Translate interface copy before release and retain the original language of user data.

## Built-in distribution

Publish the native application and its scoped data API as a pinned Praxis app. A fresh installation starts with empty private storage. Public source and synthetic tests ship independently of host configuration and records.

## Praxis provider

The app owns a version-1 `praxis-provider.mjs` contract for source-backed workbench cards and data-source metadata. Reads use host-supplied authorized callbacks; the provider has no direct filesystem, credential or network access. Preserve native object links, real revisions or stable content hashes, and distinct empty, partial and unavailable results. Personal card handling never modifies shared records. See [provider contract](PRAXIS-PROVIDER.md).

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.
