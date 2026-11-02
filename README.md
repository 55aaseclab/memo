# Memo（暂名）

关键时刻留证工具：住店 / 租车 / 打车的时刻卡 + 时间水印拍照 + 本机凭证档案 + 出事了通道。

单文件 H5/PWA，无构建、无依赖、无后端，数据仅存本机 localStorage。

- 产品文档：[docs/Memo_PRD_V0.1.md](docs/Memo_PRD_V0.1.md)

## 本地运行

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

iPhone 使用：Safari 打开网址 → 分享 → 添加到主屏幕。

## 部署

整个目录即静态站点，任选其一：

```bash
npx vercel deploy .          # Vercel
npx wrangler pages deploy .  # Cloudflare Pages
git push                     # GitHub Pages（Settings 里开启）
```

## 结构

```
index.html          # 全部产品（内容引擎 SCENES/INCIDENTS + 视图 + 存储）
sw.js                # Service Worker：network-first 缓存 + 离线回退
docs/Memo_PRD_V0.1.md
```

## 版本

- V0（当前）：8 张时刻卡（住店/租车/打车/公交）、水印拍照、凭证档案、出事了分诊、主屏引导、deeplink（`#/c/hotel-out`）
- V1 规划：事件时间轴、服务号触达、云端加密备份、埋点
