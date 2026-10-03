# 对话理解与结构化需求

实现日期：2026-10-01。页面已接入需求对话接口；这一阶段的交付是可纠正、可导出的需求结构。需求准备好后可调用本地检索并生成动态拼盘，详见[动态拼盘](dynamic-playlists.md)。

## 交互与数据流

用户输入 → `POST /api/needs` → 服务端 Responses API → 结构与引用校验 → 页面显示当前理解，必要时只追问一个问题。

每轮传递完整对话，重新生成同一份需求结构。不会把新标签简单合并到旧标签上。用户可以在完成之后继续纠正；重新开始会清空当前会话并取消未完成请求。请求失败保留输入与已有对话，取消或重开后迟到的响应不会覆盖新状态。切换播放器再返回会保留对话，刷新页面则清空；可以导出 JSON 并在「恢复已保存的需求」中重新载入。需求明确后提供「按这个需求生成拼盘」，如果输入框中还有未发送的修改则暂停生成。

结构包含：

| 字段 | 作用 |
| --- | --- |
| `situation` | 用户提供的具体处境；不补充身份、职业或心理诊断 |
| `need_summary` | 当前希望听到什么、得到什么帮助 |
| `search_query` | 后续向量检索使用的自然语言文字 |
| `preferences` | `topics`、`help_types`、`formats`、`avoid_help_types`、`avoid_formats`，直接复用内容侧词表 |
| `unresolved` | 会影响推荐的待确认点，最多 3 个 |
| `ready_to_recommend` | 是否已具备可检索的需求；不代表已经搜到合适内容 |
| `evidence` | 字段、标签、用户消息 ID、连续原话、explicit / inferred |

响应另外包含 `assistant_message` 和 `next_question`。前者简短确认理解，后者有必要时只问一个问题。准备就绪必须有检索文字、没有待确认点，且不再追问；三类正向标签不必全部填写。

标签定义以 `data/content-taxonomy.json` 为唯一来源。正向偏好可以谨慎推断并记录依据；明确拒绝才进入硬排除。想听 A 不等于拒绝 B。内容库缺少某类标签时，不改变用户需求来迁就素材。

## 实现边界

- `lib/needs.ts`：共享类型、同词表枚举的 JSON Schema、输入与模型结果校验。
- `server/needs.ts`：提示词、Responses API、错误处理、HTTP 接口。
- `worker/index.ts`：将 `/api/needs` 交给需求服务，其余路径保持原页面服务。
- `components/needs-conversation.tsx`：对话、需求卡片、补充纠正、取消、重新开始及 JSON 下载。
- `data/needs-cases.json`：6 个合成场景、8 轮预期行为。
- `tests/needs.test.mjs`：结构、引用、纠正替换、接口错误和请求边界的离线测试。
- `scripts/evaluate_needs.mjs`：真实模型验收工具，支持通过本地 HTTP 或直接调用同一服务函数。

使用现有内容标注模型 `gpt-4.1-2025-04-14`，开启严格 JSON Schema；接口用法依据 [OpenAI Docs：Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。未新增 SDK 或运行依赖。

运行时会校验：标签枚举、每组上限、正负偏好冲突、引用属于用户消息且是原话子串、每个非空摘要字段和标签有依据、排除项依据必须 explicit，以及追问与准备状态的一致性。

这些检查保证结构有效、引用可追溯，无法机械证明模型推断正确，也无法仅凭引用检查证明某句话真的表达了拒绝。最新纠正优先、少追问等语义行为仍需真实模型验收与用户反馈。

## 本地运行

已有 `.env.local` 中的 `OPENAI_API_KEY` 由 Cloudflare 本地开发运行时读取并传入服务端。修改环境配置后重启 `npm run dev`。密钥不使用 VITE / NEXT_PUBLIC 前缀，也不传入浏览器。固定示例试听无需密钥。

```sh
npm run dev
npm run test:needs
npm run needs:evaluate -- --url http://127.0.0.1:3000
```

真实验收会调用 API 并计费，默认不缓存模型结果；连续两次服务错误会停止，剩余场景标为未运行。报告写入 `data/needs-evaluation.md`，完整合成对话保存在 Git 忽略的 `outputs/needs-evaluation.json`。直接调用服务函数时可省略 `--url`。

对话每轮发送完整文本，使用 `store: false`。应用不写入 SQLite、localStorage 或服务端对话日志；浏览器当前页内存保存会话。导出 JSON 是用户主动下载，包含当前需求和对话，因此 `message_id` 可追溯。`store: false` 不等于对 API 平台所有日志保留政策作出承诺。

当前接口面向本地演示，无登录或持久化会话；仅接受 JSON POST，拒绝跨源浏览器调用，最多 12 个用户轮次，每次 1–1000 字，请求体最多 64 KB，模型调用超时为 45 秒。上游错误正文和密钥不返回浏览器。已接入本地动态检索与拼盘；尚未实现用户账户。

## 验证状态

25 项 JavaScript 测试通过（9 项需求服务、13 项播放器、3 项 SSR / Worker 路由）；lint、类型检查和生产构建通过。浏览器产物未包含实际 API key 或服务端模型调用代码。浏览器实测了空输入、提交、取消后保留输入、超时错误，以及固定试听与返回对话；真实模型验收当前遇到 OpenAI 连接超时 / 重置，尚不能宣称语义验收通过。见 [验收记录](../data/needs-evaluation.md)。
