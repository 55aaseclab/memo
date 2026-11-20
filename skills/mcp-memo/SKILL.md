---
name: mcp-memo
description: Read, create, update and archive authorized Memo guides with source provenance and scoped MCP permissions. 经已授权的 Memo MCP 查询、创建、修改和归档维权或租房指南；只操作业务文本，不操作代码与本机凭证。
---

# Memo guide operations

English · [简体中文](#memo-指南业务操作)

The fixed topics `rights` (rights protection) and `rental` have separate grants. These tools manage guide text, not UI layout, headings, moment cards, photos, receipts, browser preferences, timers or local backups. Skill discovery grants no additional permissions.

| Tool | When and how to use it |
| --- | --- |
| `memo_list_topics` | Supply `spaceId` to discover readable topics within that space. Use the returned scope. |
| `memo_read_topic` | Supply `spaceId` and `resourceId` (`rights` or `rental`). Read the current topic revision, guides and sources before editing. An empty topic has revision string `0`. |
| `memo_set_guide` | Create or update one guide with its topic, current `expectedRevision`, intent-specific `idempotencyKey`, and `id`, `title`, `blocks` and `source`. Check for duplicates and preserve unrelated content. Use the exact guide ID. |
| `memo_archive_guide` | Archive an active guide by exact ID with the current topic revision and idempotency key. History is retained. Do not remove source documents, photos or guides in other topics. |

## Content contract

- `id` is at most 80 lowercase letters, digits and hyphens, beginning with a letter or digit. Keep it stable within a topic, including retries.
- `title` is 1–160 plain-text characters. `blocks` has 1–80 sections. Each has only an optional `heading` (1–160 characters) and `items` (1–100 nonempty strings, up to 4,000 characters each). Trim surrounding whitespace. Maximum serialized content size is 200,000 bytes. No HTML, styles, scripts, arbitrary fields or page-break instructions.
- `source` contains only `app: "knowledge"`, `url`, `entryId` and `version`. Use the canonical reading path under `/apps/knowledge/` with no query, fragment or redirect. Use the actual source entry ID and its positive integer version. A citation identifies provenance; it does not verify legal claims or authorize additional legal advice.
- `expectedRevision` is the decimal string of a safe nonnegative integer. Read a fresh topic revision even for a new guide.

## Move a section from Knowledge

1. Through available, authorized Knowledge tools, read the latest original, its version and the precise section.
2. Read the destination topic and check for duplicate guides. Place general rights-protection principles in `rights`, and rental procedures or specific rental matters in `rental`. Preserve the source’s meaning and steps.
3. Save each guide separately and read it back. Check its contents, source and version.
4. Only after all destinations are confirmed, use an authorized precise Knowledge text operation to replace the source section with the matching Memo reading link. Preserve the surrounding document and its history. With Memo-only access, report the source edit as outstanding.

## Concurrency and reporting

Retry an identical request with its original key. After a revision conflict, reread and reassess the latest content before submitting a new intent with a new key. After a timeout or `OUTCOME_UNKNOWN`, inspect the current destination before attempting another write. On 401/403 stop and report the identity or permission issue. Never bypass authorization with files, CLI, SQL, a browser or a different connection. Report completion after both save and read-back succeed, citing the topic, guide ID, version/revision and server-returned reading link.

## Archive records

From Memo 0.5.6 the app can store evidence records, keepsakes and photos in its server-side archive. Guide MCP permissions still cover only `rights` and `rental`. They do not grant access to `records`; preferences and unfinished workflows remain browser-local. Do not use guide content to carry photos or substitute for an archive write tool.

# Memo 指南业务操作

指南与程序分离。固定主题 `rights`（维权）和 `rental`（租房）分别授权；界面布局、栏目名称、时刻卡、照片、凭证、偏好、计时和本机备份均不属于这些工具的写入范围。技能说明不增加任何权限。

| 工具 | 使用方式 |
|---|---|
| `memo_list_topics` | 传 `spaceId`，发现本连接在该空间获准读取的主题；目录不是额外授权。 |
| `memo_read_topic` | 传 `spaceId`、`resourceId`（`rights` 或 `rental`），读取最新主题修订号、指南与来源。更改前先读；空主题修订号为字符串 `0`。 |
| `memo_set_guide` | 新增或修改单条指南。传主题、当前 `expectedRevision`、本次意图固定的 `idempotencyKey`，以及 `id`、`title`、`blocks` 和 `source`。已有指南先查重，保持未要求修改的内容；不可用相似标题代替确定的 ID。 |
| `memo_archive_guide` | 删除活动指南时传确切 `id`、当前主题修订号与幂等键；实际为归档，历史保留。不能清理来源文档、照片或其他主题。 |

## 内容合同

- `id` 为最多80位的小写字母、数字和连字符，以字母或数字开头；同主题内稳定使用，不为重试另建指南。
- `title` 为1–160字的纯文本。`blocks` 为1–80个分节；每节只有可选 `heading`（1–160字）与 `items`（1–100个非空字符串，每项最多4000字）。字段为纯文本，不能传HTML、样式、脚本、任意字段或用换页代码设计界面。内容须去掉首尾空白，总序列化大小最多200000字节。
- `source` 只有 `app: "knowledge"`、`url`、`entryId`、`version`。`url` 必须是规范的 `/apps/knowledge/` 阅读路径，无参数、片段或跳转；`entryId` 是实际读取的来源条目ID，`version` 是对应正整数版本。来源记录不等同于法律事实已核验，不擅自扩写法律意见。
- `expectedRevision` 为安全非负整数的十进制字符串；新增指南也必须使用刚读取的主题修订号。

## 跨应用迁移

1. 用本连接实际可用且已授权的 Knowledge 工具读取最新原文、版本和准确小节，勿使用过时文件或记忆。
2. 用 `memo_read_topic` 查重、读取目标当前修订号。维权通用原则归 `rights`，租房流程与具体事项归 `rental`；保留原意和原有步骤，不自行编造建议。
3. 用 `memo_set_guide` 分别保存，每次写入后回读，逐项确认内容、来源和版本。
4. 所有目标确认成功之后，才可通过已授权的 Knowledge 精确文本接口，将原小节替换为对应 Memo 阅读链接；其余正文和历史保持。仅有 Memo 权限时停止在来源修改之前并说明该部分未执行。

## 并发、重试与回报

同一意图重试沿用原幂等键与请求，不重复创建。修订冲突先回读，基于最新内容重新判断并使用新意图键；不能强行覆盖。超时或 `OUTCOME_UNKNOWN` 先查目标状态，不能把不确定结果当作失败再次新增。遇401／403停止业务写入并报告身份或授权问题，不绕过到文件、CLI、SQL、浏览器或其他连接。只有保存与回读均成功才报告已完成，同时给出主题、指南ID、版本／修订号及服务端返回的阅读入口。


## 档案边界

Memo 0.5.6 起，凭证、留念和照片可由应用自己的服务端档案保存。上述指南 MCP 工具仍只管理 `rights`／`rental`，不会因此获得 `records` 档案资源；浏览器偏好和未完成流程仍在当前浏览器。本技能不提供档案写入工具，禁止以指南正文承载照片或绕过资源边界。
