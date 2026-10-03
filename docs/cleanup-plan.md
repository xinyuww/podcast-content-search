# 清理记录与后续建议

更新：2026-09-30。用户指定的首轮清理已执行，采用删除方式，没有另建归档副本。正式语料、数据库、当前演示音频和转录产物均保留。

## 1. 本轮已完成

| 范围 | 删除 / 修改内容 |
| --- | --- |
| 未使用登录模板 | 删除 `app/chatgpt-auth.ts` |
| 模板图标 | 删除 `public/file.svg`、`globe.svg`、`window.svg`；保留 favicon 和分享图 |
| 旧样式 | 清理 67 条无引用选择器及 pulse 动画，包括旧 dock、mini-player、侧栏、加载卡片、旧说明区和响应式变体；保留的 130 条选择器规则声明、顺序与媒体条件已逐条核对 |
| 旧试听文件 | 删除 `data/raw/real-playback-test.mp3` 及 `auditions/` 中 5 个无 early/middle/late 后缀的旧样本；保留核听页引用的 45 段 |
| D1 / Drizzle | 删除 `db/`、`drizzle/`、`drizzle.config.ts`、`examples/d1/`；移除 `db:generate`、`drizzle-orm`、`drizzle-kit` 并更新依赖锁文件 |
| DB 绑定残留 | 删除 `worker/env.d.ts` 和 Worker 的 DB 字段；移除 Vite 的 D1 占位 ID 与绑定配置 |
| Supabase 草案 | 删除 `supabase/schema.sql` 和 `.env.example` 的 3 个 Supabase 变量 |
| 文档 | 同步 README、实际架构、目录地图与本清理记录 |

不删除当前使用的 Worker 入口、Cloudflare 插件或通用运行时类型。`.openai/hosting.json` 的空 D1 字段作为插件配置元数据保留，不再由 Vite 配置读取；R2 仍未启用。

5 个已删除旧样本的 episode ID：`d30b8af1-3db1-4564-83d3-11b71ce1c038`、`0c8bc813-9648-4d3b-86f9-5a456bb5f6ea`、`850f68e6-869e-474f-b149-30443e5f5426`、`184d0cf9-ee51-43de-bb42-9bb5343fc3ed`、`7352287d-abdf-49aa-9e27-89ad99bb4cab`。只删除了 `data/raw/auditions/` 下这些名称的 `.mp3`；`data/raw/audio/` 下的原音频全部保留。

## 2. 尚未执行：需要先处理依赖的部分

### Whisper 备用实现

`backend/pipelines/transcribe_local.py` 保留为显式运行的备选工具。2026-10-01 已将公共文件写入、时间戳等函数抽到 `backend/common.py`，在线服务和云端转录不再依赖 Whisper 脚本。重型模型库仅在本地转录函数内加载。

### 重复工作清单和批次脚本

`data/collection-15.pending.json` 与正式 `data/collection.json` 当前内容完全相同，但以下代码仍依赖它：

- `transcribe_openai.py` 与 `transcribe_local.py` 的默认 `--manifest`；
- `finalize_corpus.py` 的固定输入；
- `prepare_expansion.py` 的输出。

建议将批次收尾脚本和工作清单共同归档，或先将可复用脚本的默认输入改为正式清单，再去掉重复文件。`prepare_expansion.py`、`finalize_corpus.py` 硬编码本批次数量与来源，不适合作为下一批素材的通用入口直接重跑。

`data/selection-tech-work-10.json` 虽不参与网页运行，仍是来源依据；应保留或归档，不作为无用临时文件删除。

## 3. 可重建的缓存与产物

