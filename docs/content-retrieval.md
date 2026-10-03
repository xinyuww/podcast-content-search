# 章节标注、向量化与规则检索

完成日期：2026-10-01。内容索引与命令行检索已建立；随后已接入[需求对话](needs-conversation.md)和[动态拼盘接口](dynamic-playlists.md)，固定示例继续保留。

## 已完成的数据

| 项目 | 数量 / 状态 |
| --- | --- |
| 统一内容单元 | 185：140 个发布方章节 + 45 个模型生成并经文本复查的章节 |
| 摘要、场景及标签 | 185，均有本段字幕编号依据 |
| 主体向量 | 165，每段一个向量；保留完整原文，无截断 |
| 默认独立检索候选 | 164；另 1 段明确依赖前文，已排除 |
| 向量模型 | `text-embedding-3-small`，1,536 维 |
| 标注模型 | `gpt-4.1-2025-04-14`，严格 JSON Schema |
| 标注类型 | 161 content、5 mixed、14 intro、4 outro、1 advertisement |
| 向量输入长度 | 最大 5,007 tokens；上限保护为 8,191 tokens，超长时报错而非截断 |

标注类型与分段阶段的已知类型共同决定资格：即使模型把某个原有片尾标成 mixed，也不会把它纳入内容向量。165 包含 1 个上下文依赖段供后续研究；默认独立检索排除它。不是把 185 个章节全部当成可推荐主体。

原字幕、音频、发布方章节、45 个主题章节和旧 431 个窗口均保持原样。处理前的数据库备份在 `data/raw/backups/before-content-index.sqlite3`。

## 统一单元与标注

发布方章节按原起止时间关联相交字幕；模型章节按已经核验的首尾字幕范围关联。完整原文直接从源字幕拼接，不由模型重写。原始播放时间保持不变。若字幕越出播放边界超过 1 秒，标记并排除独立检索；本次未出现这类情况。

标注包含：摘要、具体讨论处境、内容类型、文本独立性及原因，另有三组多选标签：

- 主题：AI 与工作、职业成长、软件开发、沟通、产品、商业、管理、学习、开源、科技趋势、薪酬、情绪与不确定性、文化社会。
- 帮助：信息、实践方法、决策支持、不同视角、相似经历、情感支持。
- 形式：个人故事、实践建议、案例分析、概念解释、观点讨论。

准确枚举和定义以 [content-taxonomy.json](../data/content-taxonomy.json) 为准。每个标签引用本单元的字幕编号；这证明引用存在，但不等于模型的语义判断已经全部正确。标签可为空，不强行给每段补齐情绪支持等类型。

本批标注没有 `emotional_support`。这意味着现阶段没有被标注为明确安慰、接纳感受的候选，不代表“听这些节目一定不能获得支持”。也不能仅因内容涉及焦虑就承诺共情效果。

已抽查多个节目及亲身经历、信息、实践等类型的摘要和引用；发现 OPC 的摘要沿用了转录中的“艺人公司”同音错误，依据同段英文解释和“一人股东”语句修正为“一人公司”，保留原响应、修正理由，并只重算该段向量。所有标注仍按模型初稿管理；尚未全量语义审核或逐段核听。

标注查看：[摘要与标签总览](../data/content-annotations-review.md)。

## 向量与检索逻辑

