# 文件结构与维护入口

更新：2026-10-03。网页采用 Next.js App Router；在线服务为 Node，本地数据处理为 Python。

## 目录地图

```text
podcast-content-search/
├── app/
│   ├── page.tsx                     # 首页需求对话
│   ├── demo/page.tsx                # 服务端读取快照的固定试听页
│   ├── api/needs/route.ts           # 需求理解 API
│   ├── api/playlists/route.ts       # 动态检索与拼盘 API
│   ├── api/demo/route.ts            # 固定拼盘 API
│   ├── layout.tsx                  # 页面外壳
│   └── globals.css                 # 界面样式
├── components/
│   ├── listening-experience.tsx     # 首页与结果、卡片、字幕、播放控件
│   └── needs-conversation.tsx       # 输入、追问、取消、重开、自动生成拼盘
├── lib/
│   ├── needs.ts                    # 需求结构、词表与原话依据校验
│   ├── playlist.ts                 # 拼盘响应校验
│   ├── player.ts                   # 片段和全集播放状态
│   ├── audio-source.ts             # 专用音频域名与路径校验
│   └── audio-host.json             # Blob 域名配置
├── server/
│   ├── needs.ts                    # 需求模型调用与错误处理
│   ├── retrieval.ts                # 在线向量召回、标签排序、章节组盘
│   ├── snapshot.ts                 # 只读 SQLite 数据访问
│   ├── http.ts                     # 同源、请求大小、实例并发控制
│   └── data/corpus.sqlite3          # 在线快照；同目录 JSON 记录哈希与统计
├── backend/
│   ├── corpus.py                   # 本地源库、来源与字幕入库
│   ├── content_index.py            # 章节单元、标注、向量与有效性校验
│   ├── search_content.py           # 离线检索、开发评估与算法参考
│   ├── playlist_service.py         # 独立本地参考服务；网页不调用
│   ├── common.py / paths.py        # 本地工具公共能力与路径
│   └── pipelines/
│       ├── export_web_snapshot.py  # 导出网页只读快照
│       ├── segment_topics.py       # 整期字幕主题分章
│       ├── transcribe_openai.py    # 云端转录工具
│       ├── transcribe_local.py     # 本地 Whisper 备选
│       ├── verify_local_audio.py   # 本地音频检查与试听样本
│       ├── audit_transcripts.py    # 字幕覆盖、时间与缺口检查
│       ├── build_audio_review.py   # 独立核听页
│       ├── export_demo_playlist.py # 固定选段 JSON 与离线试听文件
│       ├── prepare_expansion.py    # 历史选集批次工具
│       └── finalize_corpus.py      # 历史批次收尾工具
├── scripts/
│   ├── check-deployment.mjs        # 快照哈希、完整性与部署边界校验
│   ├── audio-format.mjs            # 识别原音频真实容器
│   ├── upload-audio.mjs            # 原音频发布到 Blob
│   ├── verify-hosted-audio.mjs      # 云端媒体类型与分段字节核验
│   ├── verify-public-demo.mjs      # 公网真实模型接口检查
│   └── evaluate_needs.mjs          # 真实需求模型验收
├── data/                           # 词表、清单、标注与处理报告
├── public/                         # favicon、分享图；不含媒体与数据库
├── tests/                          # Node、Python、生产 HTTP 测试
├── docs/                           # 当前架构、运行与维护说明
├── outputs/                        # 本地截图和联调报告，Git 忽略
├── next.config.ts                  # 服务端快照文件追踪
├── vercel.json                     # Vercel 构建与区域
├── .env.example                    # 服务端配置示例
└── package.json / package-lock.json # Node 依赖与命令
```

## 数据目录的用途

| 位置 | 用途 |
| --- | --- |
| `data/podcasts.sqlite3`、`data/raw/` | 本地源库、原音频、字幕、来源及模型响应缓存；不进入 Git |
| `data/content-taxonomy.json` | 内容侧和需求侧共用词表，在线代码直接使用 |
| `data/collection.json` | 已选 15 期素材清单 |
| `data/content-annotations*.json` | 标注导出和复查依据 |
| `data/demo-playlist-selection.json` | 固定 Demo 选段配置 |
| `data/demo-playlist.json` | 快照导出的本地输入；其中旧媒体路径在导出时被替换 |
| `data/hosted-audio.json` | 每期 Blob 地址、字节数、SHA-256 和真实媒体类型 |
| `server/data/corpus.sqlite3`、`corpus.json` | 网页运行所需的快照及校验清单，必须一起发布 |

## 修改功能时从哪里开始

| 修改目标 | 入口 |
| --- | --- |
| 页面与交互 | `app/`、`components/` |
| 播放边界、重试、全集返回 | `lib/player.ts` |
| 需求结构与提示词 | `lib/needs.ts`、`server/needs.ts` |
| 在线召回、排序、拼盘规则 | `server/retrieval.ts` |
| API 请求限制 | `server/http.ts`、`app/api/` |
| 内容标注与向量维护 | `data/content-taxonomy.json`、`backend/content_index.py` |
| 源素材或主题分章 | `backend/corpus.py`、`backend/pipelines/` |
| 更新固定选段 | `data/demo-playlist-selection.json`，再导出选段与网页快照 |
| 更新音频地址 | 音频上传清单、快照导出与 `lib/audio-host.json` |

修改在线检索算法时，应同步检查 Python 参考实现与 `tests/fixtures/retrieval-parity.json` 的一致性；不要仅修改离线脚本就认为线上行为已改变。

## 命令边界

| 命令 | 实际行为 |
| --- | --- |
| `npm run dev` | 仅启动 Next.js 开发服务，默认 127.0.0.1:3000 |
| `npm run build` | 校验快照并构建 Next.js |
| `npm start` | 启动已有 Next.js 生产构建 |
| `npm run test:web` | Node 网页与检索单元测试，不含构建或生产 HTTP 测试 |
| `npm run test:production` | 使用已有构建，启动生产服务并运行 HTTP 检查 |
| `npm test` | 先 Python 测试，再 Node 测试；需要本地数据环境 |
| `npm run snapshot:export` | 使用 `.venv`、源库和音频缓存导出网页快照 |
| `npm run snapshot:verify` | 只校验快照及部署边界，不调用模型 |
| `npm run demo:prepare` | 使用系统命令 `python3` 导出固定选段与离线试听媒体；仍需重新导出快照 |
| `npm run corpus:serve` | 单独启动 Python 参考服务；不是网页启动步骤 |

`PODCAST_OFFLINE` 不控制 Next.js 在线检索；它属于 Python 参考工具。当前网页没有需求 JSON 导出／恢复界面，`lib/needs.ts` 中相关辅助函数仅保留供兼容和测试。

文件清理边界见 [维护说明](cleanup-plan.md)，完整验证命令见 [测试与验收](testing.md)。
