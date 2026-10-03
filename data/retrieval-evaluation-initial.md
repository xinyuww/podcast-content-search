# 本地语义检索与标签规则：小规模验证

开发者编写的场景与部分相关性种子，不是盲测或推荐准确率。标签为模型初稿，所有音频仍待核听。

场景 13 个；正例种子 Top 5 命中：向量 8/11，标签规则 9/11；负例无结果 1/2。

相似度下限是初始启发式参数，不是置信度；有结果也不代表需求已得到满足。

## ai_practice

AI发展太快，我担心作为程序员会被替代，不知道该怎么办。

预期：在同一问题下更偏向可执行的开发实践或能力建议。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：技术深度、薪资与创业选择；十倍开发者的定义、能力与 AI 带来的变化；AI在工作流中的深度应用

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | AI在工作流中的深度应用 | 0.558 | practical_guidance / practical_advice / ai_and_work | 00:04:04.350–00:10:25.830 |
| 2 | 人机协作的编程流程与实践方法 | 0.516 | practical_guidance / practical_advice / ai_and_work | 00:29:49.442–00:35:51.131 |
| 3 | 使用 AI 写代码和排查错误的体验 | 0.511 | practical_guidance / practical_advice / ai_and_work | 00:04:57.108–00:07:09.136 |
| 4 | 技术深度、薪资与创业选择 | 0.597 | practical_guidance | 00:20:59.146–00:29:20.218 |
| 5 | 社群、横向能力与 Hackathon 实践 | 0.509 | practical_guidance / practical_advice | 00:14:58.693–00:20:59.046 |

## ai_empathy

AI发展太快，我担心作为程序员会被替代，不知道该怎么办。

预期：同题不同偏好：排除建议型内容，优先相关经历；情感支持不足应明确显示未覆盖。
状态：`partial_match`；未覆盖偏好：`{"help_types": ["emotional_support"], "formats": [], "topics": []}`。

向量前 3：技术深度、薪资与创业选择；十倍开发者的定义、能力与 AI 带来的变化；AI在工作流中的深度应用

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 技术深度、薪资与创业选择 | 0.597 | shared_experience / personal_story | 00:20:59.146–00:29:20.218 |
| 2 | 60后父母如何接纳AI | 0.508 | shared_experience / personal_story / ai_and_work | 00:25:47.050–00:32:23.450 |
| 3 | 团队需要什么样的产品与技术人才 | 0.529 | shared_experience / personal_story | 00:20:46.582–00:29:05.326 |
| 4 | AI 代码生成原理、语言转换与沟通限制 | 0.515 | personal_story / ai_and_work | 00:07:09.436–00:13:28.765 |
| 5 | 开发门槛降低之后，架构与工程能力为何仍重要 | 0.507 | personal_story / ai_and_work | 00:19:55.083–00:26:19.012 |

## communication_methods

产品经理总是临时改需求，我和他越来越难沟通。

预期：找到需求协作、技术边界与共同目标相关的做法。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：需求变更、交付标准与沟通困境；程序员与产品经理：从双方吐槽看协作摩擦；产品经理的职责细分与共同目标

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 需求变更、交付标准与沟通困境 | 0.508 | practical_guidance / practical_advice / workplace_communication | 00:11:56.084–00:20:44.832 |
| 2 | 产品经理的职责细分与共同目标 | 0.474 | practical_guidance / practical_advice / workplace_communication | 00:40:53.172–00:47:06.832 |
| 3 | 跨界理解、技术边界与减少内耗 | 0.409 | practical_guidance / practical_advice / workplace_communication | 00:47:07.380–00:53:42.849 |
| 4 | 产品与运营如何在生命周期中协作 | 0.449 | practical_guidance / practical_advice | 00:29:05.546–00:35:34.445 |
| 5 | 语音消息与沟通方式 | 0.359 | practical_guidance / practical_advice / workplace_communication | 00:38:51.850–00:42:12.790 |

## communication_experiences

产品经理总是临时改需求，我和他越来越难沟通。

预期：同题偏向双方亲身经历，体现规则排序差异。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：需求变更、交付标准与沟通困境；程序员与产品经理：从双方吐槽看协作摩擦；产品经理的职责细分与共同目标

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 程序员与产品经理：从双方吐槽看协作摩擦 | 0.491 | shared_experience / personal_story / workplace_communication | 00:02:40.414–00:11:55.270 |
| 2 | 产品与运营如何在生命周期中协作 | 0.449 | shared_experience / personal_story | 00:29:05.546–00:35:34.445 |
| 3 | 背后告状与职场告状 | 0.407 | shared_experience / personal_story / workplace_communication | 00:49:20.610–00:52:52.690 |
| 4 | 花店案例：AI 解决效率，人解决沟通 | 0.427 | shared_experience / personal_story | 00:35:19.770–00:41:05.470 |
| 5 | 团队需要什么样的产品与技术人才 | 0.382 | shared_experience / personal_story / workplace_communication | 00:20:46.582–00:29:05.326 |

