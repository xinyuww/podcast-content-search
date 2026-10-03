> 2026-10-01 部署迁移：当前网页与在线 API 使用 Next.js / Vercel，检索读取 `server/data/corpus.sqlite3` 只读快照，播放直接使用官方音频。本文包含旧本地服务的历史说明；当前运行方式见 [Vercel 部署](vercel-deployment.md)。

# 文件结构与维护入口

更新日期：2026-10-01。项目按页面、组件、共享逻辑、服务端、数据与测试分层，保持一个仓库管理。前端由 vinext / Vite 构建；Python 后端是可用 `python -m` 运行的包。

## 目录地图

```text
podcast-content-search/
├── app/                              # 框架页面入口
│   ├── page.tsx                      # 首页入口，装配 ListeningExperience
│   ├── layout.tsx                    # 页面外壳与 metadata
│   └── globals.css                   # 全局与产品样式
├── components/                       # React 用户界面及交互
│   ├── listening-experience.tsx       # 视图切换、拼盘卡片、字幕与播放器控件
│   └── needs-conversation.tsx         # 对话、需求确认、导出/恢复与生成拼盘
├── lib/                              # TypeScript 类型、校验和独立业务逻辑
│   ├── needs.ts                      # 需求契约、共享词表、原话证据校验
│   ├── playlist.ts                   # 拼盘契约与返回值校验
│   └── player.ts                     # 播放状态、进度、片段边界与全集切换
├── server/                           # Web 服务端适配层（TypeScript）
│   ├── needs.ts                      # 需求对话 API、模型提示词与错误处理
│   └── corpus.ts                     # 本地检索/音频服务的 HTTP 桥接
├── worker/index.ts                   # 框架运行入口、API 和页面路由分流
├── backend/                          # Python 素材库与检索后端
│   ├── __init__.py
│   ├── paths.py                      # 项目根路径；各模块统一引用
│   ├── common.py                     # 共享文件读写、时间戳、API 与音频辅助函数
│   ├── corpus.py                     # SQLite 源表建表、入库、检查与关键词查询
│   ├── content_index.py              # 内容单元、标签、向量与索引读写/有效性检查
│   ├── search_content.py             # 向量召回、标签排序、命令行检索与评测
│   ├── playlist_service.py           # 拼盘 API、章节组合、原音频 Range 服务
│   └── pipelines/                    # 手动执行的离线素材处理
│       ├── __init__.py
│       ├── segment_topics.py         # 整期字幕主题分段
│       ├── transcribe_openai.py       # 云端转录与断点恢复
│       ├── transcribe_local.py        # 本地 Whisper 备选
│       ├── verify_local_audio.py      # 音频核验与试听样本
│       ├── audit_transcripts.py       # 字幕范围、覆盖与缺口检查
│       ├── build_audio_review.py      # 核听页面生成
│       ├── export_demo_playlist.py    # 固定示例 JSON 与试听音频导出
│       ├── prepare_expansion.py       # 历史 5→15 期选集准备
│       └── finalize_corpus.py         # 历史扩充入库收尾
├── scripts/                          # 开发启动与验收入口
│   ├── dev.mjs                       # 同时启动 Python 和网页，管理进程退出
│   └── evaluate_needs.mjs             # 真实模型对话评测（会调用 API）
├── data/                             # 数据、清单、词表、评测与处理报告
│   ├── podcasts.sqlite3              # 本地正式数据库，Git 忽略
│   ├── collection.json               # 15 期素材清单
│   ├── content-taxonomy.json         # 内容侧/需求侧共用标签定义
│   ├── demo-playlist-selection.json  # 固定示例的人工作品选段
│   ├── demo-playlist.json            # 导出的固定示例，前端直接读取
│   ├── topic-chapters/               # 模型主题章节、复查与修订记录
│   ├── content-annotations*.json     # 标注导出及抽查修订
│   ├── *-cases.json                  # 检索、需求对话评测场景
│   ├── *-report.json / *-evaluation.* # 处理统计与评测快照
│   └── raw/                          # 原音频、字幕、RSS、模型响应与来源记录
├── public/                           # 浏览器静态资源
│   ├── demo-audio/                    # 固定示例音频，Git 忽略
│   ├── favicon.svg
│   └── og.png
├── tests/                            # JS/TS、Python、构建后 SSR 回归测试
├── docs/                             # 架构、数据来源、功能及处理流程说明
├── outputs/                          # 本地截图和联调结果，Git 忽略
├── README.md                         # 新读者入口、启动及文档导航
├── package.json / package-lock.json  # Node 依赖与统一命令
├── requirements-retrieval.txt        # Python 检索依赖
├── requirements-asr.txt              # 可选的本地 Whisper 依赖
├── .env.example                      # 配置示例；真实密钥在忽略的 .env.local
├── vite.config.ts                    # 构建与开发代理
├── tsconfig.json / eslint.config.mjs # 类型与代码检查
└── 其他框架配置与生成类型             # Next 兼容、PostCSS、Worker 等
```

