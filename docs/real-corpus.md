# 真实中文播客素材集

更新：2026-10-01。当前目标为本地研究与演示；尚未公开发布。

## 已完成

已导入 4 档节目共 15 期中文播客，约 16.86 小时，
包含 140 个官方章节、4,157 条字幕 cue、431 个按原字幕边界组成的检索窗口。
另有 4 期《编码人声》的 45 个模型生成并经文本复查的主题章节（36 个主体内容），保存在独立 `topic_chapters` 表；处理过程和核听限制见 [主题分段](topic-segmentation.md)。
11 期复用发布方 VTT，4 期通过 `gpt-4o-transcribe-diarize` 转录，共新增 1,582 条字幕。
本地数据库：`data/podcasts.sqlite3`。清单：`data/collection.json`。
准确数量与单集详情见 `data/import-report.json`。

选择这批内容是为了验证真实数据管线，不是把产品主题永久限定在科技。
覆盖 AI 焦虑、编程辅助、产品开发、业务落地、一人公司的销售。
4 档节目同属一个播客网络；不能据此宣称已覆盖中文播客全平台。

## 来源与使用范围

- 官方节目页：https://dao.fm/show/ld
- 官方 RSS：https://feeds.daopub.com/ld.xml
- 使用条件：https://dao.fm/copyright（核查于 2026-09-30）
- 新增 10 期统一在小宇宙选集，再匹配公开 RSS；选集记录见 `data/selection-tech-work-10.json`。
- 每集音频 URL 均来自 RSS；11 期字幕及 140 个章节也来自 RSS，另 4 期字幕由原音频转录。没有从节目简介生成伪转录。
- 官方声明第三条允许第三方通过 RSS/API 引用、展示、播放；这不等于开放数据许可。
- 15 期音频均完整下载至 `data/raw/audio/`，共 654,889,539 字节（约 655 MB），仅供本地演示；保留官方 URL。没有公开托管。
- 原始字幕缓存和数据库仅存本地，已加入 Git 忽略；不作为开源数据集上传。
- 后续若公开展示转录摘录、改编摘要或重新编排音频，需要结合具体呈现核实对应使用范围。

## 数据结构与真实性

`podcasts → episodes → chapters / transcript_cues / transcript_segments`。
`source_assets` 保存原始来源 URL、文件路径、SHA-256、字节数与入库时间。

VTT 保留原文件和 cue 原始 payload；提取文本仅移除字幕格式标签并解码 HTML 实体。
说话人是来源中的编号标签，不擅自认定为具体嘉宾。
窗口按章节和字幕边界组合，目标不超过 180 秒，不人工编造时间戳。
一段开头字幕没有落在官方章节范围内，保留为未归属章节，不丢弃。
短窗口、片头、片尾、赞助和上下文不完整片段尚未人工筛选。

已经验证：字幕与章节时间在单集时长范围内，外键和数据库完整性正常，
每条 cue 恰好归入一个窗口，窗口文字和时间可回溯到原始 cue。
2026-09-30 已验证：15 个本地音频全文件解码通过，时长与 RSS 相差不足 1 秒。每期按字幕起止时间提取前、中、后三处原声窗口，共 45 段，输出时长检查通过。原音频路径、SHA-256 与文件大小已写入 `source_assets`，kind 为 `audio`。
报告：`data/local-audio-report.json`；试听片段：`data/raw/auditions/`。这些片段剪自原音频，不是语音合成。核听页面：`data/raw/review/index.html`。
主产品网页已接入其中 4 期的固定章节及本地全集，主要播放流程已在浏览器验证，见 [固定拼盘演示](functional-demo.md)。这些 UI 验证发生在音频处理报告之后，报告中的 `browser_playback=not_verified` 仍保留该脚本运行时的状态。
尚未完成：全部素材逐句听感对齐、转录准确率核验、语义检索质量评估。时长和解码通过不代表已经核听确认逐句对齐。
2026-10-01 已完成 185 个统一章节标注及 165 个章节向量，默认 164 个独立检索候选。`search_content.py` 提供向量召回与标签规则排序，旧 `corpus.py search` 仍是关键词子串匹配。主网页继续使用固定真实拼盘，尚未接入新检索。处理与评测见 [内容检索](content-retrieval.md)。

## 本地使用

对已经生成的本地素材进行重建、检查和关键词搜索，只需 Python 3 标准库，无 API 密钥。
下载配置仅包含发布方已有字幕/章节；4 期机器字幕需要先生成或使用本地缓存。

```sh
python3 -m backend.corpus download-config > /private/tmp/podcast-corpus-download.cfg
curl --config /private/tmp/podcast-corpus-download.cfg
python3 -m backend.corpus build
python3 -m backend.pipelines.segment_topics --import-results
python3 -m backend.corpus check
python3 -m backend.corpus search 焦虑
python3 -m unittest discover -s tests -p 'test_*.py'
```

对已下载音频重复检查并生成本地试听片段：`python3 -m backend.pipelines.verify_local_audio`（需安装 ffmpeg / ffprobe）。

```sh
python3 -m backend.pipelines.audit_transcripts
python3 -m backend.pipelines.build_audio_review
python3 -m http.server 8765 --bind 127.0.0.1 --directory data/raw
```

在浏览器打开 `http://127.0.0.1:8765/review/`。这是仅本机可访问的核听页，不是公开上线地址。

`build` 重复执行不会增加重复行，只替换清单中选定单集的派生记录，不删除其他单集。
导入前先验证所有字幕与章节；缺文件、格式异常、时间越界会报错。
SQLite 是当前本地素材库，不是已连接的 Supabase；今后迁移时要保留毫秒时间、来源和核听状态。

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

本地脚本按 5 分钟处理，边界附带 2 秒上下文，每个词按中点分配到一个原音频时间段。
断点保存在 `data/raw/asr-checkpoints/`。此 Intel Mac 使用 Numba workqueue 后端，
避免 Numba 与 PyTorch 的不同 OpenMP 运行库冲突。

### 已完成的云端流程（历史 / 维护参考）

当前 15 期已完成，不需要为启动 Demo 执行下列步骤。特别是 `--prepare` 会更新状态报告，`--run` / `--benchmark` 可能上传音频并计费。日常只需前端启动；调整拼盘只运行 `npm run demo:prepare`。

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

## 扩大到不限主题的路线

以下仅为后续研究路线。本阶段固定 15 期，不执行扩充。

1. 先定义榜单来源、统计日期与排名口径：订阅量、单集播放量、节目平均播放量不可混用。
2. 建立约 500 档节目的目录，记录官方 RSS、分类、公开单集数、转录覆盖率、来源条件。
3. 先索引 RSS 元数据和已有转录；不把缺失的转录当作已索引内容。
4. 按领域覆盖选择首批 100–300 集，统计音频小时数，再评估转录预算与计算资源。
5. 补足授权范围内的转录、人工抽检时间对齐、生成向量、用测试问题评估检索，再扩到全量。

500 档×平均 200 集×平均 1 小时只是一个估算场景，即 100,000 音频小时；
64–128 kbps 原音频约 2.9–5.8 TB（十进制），不是当前榜单的实测规模。
只增加节目数量不能保证每个问题都有匹配；需要评估主题覆盖、切片质量、排序和无结果判断。