| 目录 / 文件 | 能否清理 | 对当前功能的影响 / 恢复方式 |
| --- | --- | --- |
| `dist/` | 可以，确认未运行依赖该目录的生产预览 | 运行 `npm run build` 恢复；含音频副本，当前约 192 MiB |
| `.next/`、`.vinext/`、`*.tsbuildinfo`、`__pycache__/` | 可重建 | 开发 / 构建 / 类型检查重新生成；运行中不做整批删除 |
| `.wrangler/` | 部分可清理 | 本地日志和状态；先停止相关服务，未来配置本地绑定后不可再把它一律当废缓存 |
| `node_modules/` | 可重装，但不建议为目录整洁删除 | 删除后前端不能运行；`npm install` 恢复 |
| `public/demo-audio/` | 可重建，演示期间应保留 | 删除立即导致播放失败；用完整 SQLite 和原音频运行 `npm run demo:prepare` 恢复 |
| `data/demo-playlist.json` | 可重新导出，但不是无用文件 | 当前页面直接导入；缺失会导致构建失败 |
| `data/raw/auditions/` 当前 45 段及 `review/` | 可重建，核听阶段建议保留 | 分别通过音频检查和核听页生成脚本恢复；不属于产品播放列表 |
| `data/openai-asr-benchmark.json`、`data/raw/asr-benchmark.json` | 可归档或清理 | 历史测速，不影响已完成字幕或播放 |

`public/demo-audio/` 的文件逻辑总大小约 196 MB，其中部分全集与原音频是硬链接。它与 `data/raw/audio/` 的大小不能简单相加计算可释放空间；删除一个硬链接也不代表原音频已丢失或对应空间已释放。

## 4. 当前应明确保留

- **正式清单、SQLite、15 个原音频、源字幕、章节文件及 `.asr.json`**：演示与可追溯数据基础。SQLite 虽可重建，也不是建议删除的缓存。
- **`data/raw/openai-asr/` 中已成功的响应、计划和来源记录**：已付费转录产物及断点依据。上传用音频分块通常可重新生成，但不要连同响应整目录删除，以免丢失证据或重复转录。
- **来源快照、选集记录、原库备份、完成报告**：历史证据。报告不应在未重跑对应检查的情况下手改成“通过”。
- **`vite.config.ts`、`worker/`、`.openai/hosting.json`、`worker-runtime.d.ts`**：当前构建 / 运行 / 类型链路。停用云数据库不代表这些文件都不需要。
- **`postcss.config.mjs` 与 Tailwind 依赖**：`globals.css` 仍有 `@import "tailwindcss"`。若要换成纯 CSS，先去掉相关导入、插件，再修改依赖。
- **`next-env.d.ts`**：引用 vinext 和生成路由类型；不能按名字判断为“多余 Next 文件”。`next.config.ts` 虽为空，也应在构建回归时作为兼容配置精简，而非与运行入口一起清空。
- **播放器与数据测试**：验证的两条链路不同，不是重复测试。主 Demo、离线数据处理、独立核听页也不是同一功能的三份实现。

## 5. 剩余可选工作（不属于本轮删除范围）

1. Python 公共函数已抽取；Whisper 备选与历史批次脚本已归入 `backend/pipelines/`，是否进一步归档取决于后续素材扩充方式。
2. 仅在需要释放空间时清理可重建产物；保留源素材、已付费转录响应和可追溯信息。

代码清理后运行前端测试 / 构建、TypeScript、lint 与 Python 测试；再检查本地音频访问。只清理文档不需要重跑转录或重建整个素材库。

本轮发现的额外维护点：`transcribe_local.py --benchmark` 只筛选 `local_asr` 单集，而当前清单已全部转为发布方字幕或 `openai_asr`，直接运行可能遇到空列表；`transcribe_openai.py --prepare` 会重写转录状态报告。二者都不应出现在日常 Demo 启动流程中，后续通用化时再修正。

## 6. 本轮验证结果

- 13 项播放器 / 素材断言、1 项首页 SSR 测试与生产构建通过。
- TypeScript、ESLint 和 15 项 Python 数据处理测试通过。
- 数据库只读完整性检查通过，仍为 15 期；225 个保留数据 / 媒体文件的大小和修改时间与清理前一致。
- 保留 CSS 的声明、顺序与媒体条件一致；没有改动当前页面交互或播放控制器。
- 依赖卸载后重启了开发服务以清除旧路径缓存，首页返回 HTTP 200；本地片段的 Range 请求返回 HTTP 206。
- 文档本地链接检查通过。没有重跑转录、提交 Git 或部署。
