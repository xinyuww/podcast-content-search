# 维护与清理边界

更新：2026-10-03。本文以当前 Next.js / Vercel / Blob 架构为准，只说明文件用途，不执行删除。

## 已完成的架构清理

未使用的登录模板、三个模板图标、旧播放器样式、旧试听样本、D1 / Drizzle 示例及依赖、Supabase 草案已移除。网页已迁移至 Next.js；旧 Worker、Vite / vinext 与 Cloudflare 运行链路不再属于当前架构。

过去关于“保留 Worker”“页面直接导入固定 JSON”“必须保留 public/demo-audio”的建议已失效。当前页面和 API 读取服务端 SQLite 快照，媒体读取 Blob。历史变更可通过 Git 记录追溯。

## 必须保留

| 文件或目录 | 原因 |
| --- | --- |
| `server/data/corpus.sqlite3` 与 `corpus.json` | 当前网页与 API 的只读素材及校验信息 |
| `lib/audio-host.json`、`data/hosted-audio.json` | 托管音源白名单与上传追溯记录 |
| `data/content-taxonomy.json` | 需求和内容共用的标签体系 |
| `data/collection.json`、标注、章节与处理报告 | 素材来源及可恢复依据 |
| `data/podcasts.sqlite3`、`data/raw/audio/` | 本地源数据库与原音频；不进入 Git，但不能当普通缓存删除 |
| `data/raw/openai-asr/`、主题切分与标注响应 | 已完成的模型产物、来源和断点依据，避免重复付费处理 |
| `next.config.ts`、`next-env.d.ts`、`vercel.json` | 当前构建、类型与部署配置 |
| `postcss.config.mjs`、Tailwind 依赖 | 当前 CSS 构建链路 |
| `data/demo-playlist-selection.json`、`data/demo-playlist.json` | 固定选段配置与快照导出的中间输入 |

## 可重建产物与可选维护

- `.next/`、`*.tsbuildinfo`、`__pycache__/` 可重建；不要在相关服务运行时整批清除。
- `node_modules/` 可用 `npm ci` 恢复，无需为了目录整洁删除。
- `data/raw/legacy-demo-audio/` 是旧离线试听产物，公开网页不依赖它；保留原音频和源库后可重新生成。
- `data/raw/auditions/` 与 `data/raw/review/` 是素材核听工具，不是线上播放来源。
- `outputs/` 的截图、联调报告和作品材料不参与运行，可按保留价值归档。
- 若本地还留有 `dist/`、`.vinext/` 或 `.wrangler/`，它们属于旧运行链路，当前构建不使用。`public/demo-audio/` 不应进入当前发布产物。

## 保留但不参与线上请求的代码

`backend/playlist_service.py` 和 `backend/search_content.py` 用于本地参考实现及测试，不是 Next.js 的服务依赖。`backend/pipelines/transcribe_local.py` 是 Whisper 备选。是否归档这些实现应结合离线维护和回归测试决定。

`prepare_expansion.py`、`finalize_corpus.py` 和 `data/collection-15.pending.json` 保留本批素材的工作流程，仍存在代码引用，不能直接把它们当作无用文件删除，也不应作为新批次的通用入口重跑。

只改文档不需要重新转录、重建源库或上传音频。涉及代码或数据的后续清理按[测试与验收](testing.md)选择对应检查。