## options_decision

公司给了不少期权，但现金薪资不高，我不知道该如何看待这份激励。

预期：理解期权兑现和风险的判断条件；仅检索节目观点，不当作财务建议。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：主播亲身经历：期权兑现的坑；期权池与人性考验；美国期权纠纷案例

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 主播亲身经历：期权兑现的坑 | 0.618 | compensation | 00:32:55.470–00:38:16.050 |
| 2 | 期权池与人性考验 | 0.568 | decision_support / compensation | 00:23:34.270–00:28:46.370 |
| 3 | 美国期权纠纷案例 | 0.521 | information / compensation | 00:28:46.370–00:32:55.470 |
| 4 | 期权风险的变化：从公司倒闭到不上市 | 0.507 | information / compensation | 00:16:37.350–00:17:50.410 |
| 5 | 期权在硅谷的起源与在中国的引入 | 0.497 | information / compensation | 00:11:01.890–00:16:37.350 |

## options_story

公司给了不少期权，但现金薪资不高，我不知道该如何看待这份激励。

预期：优先期权兑现的亲身经历。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：主播亲身经历：期权兑现的坑；期权池与人性考验；美国期权纠纷案例

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 主播亲身经历：期权兑现的坑 | 0.618 | shared_experience / personal_story / compensation | 00:32:55.470–00:38:16.050 |
| 2 | 期权在当代的信任危机 | 0.512 | shared_experience / personal_story / compensation | 00:38:16.050–00:43:02.970 |
| 3 | 期权在硅谷的起源与在中国的引入 | 0.497 | shared_experience / personal_story / compensation | 00:11:01.890–00:16:37.350 |
| 4 | 期权池与人性考验 | 0.568 | compensation | 00:23:34.270–00:28:46.370 |
| 5 | 技术深度、薪资与创业选择 | 0.357 | shared_experience / personal_story / compensation | 00:20:59.146–00:29:20.218 |

## flower_business

想把AI用到线下小店里，有没有真实落地后发现需求想错了的案例？

预期：花店落地案例中的被砍功能、客服刚需与实际运营。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：怎么评估AI投入有没有效：先找最小闭环；不要把AI当许愿盒，先定义工作流；人与 AI 的分工：沟通与决策

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 一个失败案例：投入五百万的AI阅卷项目 | 0.458 | shared_experience / case_study / business_practice | 00:33:57.810–00:38:54.190 |
| 2 | 花店案例：AI 解决效率，人解决沟通 | 0.463 | shared_experience / business_practice | 00:35:19.770–00:41:05.470 |
| 3 | AI在科研与急救中的应用 | 0.422 | shared_experience / case_study | 00:02:23.370–00:08:14.850 |
| 4 | 怎么评估AI投入有没有效：先找最小闭环 | 0.531 | business_practice | 00:16:06.410–00:20:24.130 |
| 5 | 不要把AI当许愿盒，先定义工作流 | 0.518 | business_practice | 00:38:54.190–00:42:21.190 |

## business_customers

我能用AI做出一个产品，但完全不知道怎么找到愿意付费的客户。

预期：区分产品实现与销售，找到先找客户再创业的讨论。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：不要把AI当许愿盒，先定义工作流；AI Coding的历史包袱与信息损耗；怎么评估AI投入有没有效：先找最小闭环

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 不要把AI当许愿盒，先定义工作流 | 0.564 | practical_guidance / business_practice | 00:38:54.190–00:42:21.190 |
| 2 | 营销人的AI协同与自我成长 | 0.502 | perspective,practical_guidance | 00:15:32.110–00:20:59.830 |
| 3 | 怎么评估AI投入有没有效：先找最小闭环 | 0.507 | practical_guidance / business_practice | 00:16:06.410–00:20:24.130 |
| 4 | AI Coding的历史包袱与信息损耗 | 0.541 | practical_guidance | 00:22:50.130–00:28:05.610 |
| 5 | 一个失败案例：投入五百万的AI阅卷项目 | 0.495 | perspective / business_practice | 00:33:57.810–00:38:54.190 |

## open_collaboration

组织一个大家自愿参与的社区项目，怎样处理分工不清和推进效率低的问题？

