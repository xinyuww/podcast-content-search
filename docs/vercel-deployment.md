# Vercel 部署与音频发布

更新：2026-10-03。当前公开地址：[产品首页](https://podcast-content-search.vercel.app) · [固定 Demo](https://podcast-content-search.vercel.app/demo)。仓库为 [xinyuww/podcast-content-search](https://github.com/xinyuww/podcast-content-search)。

## 当前部署架构

- Vercel 运行 Next.js 网页及 Node.js 24 API，区域配置为 `iad1`。
- `/api/needs` 调用需求理解模型；`/api/playlists` 为当前查询生成向量，读取已有章节向量、规则排序并组盘。
- `/demo` 与 `/api/demo` 读取固定拼盘，不调用模型。
- `server/data/corpus.sqlite3` 是随服务端发布的只读快照，不位于 `public/`，没有数据库下载接口。
- 浏览器直接播放专用 Vercel Blob 中的原单集音频，包含 10 个 MP3 和 5 个 M4A/AAC。片段和全集使用同一地址，以时间戳控制边界。
- Python、ffmpeg、源数据库及音频缓存只用于本地素材维护；线上不启动 Python 服务，不使用 Worker，也不回退到官方音源。

SQLite 保存素材、字幕、时间戳、标签、向量和音频地址；音频二进制独立存放于 Blob。完整关系见[系统架构](product-architecture.md)。

## GitHub 自动部署

Vercel 项目为 `podcast-content-search`，空间为 `xwei1`，已连接上述 GitHub 仓库。

1. 将开发改动提交并推送到开发分支，Vercel 构建 Preview，可在 Deployments 中查看链接和状态。
2. 预览确认后合并到 `main` 并推送，触发 Production 构建；构建成功后正式域名更新。
3. 仅本地 commit 或 merge 不会更新网站。worktree 的文件夹位置也不决定部署目标，推送的分支才决定。

项目采用 Next.js 框架，Node.js 24，安装命令 `npm ci`，构建命令 `npm run build`。`next.config.ts` 将 SQLite 快照纳入相关服务端路由的文件追踪。云端只校验快照，不运行转录、标注或向量化。

## 环境变量

`OPENAI_API_KEY` 在 Vercel 的 Production / Preview 环境分别配置为服务端 Secret。GitHub 只提供代码和快照；构建与运行时由 Vercel 注入对应环境变量。

- 不提交 `.env.local`，不使用 `NEXT_PUBLIC_` 前缀，不需要把密钥写进 GitHub Actions。
- 公开读取 Blob 音频不需要写入凭据；网页运行无需配置音频上传权限。
- 修改环境变量后重新部署对应环境，才能使新部署使用配置。
- 本机代理地址只用于本地，不上传到 Vercel。

API 设有请求大小、同源、超时及共享的单实例最多 4 个活动请求限制；路由最大执行时间为 60 秒。部署记录中已设置 Vercel Firewall 对 `/api/` 的 POST 请求按 IP 每 60 秒限制 12 次。单实例并发和 IP 限制都不等于全局费用上限；云端设置以项目控制台为准。

## 本地运行与验证

日常开发见 [README](../README.md#本地运行)，不需要本地 Python 环境。发布前的自动化与人工检查见[测试与验收](testing.md)。

### 本地代理

如果本机访问模型或 npm 需要代理，可按实际端口设置。以下以 `127.0.0.1:7890` 为例，并要求 Node.js 24：

```sh
npm ci --proxy=http://127.0.0.1:7890 --https-proxy=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 NODE_USE_ENV_PROXY=1 npm run dev
```

## 更新已有素材快照

在有 `.venv`、`data/podcasts.sqlite3`、源音频缓存和上传清单的本地维护环境中执行：

```sh
npm run snapshot:export
npm run snapshot:verify
```

导出检查章节、标注、向量有效性、音频哈希和时间边界，复制已有向量，不调用模型、不重新转录，也不修改源数据库。当前快照包含 15 期、185 章、165 个向量、4,157 条字幕，其中 164 章可独立推荐。

将 `server/data/corpus.sqlite3` 与 `server/data/corpus.json` 一起提交并发布。后者记录统计和哈希；不能只改其中一个文件。用户会话与新查询不会写入只读快照。

## 发布新增或修正的音频

音频 store 为 `podcast-demo-audio`，ID 为 `store_ELsFDSRO8QRM3Ptd`，专用域名记录在 `lib/audio-host.json`。当前约 625 MiB 的原始媒体独立托管，不打包进网页函数。

此流程只在素材维护时运行，需要源音频、Vercel CLI 登录及关联项目的 development OIDC 凭据；通过 CLI 获取凭据，不打印 `.env.local`。`VERCEL_CLI` 指向已安装 CLI 的绝对路径。

```sh
BLOB_STORE_ID=store_ELsFDSRO8QRM3Ptd node --env-file=.env.local scripts/upload-audio.mjs
node scripts/verify-hosted-audio.mjs
npm run snapshot:export
npm run snapshot:verify
```

上传脚本核对原文件 SHA-256，并按文件头识别容器，以 `.mp3` / `audio/mpeg` 或 `.m4a` / `audio/mp4` 发布。不能依据本地缓存的 `.mp3` 后缀判断真实格式。文件路径带内容哈希，结果逐个记录，重跑可跳过已完成项目。

`data/hosted-audio.json` 保存 URL、哈希、字节数和媒体类型。验证脚本检查文件开头与中间的 Range 响应、类型和字节一致性；它不能代替浏览器试听。快照导出统一替换固定和动态拼盘的音源，保留原文件时间轴。发布后还需测试实际播放、定位、自动换段和全集返回。

## 发布边界与版本记录

`.gitignore` 排除密钥、原始数据库、音频和处理缓存；`.vercelignore` 进一步排除本地工具与非运行文件。旧试听产物在 `data/raw/legacy-demo-audio/`；`public/` 不发布原音频或数据库。已移除停用的 Sites 托管配置，当前只使用 Vercel 部署。

2026-10-03 的播放修复版本为 `3aec4da`，部署 ID 为 `dpl_2CGL8GxSnjMrts8Pmwayi2XjVBn4`：修正媒体类型，并将固定 20 秒加载超时改为进展感知的停滞计时。之后公开版声音获人工试听确认；自动化与未覆盖项见[测试与验收](testing.md)。这是已记录版本，不保证始终是仓库的最新提交。
