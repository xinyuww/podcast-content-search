# 需求对话与结构化输出

更新：2026-10-03。当前入口为 Next.js `POST /api/needs`，由 Node 服务端调用需求模型。

## 用户交互

用户在首页输入困惑，点击「找到我的声音」。系统必要时提出一个追问；需求明确后，前端自动调用 `/api/playlists` 并进入拼盘页面。内部摘要、标签和引用不作为 JSON 卡片展示。

每轮提交完整对话，模型重新生成当前需求；用户在后续轮次中的纠正不会简单累加为互相冲突的旧标签。请求失败保留已有对话和输入；取消、重开后的迟到响应不覆盖新状态。若需求已明确但检索失败，可以重新生成。

对话仅保存在当前组件内存中。刷新或从结果页返回首页后重新开始；当前界面没有 JSON 导出／恢复、上一份拼盘或跨刷新会话恢复功能。

## 输出结构

| 字段 | 作用 |
| --- | --- |
| `situation` | 用户明确提供的处境，不补充身份或心理诊断 |
| `need_summary` | 当前想听什么、获得什么帮助 |
| `search_query` | 自然语言检索文字，传给查询向量服务 |
| `preferences` | 主题、帮助类型、形式，以及明确排除项 |
| `unresolved` | 尚待澄清的问题，最多 3 项 |
| `ready_to_recommend` | 是否可以开始检索，不代表一定存在匹配素材 |
| `evidence` | 字段／标签对应的用户消息 ID、原话和 explicit／inferred 依据 |

响应还包含 `assistant_message`、`next_question`、词表版本和模型名称。当前界面主要展示 `next_question`；就绪时直接进入推荐。词表以 [`data/content-taxonomy.json`](../data/content-taxonomy.json) 为准，内容侧和需求侧使用相同枚举。

正向偏好可以在保留依据的前提下谨慎推断；明确拒绝才进入硬排除。想听一种内容，不意味着排除所有其他形式。语料缺少某类帮助时，不修改用户需求来迁就素材。

## 代码与模型

| 文件 | 职责 |
| --- | --- |
| `app/api/needs/route.ts` | Node 路由、环境变量与请求并发入口 |
| `server/needs.ts` | 提示词、模型请求、校验失败处理与错误响应 |
| `lib/needs.ts` | JSON Schema、标签枚举、消息与原话依据校验 |
| `components/needs-conversation.tsx` | 输入、追问、取消、重开和自动请求拼盘 |

当前模型为 `gpt-4.1-2025-04-14`，使用 Responses API 和严格 JSON Schema。运行时检查标签是否合法、偏好是否冲突、原话是否来自对应用户消息，以及就绪状态与追问是否一致。

完整输出若未通过校验，最多重新请求一次；两次共用 45 秒截止时间。模型拒绝、网络失败及未完成输出不会走这条校验修复重试。结构校验不能证明所有语义推断正确。

## 配置与数据边界

本地由 Next.js 从 `.env.local` 读取 `OPENAI_API_KEY`；Vercel 从相应 Production / Preview 环境注入。密钥只在服务端使用。启动见 [README](../README.md#本地运行)。

每个用户消息为 1–1000 字，最多 12 个用户轮次；请求体上限 64,000 字节。接口检查同源浏览器请求，错误不返回上游响应正文或密钥。应用不将对话写入 SQLite、localStorage 或自定义服务端对话日志。请求使用 `store: false`，这不等于对模型平台所有日志政策作出承诺。

## 验证

```sh
npm run test:needs
```

真实模型验收是独立、会调用 API 的维护操作：

```sh
npm run needs:evaluate
# 或先启动网页，再经 HTTP 验收
npm run needs:evaluate -- --url http://127.0.0.1:3000
```

已有 6 个合成场景、8 轮真实模型验收全部通过，见[记录](../data/needs-evaluation.md)。这不是用户研究或盲测准确率。脚本会更新该报告，并把完整结果保存到本地 `outputs/needs-evaluation.json`；不要为普通文档或 UI 修改重跑。
