# Vercel 部署

当前目标：保留 15 期素材，部署真实需求对话、语义检索、3–5 段 / 10–30 分钟拼盘与自行托管的原音频播放。

## 在线架构

- Next.js App Router + React：页面、交互和 API，Node.js 24。
- `POST /api/needs`：调用既有需求理解模型，返回结构化需求。
- `POST /api/playlists`：读取 SQLite 已有向量；只为当前查询调用 embedding API；余弦召回 30 段、标签规则排序、完整章节组合。无实时内容标注或生成式重排。
- `GET /api/demo`：返回固定示例，不调用模型。
- `server/data/corpus.sqlite3`：打包到服务端函数的只读快照，不位于 public，不提供数据库下载接口。
- 浏览器直接请求专用 Vercel Blob 中的原始 MP3；按开始时间定位，到章节结束自动切下一段；全集使用同一个托管地址。不依赖官方音源。
- SQLite 保存音频 URL、字幕、时间戳、标签与向量，MP3 二进制文件由 Blob 独立托管，不打包进函数。
- Python、ffmpeg、原始 SQLite 用于本地素材处理，线上不启动 Python 服务。

## 数据更新

```sh
npm run snapshot:export
npm run snapshot:verify
```

导出需要本地 `.venv`、已有 `data/podcasts.sqlite3` 和音频缓存。它核对章节/标注/向量是否过期，用本地音频时长检查边界，复制已有向量；不调用模型、不重新转录、不修改源数据库。

快照包含 15 期、185 章、165 个向量（164 章满足独立检索条件）、4,157 条字幕。`server/data/corpus.json` 保存源数据库哈希与快照哈希。更新这两个文件后重新部署即可。当前不保存用户会话、收藏或历史，也不向快照写入新查询。

## 本地运行与验证

```sh
npm ci
npm run dev
npm run test:web
npm run test:python
npm run build
npm run test:production
```

网页运行无需 Python、ffmpeg 或本地音频缓存。第一次完整素材导出及 Python 测试仍需要本地语料。`.env.local` 的 `OPENAI_API_KEY` 仅供服务端使用。固定示例无需密钥，但播放托管音频需要网络。

`test:production` 启动真实 Next.js 生产服务，对模型使用明确的测试替身；它不等于真实 OpenAI 联调通过。13 个语义场景的 Node 结果与原 Python 候选顺序、选中章节和状态作离线对照。

### 本机代理

此电脑已验证可用的 HTTP 代理为 `http://127.0.0.1:7890`。仅在本机运行时使用，不上传至 Vercel：

```sh
npm install --proxy=http://127.0.0.1:7890 --https-proxy=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 NODE_USE_ENV_PROXY=1 npm run dev
```

需要 Node.js 24。`.env.local` 应填入真实 `OPENAI_API_KEY`；中文占位文字不是密钥，不要提交到 Git 或发到聊天。安装中断出现 `ENOTEMPTY` 时先确认没有其他安装进程，保留旧依赖目录后重装，不要删除数据库或锁文件。

2026-10-02：已部署至 https://podcast-content-search.vercel.app 。48 项功能测试、5 项生产 HTTP 测试和 8 轮真实模型合成对话验收通过。需求模型遇到已完成但原话依据无效的输出时最多重新生成一次，两次共用 45 秒截止时间；拒绝和网络错误不重试。两条数据 API 的构建追踪包含 SQLite 快照。匿名公网访问首页、固定拼盘和真实对话/检索接口均成功；一个合成编程需求约 6 秒生成 3 段、779.548 秒拼盘。数据库、本地音频与 .env.local 路径均返回 404。浏览器自动化会话不可用，实际音频播放和手机端交互仍待人工试听。

部署空间：`xwei1`（Hobby）；项目：`podcast-content-search`。最初通过 CLI 发布；2026-10-03 已连接 `xinyuww/podcast-content-search`，启用 GitHub 自动部署。

上述 2026-10-02 版本的部署：`dpl_5jezMs9UYLcpUeJmvzomPKug1g7c`（使用官方音源，已由用户反馈播放失败）。`baseline-browser-mapping` 已更新到安全补丁版本；当时 `npm audit --omit=dev` 为 0 项已知漏洞。开发工具依赖仍有 8 项告警（7 high、1 low），未将其描述为全项目安全审计通过。

2026-10-03：部署 `dpl_3orgExAepGkuvr6bV1rLiuTDMjX7` 将全部 15 期切换到专用 Blob 中的本地原始 MP3。15/15 文件的开头与中间 Range 请求均返回 HTTP 206，字节与本地一致；50 项网页功能测试、43 项 Python 测试、5 项生产 HTTP 测试、类型检查、lint 与构建通过。源数据库 SHA-256 未变。匿名公网首页与固定拼盘成功，真实合成需求生成 3 段 / 956.708 秒拼盘（`partial_match`，约 5.7 秒），两类拼盘均返回新音源。报告在 `outputs/hosted-audio-verification.json` 与 `outputs/public-verification.json`。浏览器自动化导航仍超时，未完成实际出声、进度条走动和手机端实机验收；HTTP 分段读取检查不能替代这些验证。

## Vercel 项目设置

1. 使用 Vercel Hobby（个人非商业 demo，受免费额度限制），选择 Next.js 框架和 Node.js 24。
2. 部署代码和 `server/data/` 快照。Git 导入时把快照一起提交；CLI 部署使用 `.vercelignore` 排除原音频、本地数据库、密钥和处理缓存。
3. 在 Vercel 的服务端环境变量中设置 `OPENAI_API_KEY`，不要加 `NEXT_PUBLIC_` 前缀。Production/Preview 分别按需要配置。
4. 构建命令 `npm run build`；快照在本地导出，云端只校验，不运行素材处理流程。
5. 发布后验收首页、固定拼盘、真实对话、新查询检索、片段跳播、自动换段、全集返回、手机端。确认公开访问无需 Vercel 登录。

