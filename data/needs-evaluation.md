# 需求对话：真实模型验收

开发者编写的合成对话验收场景；不是用户数据，也不是盲测准确率。

模型：gpt-4.1-2025-04-14；标签版本：needs-content-v1；计划 8 轮，实际尝试 8 轮，有效模型结果 8 轮，通过 8 轮。服务或网络错误不代表语义判断失败。

| 场景 | 轮次 | 检查 | 用时 |
| --- | ---: | --- | ---: |
| clarify_then_correct | 1 | 通过 | 4.8 秒 |
| clarify_then_correct | 2 | 通过 | 5.6 秒 |
| clarify_then_correct | 3 | 通过 | 2.7 秒 |
| clear_practice | 1 | 通过 | 2.4 秒 |
| decision | 1 | 通过 | 2.1 秒 |
| explicit_emotional_support | 1 | 通过 | 3.0 秒 |
| preference_is_not_exclusion | 1 | 通过 | 3.4 秒 |
| respect_no_more_questions | 1 | 通过 | 2.4 秒 |

完整合成对话与模型结果保存在本地 outputs/needs-evaluation.json（不进入 Git）。原话引用与标签枚举经结构校验；这不证明模型对所有真实用户的理解都正确。
