# 声签 · 调到你的频率

世界很吵。听点与你有关的。

通过简短对话理解此刻的困惑，从真实中文播客中检索完整主题章节，组合成 3–5 段、10–30 分钟的声音拼盘。可以暂停、跳播、切换倍速，或从片段进入完整节目。

## 当前版本

- 深夜电台界面：黑胶、深色排版，支持手机屏幕。
- 需求理解：多轮对话 → 共用标签体系的结构化需求。
- 推荐：查询向量 → 余弦召回 → 标签规则排序 → 完整章节组合；素材不足时明确提示。
- 在线运行：Next.js / Node.js 24，部署目标为 Vercel。
- 数据：服务端 SQLite **只读快照**；15 期、185 章、165 个已有向量，其中 164 章可独立参与检索。
- 播放：将已下载的原始 MP3 托管在专用 Vercel Blob，浏览器使用章节起止时间控制片段、全集和连续播放。
- 本地 Python：继续负责采集、转录、分章、标注、向量化和发布快照导出。

公开 demo：https://podcast-content-search.vercel.app 。首页无需登录；真实需求对话、查询向量检索、拼盘生成和固定试听接口已通过匿名公网验收。音频已改为自行托管本地原文件；浏览器实际音频播放和手机端交互仍需人工试听确认。

## 本地运行

需要 Node.js 24。网页本身不需要启动 Python，也不需要本地音频缓存。

```sh
npm ci
npm run dev
```

在 `.env.local` 配置 `OPENAI_API_KEY`，供服务端需求对话和新查询向量使用。已有播客向量直接从快照读取。固定示例不需要 API key，但音频播放需要联网。不要将密钥放进 `NEXT_PUBLIC_` 变量或提交到 Git。

## 素材更新

已有素材源保存在忽略版本管理的 `data/podcasts.sqlite3` 与 `data/raw/`。本地准备 Python 3.11、`.venv`、`requirements-retrieval.txt` 和 ffprobe 后，按 [音频发布流程](docs/vercel-deployment.md#音频发布流程) 上传原文件并核验，再导出：

```sh
npm run snapshot:export
npm run snapshot:verify
```

导出复用已有标签与向量，不调用模型、不改写源数据库。更新 `server/data/corpus.sqlite3` 和对应清单后重新部署。快照位于服务端目录，不向浏览器公开下载。

## 验证

```sh
npm run test:web
npm run typecheck
npm run lint
npm run build
npm run test:production
npm run test:python
```

`test:production` 运行真实 Next.js 生产服务，但模型响应使用测试替身；真实模型联调需另行验收。Python 测试仍需本地原始语料和缓存。13 个既有查询用于核对 Node/Python 检索与拼盘结果一致性。

## 文件结构

```text
app/                   页面、布局、API 路由
  api/needs/           需求理解接口
  api/playlists/       在线检索与拼盘接口
  api/demo/            无模型调用的固定试听
components/            对话、拼盘、播放器界面
lib/                   共用需求类型、播放器状态、响应校验
server/                服务端模型调用、检索、只读数据库读取
  data/                可随部署发布的 SQLite 快照与哈希清单
backend/               本地 Python 素材库与原检索参考实现
  pipelines/           转录、分章、导出等离线任务
data/                  标签词表、素材清单和离线处理产物
scripts/               发布检查、真实模型评估
tests/                 单元、算法对照与生产 HTTP 集成测试
public/                favicon、分享图片（无原音频、数据库或密钥）
docs/                  架构、素材处理和部署说明
```

## 文档

- [Vercel 部署与运行架构](docs/vercel-deployment.md)：当前线上路径、环境变量、快照更新和验收。
- [素材库](docs/real-corpus.md)：15 期来源、字幕和处理情况。
- [主题切分](docs/topic-segmentation.md)、[内容检索](docs/content-retrieval.md)、[需求理解](docs/needs-conversation.md)。
- [产品架构](docs/product-architecture.md)、[文件结构](docs/project-structure.md)：包含本地原型阶段记录，线上部署以 Vercel 文档为准。

## 素材边界

15 期来自科技乱炖、编码人声、津津乐道、世界还有办法。字幕与内容标签仍有待人工核听校验；小规模开发测试不代表推荐准确率。本 demo 按可合法使用素材的演示假设托管原音频，并保留节目来源链接；这不构成对素材授权状态的核实。MP3 独立上传至 Blob；原音频、转录 API 缓存和密钥不进入 Git 或网页部署包。