预期：开放协作的实际复盘与协调机制。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：数据隐私与社区共建；国内开源项目的现状与发起人的作用；跨界理解、技术边界与减少内耗

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 国内开源项目的现状与发起人的作用 | 0.449 | case_study / open_source | 00:03:34.330–00:08:26.516 |
| 2 | 社会创新的机制与坚持 | 0.391 | practical_guidance / case_study | 01:08:19.690–01:17:54.190 |
| 3 | 开放经验会失去竞争力吗：定位与社群 | 0.429 | practical_guidance / open_source | 00:49:58.549–00:57:23.217 |
| 4 | AI Coding的历史包袱与信息损耗 | 0.416 | practical_guidance,shared_experience | 00:22:50.130–00:28:05.610 |
| 5 | 产品与运营如何在生命周期中协作 | 0.415 | practical_guidance,shared_experience | 00:29:05.546–00:35:34.445 |

## robotics_explanation

机器人为什么既需要小脑又需要大脑，运动控制和任务决策有什么区别？

预期：命中机器人运动控制与决策解释。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：机器人的小脑与大脑：运动控制与任务决策；自由度与结构：为什么人形机器人这么难；VLA、世界模型与执行模型：大脑的技术路线

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 机器人的小脑与大脑：运动控制与任务决策 | 0.636 | information / explanation | 00:22:01.770–00:27:38.350 |
| 2 | VLA、世界模型与执行模型：大脑的技术路线 | 0.543 | information / explanation / technology_trends | 00:27:38.350–00:36:33.050 |
| 3 | 机器人发展简史：从达芬奇到工业机器人 | 0.537 | information / explanation / technology_trends | 00:01:21.130–00:07:52.270 |
| 4 | 当前瓶颈：模型太大、响应太慢 | 0.536 | information / explanation / technology_trends | 00:36:33.050–00:39:52.930 |
| 5 | 从预编程到强化学习：大模型带来的转折 | 0.514 | information / explanation / technology_trends | 00:14:46.550–00:22:01.770 |

## legacy_code

老项目缺少测试，直接让AI重构又怕改坏，有什么更稳妥的实践？

预期：命中先补测试再重构、测试驱动与工程实践。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：怎么评估AI投入有没有效：先找最小闭环；老代码改造：先补测试，再重构；软件工程实践与 AI 的配合

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 测试驱动开发：AI 让反人性的事变得可行 | 0.587 | practical_guidance / practical_advice / software_development | 00:07:30.650–00:11:29.450 |
| 2 | 怎么评估AI投入有没有效：先找最小闭环 | 0.606 | practical_guidance / practical_advice | 00:16:06.410–00:20:24.130 |
| 3 | 人机协作的编程流程与实践方法 | 0.554 | practical_guidance / practical_advice / software_development | 00:29:49.442–00:35:51.131 |
| 4 | 使用 AI 写代码和排查错误的体验 | 0.535 | practical_guidance / practical_advice / software_development | 00:04:57.108–00:07:09.136 |
| 5 | 一号位必须亲自下场，否则团队动力只有七八十分 | 0.564 | practical_guidance / practical_advice | 00:20:24.130–00:22:50.130 |

## no_baking

做戚风蛋糕总是塌陷，蛋白要打到什么程度，烤箱温度应该怎么设？

预期：当前素材缺少烘焙教程，应返回覆盖不足。
状态：`candidates_found`；未覆盖偏好：`{"help_types": [], "formats": [], "topics": []}`。

向量前 3：平台规则苛刻：二十四小时营业、即时响应考核；花店行业的反直觉真相：损耗不是痛点，花艺师不愿动脑；AI 功能开发：自助盘点被砍，生图模型遇阻

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| 1 | 平台规则苛刻：二十四小时营业、即时响应考核 | 0.316 | practical_guidance | 00:48:22.930–00:56:56.050 |
| 2 | AI 功能开发：自助盘点被砍，生图模型遇阻 | 0.289 | practical_guidance | 00:24:44.150–00:31:45.730 |
| 3 | 花店案例：AI 解决效率，人解决沟通 | 0.288 | practical_guidance | 00:35:19.770–00:41:05.470 |
| 4 | 花店行业的反直觉真相：损耗不是痛点，花艺师不愿动脑 | 0.294 |  | 00:10:42.150–00:19:09.690 |

## no_travel

想去冰岛环岛自驾十天，住宿和每天的路线如何安排？

预期：当前素材缺少冰岛旅行规划，应返回覆盖不足。
状态：`insufficient_coverage`；未覆盖偏好：`{"help_types": ["practical_guidance"], "formats": [], "topics": []}`。

向量前 3：

| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |
| --- | --- | ---: | --- | --- |
| — | 当前素材没有足够匹配的候选 | — | — | — |