`vercel.json` 选择 iad1 部署区域，API 最大执行时间 60 秒。应用设置输入大小限制、同源校验、超时和单实例并发上限。已在 Vercel Firewall 启用 `Demo API rate limit`：对 `/api/` 下 POST 请求按 IP 限制为每 60 秒 12 次。此限制不是全局消费金额上限，也不能完全防止分布式滥用；继续在 OpenAI 项目侧管理用量。不要把只读 SQLite 改为用户访问计数器。

专用 `OPENAI_API_KEY` 保存在项目 Production 和 Preview Secret，未写入代码或 Git 仓库。`.env.local` 和 `.vercel/` 均被 Git 忽略。公开域名不需要 Vercel 登录，部署预览地址保留现有平台保护。

## GitHub 自动部署

- 仓库：`xinyuww/podcast-content-search`；生产分支：`main`；Preview 部署已启用，没有额外的忽略构建命令。
- 将修改 commit 后 push 到开发分支（例如 `codex/ui-design`），Vercel 自动构建并生成预览链接。在 Vercel Deployments 中按分支查看状态和链接。
- 预览确认后，把开发分支合并到 `main` 并 push，成功构建后正式域名 `https://podcast-content-search.vercel.app` 自动更新。仅本地 commit 或 merge 不会更新网站。
- GitHub 提供代码和只读 SQLite 快照；Vercel 注入对应环境的服务端 Secret。无需上传 `.env.local`，也不需要把 Secret 写进 GitHub Actions。
- 预览和正式版都读取同一批 Blob 音频，不重新上传或转录。公开音频读取不需要 Blob 写入凭据。
- 在 GitHub Desktop 添加 worktree 只是管理界面的选择，不是自动部署的前提；决定部署目标的是 push 的分支。
- CLI 部署仍可用于手动发布，但日常更新以 GitHub 分支流程为准。

2026-10-03 播放问题排查：发现 5 期 M4A/AAC 被错误命名并发布为 MP3 / `audio/mpeg`，包含固定 Demo 首段。发布脚本现按文件头识别容器，使用新的 `.m4a` 地址和 `audio/mp4`，避免缓存旧的错误类型。原文件字节与时间轴不变，源数据库和字幕无需重建。通过当前代理读取 Demo 首集前 1.5 MB 实测约 28 秒，旧播放器会在 20 秒时打断仍有进展的加载；已改为进展感知的停滞计时。新增格式、快照及线上媒体类型校验脚本。本地 56 项网页测试、43 项 Python 测试、6 项生产页面/API 测试、类型检查、lint 和构建通过。修正后的云端分段检查与解码检查未获执行许可，尚未执行；浏览器自动化不可用，最终出声和进度条仍需实机验收。

## 音频发布流程

专用公开 Blob store：`podcast-demo-audio` / `store_ELsFDSRO8QRM3Ptd`，iad1，连接本项目 production 和 development，使用 OIDC 身份认证。15 期原音频共约 625 MiB，实际包含 10 个 MP3 和 5 个 M4A/AAC；本地缓存统一使用 `.mp3` 后缀，不代表真实格式。按用户指定的合法使用素材演示假设发布，保留原节目链接。

1. 本地登录 Vercel CLI，刷新该项目 development 环境的 OIDC 凭据（不输出 `.env.local`）。设置 `VERCEL_CLI` 为已安装 CLI 的绝对路径。
2. 运行以下命令；本机如需代理，使用上文环境变量。上传脚本先核对原文件 SHA-256，读取文件头识别真实容器，以 `.mp3` / `audio/mpeg` 或 `.m4a` / `audio/mp4` 发布，按带内容哈希的路径上传，逐个保存结果，重跑可跳过已完成项目。

```sh
BLOB_STORE_ID=store_ELsFDSRO8QRM3Ptd node --env-file=.env.local scripts/upload-audio.mjs
node scripts/verify-hosted-audio.mjs
npm run snapshot:export
npm run snapshot:verify
```

3. `data/hosted-audio.json` 记录 URL、哈希、字节数与真实媒体类型；`lib/audio-host.json` 固定允许的托管域名。验证脚本对每期文件开头和中间发 Range 请求，要求 HTTP 206、正确 Content-Range、与实际容器一致的 Content-Type 和与本地完全相同的字节；报告写入 `outputs/hosted-audio-verification.json`。
4. 导出快照会核对上传记录与源数据库音频哈希，保留原文件时间轴，将固定拼盘和全部章节的播放地址一起替换。没有官方地址回退。
5. 运行功能测试、构建与生产 HTTP 测试后重新部署。播放器连续 20 秒无加载进展才显示可重试错误；实际下载进展会重置停滞计时，但总加载上限为 120 秒。暂停、切片和销毁时清理计时器。

Hobby 的 Blob 存储和传输受免费额度限制，查看 [官方额度说明](https://vercel.com/docs/vercel-blob/usage-and-pricing)；音频传输流量随试听次数增长。

## 历史文件

`data/raw/legacy-demo-audio/` 保存以前导出的本地试听文件。旧 `data/demo-playlist.json` 作为固定选择的本地输入保留，但不进入客户端 bundle。导出快照时替换为 Blob 地址和原音频偏移。

原 Sites 站点及 `.openai/hosting.json` 仅保留为历史记录，不参与 Vercel 构建；本次不修改旧站点。
