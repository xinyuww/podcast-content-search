# 真实中文播客素材集

更新：2026-10-03。当前 15 期素材已用于[公开 Demo](https://podcast-content-search.vercel.app)。网页运行使用只读 SQLite 快照与 Vercel Blob 原音频，本地源库用于素材维护。

## 已完成

已导入 4 档节目共 15 期中文播客，约 16.86 小时，
包含 140 个发布方章节和 4,157 条字幕 cue；源库另保留 431 个早期字幕窗口，当前推荐不使用这些窗口。
另有 4 期《编码人声》的 45 个模型生成并经文本复查的主题章节（36 个主体内容），保存在独立 `topic_chapters` 表；处理过程和核听限制见 [主题分段](topic-segmentation.md)。
11 期复用发布方 VTT，4 期通过 `gpt-4o-transcribe-diarize` 转录，共新增 1,582 条字幕。
本地数据库：`data/podcasts.sqlite3`。清单：`data/collection.json`。
准确数量与单集详情见 `data/import-report.json`。

选择这批内容是为了验证真实数据管线，不是把产品主题永久限定在科技。
覆盖 AI 焦虑、编程辅助、产品开发、业务落地、一人公司的销售。
4 档节目同属一个播客网络；不能据此宣称已覆盖中文播客全平台。

## 来源与使用范围

- 官方节目页：[科技乱炖](https://dao.fm/show/ld)
- 官方 RSS：[科技乱炖 RSS](https://feeds.daopub.com/ld.xml)
- 来源使用说明：[发布方说明](https://dao.fm/copyright)；采集记录核查日期为 2026-09-30，不代表本演示取得了单独授权。
- 新增 10 期统一在小宇宙选集，再匹配公开 RSS；选集记录见 `data/selection-tech-work-10.json`。
- 每集音频 URL 均来自 RSS；11 期字幕及 140 个章节也来自 RSS，另 4 期字幕由原音频转录。没有从节目简介生成伪转录。
- RSS 提供下载入口不等于开放数据许可；本演示按可合法使用素材的假设托管音频，并保留来源。
- 15 期原音频缓存在 `data/raw/audio/`，共 654,889,539 字节（约 625 MiB），已发布到专用 Vercel Blob。线上播放使用托管地址；官方 URL 用于来源追溯。
- 原始字幕缓存、源数据库与原音频文件被 Git 忽略；派生的 `server/data/corpus.sqlite3` 随代码提交，包含网页所需的字幕、章节、标签和向量。仓库不是仅含空结构的数据库模板。
- 本项目的演示假设不构成素材授权核实；复制代码也不意味着自动取得素材再分发授权。

## 数据结构与真实性

`podcasts → episodes → chapters / transcript_cues / transcript_segments`。
`source_assets` 保存原始来源 URL、文件路径、SHA-256、字节数与入库时间。

VTT 保留原文件和 cue 原始 payload；提取文本仅移除字幕格式标签并解码 HTML 实体。
说话人是来源中的编号标签，不擅自认定为具体嘉宾。
窗口按章节和字幕边界组合，目标不超过 180 秒，不人工编造时间戳。
一段开头字幕没有落在官方章节范围内，保留为未归属章节，不丢弃。
后续章节标注已区分主体、片头、片尾和赞助等内容，并排除明确依赖上下文的独立推荐；尚未全量人工核听。

已经验证：字幕与章节时间在单集时长范围内，外键和数据库完整性正常，
每条 cue 恰好归入一个窗口，窗口文字和时间可回溯到原始 cue。
2026-09-30 已验证：15 个本地音频全文件解码通过，时长与 RSS 相差不足 1 秒。每期按字幕起止时间提取前、中、后三处原声窗口，共 45 段，输出时长检查通过。原音频路径、SHA-256 与文件大小已写入 `source_assets`，kind 为 `audio`。
报告：`data/local-audio-report.json`；试听片段：`data/raw/auditions/`。这些片段剪自原音频，不是语音合成。核听页面：`data/raw/review/index.html`。
主产品已接入固定 Demo 与动态检索，统一从 Blob 播放原单集。公开版声音已获人工试听确认，见[固定拼盘演示](functional-demo.md)和[测试与验收](testing.md)。历史脚本报告中的 `browser_playback=not_verified` 保留脚本执行当时的状态，不用于否认后续试听，也不改写成全量通过。

185 个统一章节已完成标注，其中 165 个有向量、164 个满足独立推荐条件。线上检索由 `server/retrieval.ts` 执行；`backend/search_content.py` 是离线参考，旧 `backend.corpus search` 仍是关键词子串匹配。已有小规模开发场景对照，尚未完成独立推荐质量评估、全量转录准确率核验和逐句听感对齐。详见[内容检索](content-retrieval.md)。

## 本地维护

运行网页只需按 [README](../README.md#本地运行) 安装 Node 依赖。以下命令针对已经具备源数据库、字幕和音频缓存的本地素材环境，不是网页启动步骤。

```sh
python3 -m backend.corpus check
python3 -m backend.corpus search 焦虑
python3 -m backend.pipelines.audit_transcripts
python3 -m backend.pipelines.build_audio_review
python3 -m http.server 8765 --bind 127.0.0.1 --directory data/raw
```

核听页在 [http://127.0.0.1:8765/review/](http://127.0.0.1:8765/review/)，仅用于本地素材检查。重复检查原音频并生成试听片段可运行 `python3 -m backend.pipelines.verify_local_audio`，需要 ffmpeg / ffprobe。

不要为启动网页重建源库。`backend.corpus build` 会替换所选单集的派生记录，并级联清除关联章节索引；真正重建后须依次恢复主题章节、标注、向量，再导出网页快照。恢复步骤见[内容索引维护](content-retrieval.md#本地索引维护与恢复)。导出与音频发布见[部署文档](vercel-deployment.md)。

## 4 期云端转录（已完成）

`data/collection-15.pending.json` 是此次采集的工作清单，已经完成并同步为正式 `data/collection.json`。
原有 5 期加新增 10 期的音频均已下载，并通过完整解码与 RSS 时长比对。
15 期来自科技乱炖、编码人声、津津乐道、世界还有办法，共 4 档，同属一个播客网络。
其中 11 期已有发布方 VTT；以下编码人声节目的机器转录已完成：

- “卷”出来的那些 10 倍开发者（3558 秒）
- 让我们心平气和地聊聊代码与产品（3440 秒）
- 面向AI的新编程范式（3297 秒）
- 从一个播客的诞生，看开源精神的内核（3922 秒）

合计 236.95 分钟。当前采用用户选择的 `gpt-4o-transcribe-diarize`，最多 4 路 API 并发。
API 密钥保存在忽略 Git 的 `.env.local`，不写入日志。输出带起止时间的 VTT 与含模型、
原音频校验和及处理记录的 `.asr.json`。`backend/pipelines/transcribe_local.py` 保留为历史备选；公共函数已抽到 `backend/common.py`；不属于日常演示运行步骤。当前清单已经没有 `local_asr` 项，直接使用其旧 `--benchmark` 流程可能因没有待处理单集而报错。重新采用本地转录前应先调整输入筛选，不能直接照旧命令重跑已完成素材。

### 已完成的云端流程（历史 / 维护参考）

当前 15 期已完成，不需要为启动 Demo 执行下列步骤。特别是 `--prepare` 会更新状态报告，`--run` / `--benchmark` 可能上传音频并计费。日常只需启动 Next.js；修改固定选段后运行 `npm run demo:prepare`，再运行 `npm run snapshot:export` 与 `npm run snapshot:verify`。

`data/openai-asr-report.json` 记录实时进度；只有 `status=transcribed` 且 `complete=true`
表示 4 期所有请求均已返回并生成字幕；本次为 25/25 段。各段响应独立保存，中断重跑时复用。

```sh
# 无网络、无付费调用；准备约 10 分钟的单声道上传文件，优先在静音处分段。
python3 -m backend.pipelines.transcribe_openai --prepare

# 在忽略 Git 的 .env.local 中填写 OPENAI_API_KEY 后运行；此命令会上传音频并计费。
python3 -m backend.pipelines.transcribe_openai --run --workers 4

# 完整校验后入库、备份原库、生成原声试听与核听页。
python3 -m backend.pipelines.finalize_corpus
```

脚本只向 `https://api.openai.com/v1/audio/transcriptions` 发送请求，不打印密钥。
每段原始响应、请求参数、音频校验和保存在 `data/raw/openai-asr/`；中断后重跑会复用
已经成功保存的响应。网络超时等不确定错误不会自动重试；保留成功请求后再检查断点重跑。
每期完整结果输出为 `data/raw/<episode-id>.vtt` 和 `.asr.json`。
时间戳加回上传段的起始偏移；不同请求的说话人编号使用不同前缀，不能当作整期稳定的身份。
接口有时返回零时长的重复词或“嗯”“对”等短应答；不为它们编造时长。
无法单独播放的这类条目保留在原始响应及 `.asr.json` 的 `normalization_notes` 中供核听，
不作为独立可播放字幕。紧邻同一说话人的零时长词可以用原有边界并入前一条；其他
不超过 12 字的零时长短片语保留为未索引的待核验条目，报告中给出原音频位置。
更长的零时长内容、负数、时间倒序或超出音频范围仍会阻止导入。
后续请求采用流式接收，只有收到完整结束事件才保存为可复用的完成响应。
运行状态见 `data/openai-asr-report.json`，`prepared` 仅表示音频已准备，不表示已转录。

自动检查段落时间是否有限、合法、处于音频范围内，以及字幕/原音频与来源校验和是否一致。
这些检查不等于听音核验。15 期已入库，但 `audio_alignment_status` 和片段审核状态仍明确标记待核听。
本次有 17 条时间戳规范化记录；其中 4 个零时长短片语（“还”“干什么”“都”“而”）
保留为未索引的待核验条目。详见 `data/transcript-audit.json` 和对应 `.asr.json`，不为它们编造播放区间。
原 5 期数据库和清单备份在 `data/raw/backups/`。

## 后续扩充

本阶段固定 15 期，不执行扩充。新增素材仍沿用“小宇宙选集 → 检查公开 RSS → 下载原音频 → 复用字幕或转录 → 分章、标注与向量化 → 核验与导出”的本地流程。当前四档节目同属一个网络，增加数量前应关注领域与帮助类型的覆盖，而非只追求集数。
