# 四期《编码人声》的主题章节

完成日期：2026-10-01。范围为此前没有发布方章节的四期，原有 11 期的 140 个发布方章节保持不变。

## 本次结果

| 单集 | 主题章节总数 | 主体内容 | 片头、片尾或推广 |
| --- | ---: | ---: | ---: |
| “卷”出来的那些 10 倍开发者 | 10 | 8 | 2 |
| 让我们心平气和地聊聊代码与产品 | 10 | 7 | 3 |
| 从一个播客的诞生，看开源精神的内核 | 13 | 11 | 2 |
| 面向AI的新编程范式 | 12 | 10 | 2 |
| 合计 | 45 | 36 | 9 |

主体段落约 2.2–9.5 分钟，中位时长约 6.36 分钟。四期全部 1,582 条字幕均恰好归入一个章节；章节时间由真实字幕映射，字幕之外的静音和片尾音乐不强行补入。

完整标题、时间和摘要见 [章节结果](../data/topic-chapters-review.md)。

## 方法与来源

脚本：`backend/pipelines/segment_topics.py`。使用 OpenAI Responses API、`gpt-4.1-2025-04-14` 和严格 JSON Schema；参考 [OpenAI Docs：Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) 和 [模型文档](https://developers.openai.com/api/docs/models/gpt-4.1)。

每期将全部带 `c0001` 等编号的字幕及原起止秒数一次提交，模型输出标题、短摘要、类型及起止字幕编号。模型不输出时间戳；程序用首条字幕开始时间、组内字幕最大结束时间生成章节时间，原文从数据库直接拼接。`standalone` 仅为文本判断，不代表音频验证。

本次共 4 个成功 API 请求，每期一次；合计输入 81,300 tokens、输出 5,372 tokens。`store=false`，密钥读取环境变量或被 Git 忽略的 `.env.local`，不写入请求缓存。恢复已完成结果不再调用 API。

模型首次输出 58 个章节。结构检查发现《代码与产品》遗漏结尾 4 条告别字幕，核对后补回片尾。随后 Codex 根据相邻字幕复查，移动切在半句话中的边界、合并依赖前文的短段，将一个 24 分钟段落按反馈、制作流程、竞争力与社群、跨领域组织方法重新细分。最终 45 段是模型初稿加文本边界复查的结果，不是未经调整的原始输出，也不是人工核听结果；未追加 API 调用。

## 文件与数据库

- `data/raw/topic-segmentation/<episode-id>/<request-hash>/request.json`：完整请求，包含整期原文，Git 忽略。
- 同目录 `response.json`：未经修改的原始 API 响应，保留模型、用量和响应 ID。
- `data/topic-chapters/<episode-id>.json`：最终时间、字幕范围、摘要、来源和审核状态；不复制全文。
- 同目录 `*.review.json`：文本复查后的边界方案及理由，关联原模型结果哈希。
- 同目录 `*.corrections.json`：首次结构补正记录，保留原值和修改理由。
- `data/topic-chapters-review.md`：可读的结果总览。
- SQLite 新增 `topic_chapters`：保存这 45 段及关联原文；`origin=model_generated`，最终文本修订的详细来源保存在 JSON 中。

`chapters` 仍是 140 个发布方章节；`transcript_segments` 仍是旧的 431 个约三分钟窗口。本轮只新增四期主题章节，没有修改旧字幕、音频、固定前端拼盘，也没有生成需求标签或向量。后续应统一用发布方章节和这些主题章节建设内容库。

## 核验与限制

已检查章节引用、连续覆盖、顺序、真实时间、原文映射、数据库外键和完整性，并对文本边界作复查。原有五张关键数据表的内容哈希前后相同。

所有章节保留 `needs_listening_review`。文本复查不能验证 ASR 的每句话是否准确，也不能证明听感自然。字幕中局部转录错误未在本任务中改写。

《“卷”出来的那些 10 倍开发者》的“从独立做产品看开发者的成长路径”开头回应上一位嘉宾，保留 `context_dependency` 标记和 `standalone=false`；暂不宜作为独立推荐段落。其余 35 个主体段落通过了本次文本层面的独立性检查，仍需核听边界。

## 重复使用

仅准备请求，不调用模型、不入库：

```sh
python3 -m backend.pipelines.segment_topics
```

生成缺失结果并导入（需要 API key，会对未处理的整期字幕调用 API）：

```sh
python3 -m backend.pipelines.segment_topics --run
```

复用已保存结果重新校验、入库和生成报告，无 API 调用：

```sh
python3 -m backend.pipelines.segment_topics --import-results
python3 -m unittest discover -s tests -p 'test_*.py'
```

`corpus.py build` 重建源字幕时，关联的 `topic_chapters` 会级联清除；重建后执行 `--import-results` 恢复。如果字幕文本或时间发生变化，哈希检查会拒绝导入旧边界，需要重新评估分段。新增或修改文本复查方案时，需保留原始 API 响应以核对来源；已经验证保存的最终结果可不依赖原始 API 缓存恢复。