向量输入：`标题 + 摘要 + 具体处境 + 完整段落原文`。结构化标签独立保存，供规则使用。模型与参数根据 [OpenAI Docs：Embeddings](https://developers.openai.com/api/docs/guides/embeddings) 和 [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) 核对。

向量以归一化 float32 BLOB 保存在 SQLite，当前规模直接遍历计算余弦相似度即可，不增加向量数据库服务。

```text
问题文字 → 查询向量 → 余弦相似度召回最多 30 段
                    → 排除用户明确不想要的内容形式 / 帮助类型
                    → 根据主题、帮助、形式标签打分 → 返回候选、原文依据与音频时间
```

规则分 = 相似度 + 0.10 × 帮助偏好覆盖率 + 0.08 × 形式偏好覆盖率 + 0.04 × 主题偏好覆盖率。
没有填写某类偏好时，该项不加分。相似度低于 0.35 的段落不允许靠标签加分进入结果。这个阈值是在本次小样本上调整的启发式参数，不是相关概率或经验证的置信度。

没有对召回段落再次调用生成式模型。当前检索命令的需求标签由 CLI 参数或测试场景给定；需求对话现已输出同一套标签，并可通过页面按钮将需求交给动态拼盘接口，调用同一检索流程。

结果包含 `candidates_found`、`partial_match` 或 `insufficient_coverage`；缺少用户期望的帮助类型会显示在 `unmet_preferences`。`candidates_found` 仅表示当前规则找到候选，不代表用户需求已满足。节目中的历史、商业和观点内容只是原节目表述，检索不会核实或更新这些主张。

## 小规模验证与限制

共 13 个开发者场景：11 个正例含部分相关性种子，另有烘焙、冰岛旅行两个库外负例。其中 3 对问题保持文字完全相同，只改变需求标签，以检查规则排序的作用。

| 检查 | 结果 |
| --- | --- |
| 正例预设章节进入 Top 5：仅向量 | 8/11 |
| 正例预设章节进入 Top 5：向量 + 标签规则 | 9/11 |
| 库外负例返回无匹配 | 2/2 |
| 相同职场沟通问题，偏方法 | 首位为“需求变更、交付标准与沟通困境” |
| 相同职场沟通问题，偏经历 | 首位为“程序员与产品经理：从双方吐槽看协作摩擦” |

初次阈值 0.28 时，烘焙问题误召回花店运营；将阈值调到 0.35 后拒绝该误召回。初次结果保留在 `data/retrieval-evaluation-initial.json/.md`。测试集参与了调参，因此结果不能用作盲测准确率。

仍有明显限制：AI 共情需求的情感支持偏好未覆盖；“如何找到付费客户”未把预设的销售主题章节排入前五；花店落地问题首位是另一行业的失败案例。主题标签较宽，规则加分可能将宽泛案例推高，后续需要独立评测集和人工偏好反馈，而不是只对这 13 个例子调权重。

详细结果：[检索对比报告](../data/retrieval-evaluation.md)。

工程检查：35 项 Python 测试通过；在禁止网络连接的条件下重新执行 prepare、annotate、embed 和 13 场景 evaluate 均成功，向量指纹和 65 份 API 响应缓存数量保持不变。7 张原始素材表与处理前逐表哈希一致；SQLite 完整性和外键检查通过。

## 文件与数据库

新增三张派生表：

- `content_units`：统一章节、真实原文、音频位置、来源哈希与审核标记。
- `content_annotations`：摘要、结构化标签及字幕依据、模型、词表版本与 API 来源。
- `content_embeddings`：单元 ID、模型、维度、输入哈希、token 数及向量。

脚本为 `backend/content_index.py` 和 `backend/search_content.py`。标注可移植导出在 `data/content-annotations.json`；词表在 `data/content-taxonomy.json`；抽查修订在 `data/content-annotation-reviews.json`；统计在 `data/content-index-report.json`。

`data/raw/content-index/` 保存带原文的请求、原始响应、查询向量及向量批次缓存，被 Git 忽略。API key 只在进程中读取，缓存不包含认证头。当前没有前端依赖这些文件或密钥。

## 使用与恢复

已有 `.venv` 包含 tiktoken 0.14.0。独立环境只需要 Python 标准库和 `requirements-retrieval.txt`，无需安装 Whisper 来运行检索。首次加载分词器需下载其配置。

```sh
# 本地准备、从已保存的标注恢复；不请求模型
python3 -m backend.content_index prepare

# 仅为缺失/过期章节生成标注；会请求 OpenAI
python3 -m backend.content_index annotate --workers 2

# 仅为缺失/过期内容生成向量；命中请求缓存时不联网
.venv/bin/python -m backend.content_index embed

# 查询文字相同会复用查询向量；未缓存的问题需要 API key 和网络
.venv/bin/python -m backend.search_content search 'AI发展太快，我担心作为程序员会被替代，不知道该怎么办。' --help-type practical_guidance --format practical_advice --topic ai_and_work

# 已运行过的 13 个测试场景可离线复现
.venv/bin/python -m backend.search_content evaluate
python3 -m unittest discover -s tests -p 'test_*.py'
```

可以加 `--verified-only` 仅允许已核听音频；由于当前全库仍未逐段核听，此模式现阶段返回空候选。

源字幕/章节重建会级联删除相关派生数据，按以下顺序恢复：`corpus.py build` → `segment_topics.py --import-results` → `content_index.py prepare` → `annotate` → `embed`。源文本、边界、词表或标注变化会使对应结果失效；检索拒绝使用缺失或过期向量。不要手改向量、伪造已核听状态或绕过哈希检查。
