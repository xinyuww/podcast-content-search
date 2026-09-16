export type Segment = {
  id: string;
  order: number;
  role: string;
  title: string;
  show: string;
  episode: string;
  speaker: string;
  excerpt: string;
  reason: string;
  duration: number;
  sourceTime: string;
  accent: string;
};

export const segments: Segment[] = [
  {
    id: "seg-001", order: 1, role: "先看清问题", title: "迷茫不是没有答案，而是问题还太大",
    show: "纵横四海", episode: "Vol.86｜怎样找到真正适合自己的工作", speaker: "Sage",
    excerpt: "很多人在职业选择里问‘我应该做什么’，这个问题大到让人无从下手。可以先换成：我想怎样度过一个普通的星期二？",
    reason: "帮你把抽象的职业焦虑，变成可以观察的日常选择。", duration: 238, sourceTime: "18:42–22:40", accent: "#d7f45b",
  },
  {
    id: "seg-002", order: 2, role: "重新理解选择", title: "职业不是一次押注，是一连串低成本实验",
    show: "无人知晓", episode: "E74｜人生没有标准答案，但可以做实验", speaker: "孟岩 × 李松蔚",
    excerpt: "你不需要先想清楚未来十年。给自己三个月，去验证一个很小的假设：这类工作让我更有能量，还是持续消耗我？",
    reason: "提供一种不必立刻辞职，也能向前探索的行动框架。", duration: 312, sourceTime: "36:08–41:20", accent: "#ffb790",
  },
  {
    id: "seg-003", order: 3, role: "听一个真实经历", title: "从体面的轨道离开之后，我才开始认识自己",
    show: "随机波动", episode: "122｜离开大厂后的第一年", speaker: "适野",
    excerpt: "真正困难的不是收入变化，而是你突然失去了一个方便的身份介绍。那一年，我才慢慢把‘我是谁’和‘我在哪里工作’分开。",
    reason: "一个不美化转型的真实故事，包含失落、试错和重新建立节奏。", duration: 286, sourceTime: "27:15–32:01", accent: "#a8c9ff",
  },
  {
    id: "seg-004", order: 4, role: "落到行动", title: "用三张清单，找到下一步而不是最终答案",
    show: "知行小酒馆", episode: "E58｜职业转型前，先做这三个练习", speaker: "雨白",
    excerpt: "第一张写你做得好的，第二张写做完让你有能量的，第三张写别人愿意为之付费的。重叠的地方，就是值得验证的方向。",
    reason: "一套今天就能开始的练习，让思考不再停留在脑内。", duration: 264, sourceTime: "43:30–47:54", accent: "#edb4db",
  },
  {
    id: "seg-005", order: 5, role: "留一点空间", title: "允许自己暂时不知道",
    show: "不合时宜", episode: "Vol.151｜在不确定里生活", speaker: "若含",
    excerpt: "有时我们急着做决定，只是为了结束焦虑。可好的决定，需要你在不知道的时候多待一会儿，听见那些很轻微、但反复出现的倾向。",
    reason: "在一连串方法之后，用一个更温和的视角结束这次收听。", duration: 221, sourceTime: "51:09–54:50", accent: "#ffe176",
  },
];

export const totalDuration = segments.reduce((sum, item) => sum + item.duration, 0);

export function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