`node_modules/`、`.venv/` 是本地依赖，`dist/`、`.next/`、`.vinext/`、`.wrangler/` 和 `*.tsbuildinfo` 是构建或运行产物，不是业务模块。`data/raw/` 含不可随意删除的源素材和已付费转录结果，不能当作普通缓存清空。

## 职责与依赖边界

- `app/` 保持薄入口；页面交互放在 `components/`，播放控制器放在 `lib/`。
- `components/` 通过 HTTP 使用 API，不直接读取 SQLite 或引入服务端模块。
- `server/` 负责需求模型调用与 Web 适配；`backend/` 负责检索、组盘、音频和素材库处理。两者是当前两个运行环境，不是两套重复后端。
- Python 在线服务复用索引读取与检索函数，不导入 `pipelines/`。离线流水线可以复用 `corpus.py`、`common.py` 和 `paths.py`。
- `content_index.py` 同时提供索引读写与命令行维护入口；写操作只由显式维护命令触发，在线服务只读 SQLite。
- 源数据表结构在 `backend/corpus.py`，主题章节表在 `backend/pipelines/segment_topics.py`，派生索引表在 `backend/content_index.py`。目前沿用已有建表逻辑，尚未引入数据库版本迁移框架。
- `data/` 保持现有素材相对路径和处理来源记录。历史批次文件有复现价值，放在流水线目录并标明用途，不在启动时自动执行。

## 修改功能时从哪里开始

| 修改目标 | 入口 |
| --- | --- |
| 页面外壳、路由、全局样式 | `app/` |
| 对话交互、拼盘展示 | `components/` |
| 播放、片段边界、返回全集 | `lib/player.ts` |
| 需求结构与提示词 | `lib/needs.ts`、`server/needs.ts` |
| 召回门槛、标签权重 | `backend/search_content.py` |
| 拼盘数量、时长与媒体访问 | `backend/playlist_service.py` |
| SQLite 原始数据结构 | `backend/corpus.py` |
| 内容标签与向量维护 | `data/content-taxonomy.json`、`backend/content_index.py` |
| 扩充素材、转录、分段、核验 | `backend/pipelines/` |
| 替换固定示例 | `data/demo-playlist-selection.json`，再运行 `npm run demo:prepare` |

## 常用命令

从项目根目录运行，Python 使用已安装依赖的 `.venv`：

```bash
npm run dev                  # 网页 + 本地检索/媒体服务
npm run build                # 生产构建
npm start                    # 启动构建后的本地服务
npm run corpus:serve         # 单独启动 Python 服务
npm run demo:prepare         # 从已有素材重新导出固定示例，不调用 API

npm test                     # Python + JS/TS + 构建 + SSR
npm run test:python          # Python 回归
npm run test:web             # JS/TS、构建与 SSR
npm run typecheck
npm run lint

.venv/bin/python -m backend.corpus check
.venv/bin/python -m backend.search_content --help
.venv/bin/python -m backend.content_index --help
.venv/bin/python -m backend.pipelines.segment_topics --help
```

Python 命令统一使用 `-m backend.…`；旧的 `python scripts/xxx.py` 路径已迁移。`npm run dev`、`npm run demo:prepare` 等产品常用命令保持不变。导出和素材集成测试需要已有 SQLite 与本地音频，单独克隆代码不包含这些文件。

`PODCAST_OFFLINE=1 npm run dev` 只禁止检索生成新的查询向量；需求对话仍需要网络。结构调整的回归检查不代表真实 OpenAI 对话已经验收，在线模型测试仍暂停。

## 本轮整理验证

43 项 Python 与 34 项 Web/SSR 测试通过，生产构建、TypeScript、ESLint 和文档链接检查通过。新入口启动后：首页 HTTP 200；缓存查询返回 4 段、约 20 分 36 秒的拼盘；原音频 Range 请求返回 HTTP 206 和所请求的 1024 字节。数据库、正式清单、词表和固定示例 JSON 的 SHA-256 与迁移前一致。未重新转录、向量化或调用真实模型。
