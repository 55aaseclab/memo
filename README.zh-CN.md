# Memo 备忘录

[English](README.md)

Memo 提供场景清单、逐步流程与个人记录。使用 Node 22.16 或更新版本，运行 `MEMO_DATA_DIR=/绝对路径/私有目录 npm start`，在本机 4325 端口打开。默认仅监听回环地址；需要另行配置服务签名和空间范围才能进行受管操作。导出、照片和个人记录放在源码目录之外。

[产品需求](docs/Memo_PRD.md) · [路线图](docs/ROADMAP.md)

## Praxis 集成

应用维护的[供数合同](docs/PRAXIS-PROVIDER.md)提供按授权过滤、有来源依据的卡片与数据源描述，不增加 HTTP 元数据入口。使用 `npm run test:provider` 验证隔离供数测试。
