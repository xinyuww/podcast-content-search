import taxonomy from "../data/content-taxonomy.json" with { type: "json" };

export { taxonomy };
export const preferenceFields = ["topics", "help_types", "formats", "avoid_help_types", "avoid_formats"] as const;
export type PreferenceField = typeof preferenceFields[number];
export type Preferences = Record<PreferenceField, string[]>;
export type ConversationMessage = { id: string; role: "user" | "assistant"; content: string };
export type NeedEvidence = { field: "situation" | "need_summary" | PreferenceField; label: string; message_id: string; quote: string; basis: "explicit" | "inferred" };
export type NeedProfile = {
  situation: string;
  need_summary: string;
  search_query: string;
  preferences: Preferences;
  unresolved: string[];
  ready_to_recommend: boolean;
  evidence: NeedEvidence[];
};
export type NeedTurn = { assistant_message: string; next_question: string | null; need: NeedProfile };
export const MAX_USER_TURNS = 12;
export const fieldNames: Record<PreferenceField, string> = {
  topics: "关注的话题", help_types: "希望获得的帮助", formats: "想听的形式",
  avoid_help_types: "暂时不需要的帮助", avoid_formats: "不想听的形式",
};
export function vocabulary(field: PreferenceField): Record<string, string> {
  return taxonomy[field.replace("avoid_", "") as "topics" | "help_types" | "formats"];
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
}
export function parseMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_USER_TURNS * 2 - 1 || value.length % 2 !== 1) throw new Error("对话长度无效，请重新开始。");
  return value.map((m, i) => {
    const role = i % 2 === 0 ? "user" : "assistant";
    const id = `${role === "user" ? "u" : "a"}${Math.floor(i / 2) + 1}`;
    if (!object(m) || !exactKeys(m, ["id", "role", "content"]) || m.role !== role || m.id !== id || !text(m.content, role === "user" ? 1000 : 2000)) throw new Error("对话格式无效，每次输入请保持在 1–1000 字。");
    return { id, role, content: m.content };
  });
}

/** Restore the existing export format; citations must still reference real user messages. */
export function restoreNeed(value: unknown): { messages: ConversationMessage[]; turn: NeedTurn } {
  if (!object(value) || value.schema_version !== "listening-need-v1" || value.taxonomy_version !== taxonomy.version || !Array.isArray(value.messages) || value.messages.length < 2 || value.messages.length % 2 !== 0) throw new Error("请粘贴本应用导出的完整需求 JSON。");
  const messages = parseMessages(value.messages.slice(0, -1));
  const last = value.messages[value.messages.length - 1];
  if (!object(last) || last.role !== "assistant" || last.id !== `a${value.messages.length / 2}` || !text(last.content, 2000)) throw new Error("导出的对话记录不完整。");
  const need = value.need;
  const turn = parseNeedTurn({ assistant_message: "已恢复保存的需求，可以继续补充或生成拼盘。", next_question: object(need) && need.ready_to_recommend ? null : "你想怎样补充尚未明确的需求？", need }, messages);
  return { messages: [...messages, { id: last.id as string, role: "assistant", content: last.content }], turn };
}
export function parseNeedTurn(value: unknown, messages: ConversationMessage[]): NeedTurn {
  const invalid = () => { throw new Error("模型返回的需求结构或原话依据无效，请重试。"); };
  if (!object(value) || !exactKeys(value, ["assistant_message", "next_question", "need"]) || !text(value.assistant_message, 1200)) return invalid();
  const n = value.need;
  if (!object(n) || !exactKeys(n, ["situation", "need_summary", "search_query", "preferences", "unresolved", "ready_to_recommend", "evidence"])) return invalid();
  if (!text(n.situation, 1000, true) || !text(n.need_summary, 1000) || !text(n.search_query, 1000, true) || typeof n.ready_to_recommend !== "boolean") return invalid();
  const p = n.preferences;
  if (!object(p) || !exactKeys(p, [...preferenceFields])) return invalid();
  for (const f of preferenceFields) {
    const labels = p[f];
    if (!Array.isArray(labels) || labels.length > 3 || new Set(labels).size !== labels.length || labels.some(l => typeof l !== "string" || !Object.hasOwn(vocabulary(f), l))) return invalid();
  }
  const prefs = p as Preferences;
  for (const f of ["help_types", "formats"] as const) {
    if (prefs[f].some(label => prefs[`avoid_${f}`].includes(label))) return invalid();
  }
  if (!Array.isArray(n.unresolved) || n.unresolved.length > 3 || n.unresolved.some(x => !text(x, 300))) return invalid();
  if (n.ready_to_recommend) {
    if (n.unresolved.length || value.next_question !== null || !text(n.search_query, 1000)) return invalid();
  } else if (!n.unresolved.length || !text(value.next_question, 300)) return invalid();
  if (!Array.isArray(n.evidence) || n.evidence.length > 25) return invalid();
  for (const e of n.evidence) {
    if (!object(e) || !exactKeys(e, ["field", "label", "message_id", "quote", "basis"]) || !["situation", "need_summary", ...preferenceFields].includes(e.field as PreferenceField) || !text(e.label, 100, true) || !text(e.quote, 500) || !["explicit", "inferred"].includes(e.basis as string)) return invalid();
    const source = messages.find(m => m.id === e.message_id && m.role === "user");
    if (!source || !source.content.includes(e.quote)) return invalid();
    if (preferenceFields.includes(e.field as PreferenceField)) {
      if (!prefs[e.field as PreferenceField].includes(e.label)) return invalid();
      if ((e.field as string).startsWith("avoid_") && e.basis !== "explicit") return invalid();
    } else if (e.label !== "") return invalid();
  }
  const evidence = n.evidence as NeedEvidence[];
  for (const field of ["situation", "need_summary"] as const) {
    if (n[field] && !evidence.some(e => e.field === field)) return invalid();
  }
  for (const field of preferenceFields) {
    if (prefs[field].some(label => !evidence.some(e => e.field === field && e.label === label))) return invalid();
  }
  return value as NeedTurn;
}

const string = { type: "string" };
const strictObject = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const needTurnSchema = strictObject({
  assistant_message: string,
  next_question: { type: ["string", "null"] },
  need: strictObject({
    situation: string,
    need_summary: { ...string, description: "当前收听需求的概括；尚不明确也应描述已知信息，并必须在evidence中提供field=need_summary的原话依据。" },
    search_query: string,
    preferences: strictObject(Object.fromEntries(preferenceFields.map(field => [field, { type: "array", items: { type: "string", enum: Object.keys(vocabulary(field)) }, maxItems: 3 }]))),
    unresolved: { type: "array", items: string, maxItems: 3 },
    ready_to_recommend: { type: "boolean", description: "话题和期望帮助已明确就为true，不为可选形式或细分偏好追问。true时unresolved=[]、next_question=null。" },
    evidence: { type: "array", description: "need_summary、非空situation、每个偏好标签分别至少一条证据；可重复引用同一句用户原话，但各字段必须分别列出。", maxItems: 25, items: strictObject({
      field: { type: "string", enum: ["situation", "need_summary", ...preferenceFields] },
      label: string, message_id: string, quote: string,
      basis: { type: "string", enum: ["explicit", "inferred"] },
    }) },
  }),
});
