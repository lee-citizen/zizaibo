import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { ipc } from "@renderer/utils/ipcRenderer";
import { useConnectStore } from "./connect";
import type { DanmakuMsg } from "ipc-contract";

/**
 * 头像打印规则
 * 事件类型：entry(进场) / gift(礼物) / comment(评论) / follow(关注) / like(点赞)
 */
export interface AvatarRule {
  id: string;
  /** 是否启用 */
  enabled: boolean;
  /** 事件类型 */
  event: "entry" | "gift" | "comment" | "follow" | "like";
  /** 匹配条件：礼物名（gift）或评论内容关键词（comment），其他事件留空即全匹配 */
  match: string;
  /** 头像大小：1=小头像, 2=大头像 */
  size: 1 | 2;
  /** 打印数量 1~100 */
  count: number;
}

const STORAGE_KEY = "avatar-print-rules";

/** 事件类型中文标签 */
export const EVENT_LABELS: Record<AvatarRule["event"], string> = {
  entry: "进场",
  gift: "礼物",
  comment: "评论",
  follow: "关注",
  like: "点赞",
};

/** 头像大小中文标签 */
export const SIZE_LABELS: Record<1 | 2, string> = {
  1: "小头像",
  2: "大头像",
};

function loadRules(): AvatarRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch {
    /* ignore */
  }
  return [];
}

function saveRules(rules: AvatarRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* ignore */
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 判断一条弹幕是否命中某条规则
 * - event 必须匹配
 * - match 为空：无条件匹配
 * - gift 事件：match 是礼物名子串
 * - comment 事件：match 是评论内容子串
 * - 其余事件：match 忽略（全匹配）
 */
function matchesRule(msg: DanmakuMsg, rule: AvatarRule): boolean {
  if (!rule.enabled) return false;
  if (msg.event !== rule.event) return false;
  const kw = rule.match.trim();
  if (!kw) return true;
  if (rule.event === "gift") {
    return msg.giftName ? msg.giftName.includes(kw) : false;
  }
  if (rule.event === "comment") {
    return msg.text.includes(kw);
  }
  // entry / follow / like 不做关键词匹配
  return true;
}

export const useAvatarStore = defineStore("avatar", () => {
  const rules = ref<AvatarRule[]>(loadRules());
  /** 打印模式：2d / 3d */
  const mode = ref<"2d" | "3d">("2d");
  /** 打印窗口是否已打开 */
  const printing = ref(false);
  /** 今日已打印数量（前端统计，仅展示） */
  const printedCount = ref(0);

  // 持久化
  watch(
    rules,
    (v) => saveRules(v),
    { deep: true },
  );

  // ---------- 规则 CRUD ----------
  function addRule(rule: Omit<AvatarRule, "id">): void {
    rules.value.push({ ...rule, id: uid() });
  }

  function updateRule(id: string, patch: Partial<Omit<AvatarRule, "id">>): void {
    const idx = rules.value.findIndex((r) => r.id === id);
    if (idx >= 0) rules.value[idx] = { ...rules.value[idx], ...patch };
  }

  function deleteRule(id: string): void {
    rules.value = rules.value.filter((r) => r.id !== id);
  }

  function deleteSelected(ids: string[]): void {
    const set = new Set(ids);
    rules.value = rules.value.filter((r) => !set.has(r.id));
  }

  function toggleEnabled(id: string): void {
    const r = rules.value.find((x) => x.id === id);
    if (r) r.enabled = !r.enabled;
  }

  function setRules(next: AvatarRule[]): void {
    rules.value = next;
  }

  // ---------- 打印窗口 ----------
  async function startPrint(): Promise<void> {
    await ipc.app.openPrintWindow({ mode: mode.value });
    printing.value = true;
  }

  async function stopPrint(): Promise<void> {
    await ipc.app.closePrintWindow();
    printing.value = false;
  }

  /**
   * 处理一批新弹幕：按规则匹配并投递打印任务。
   * 由 connect.vue 在 applyPull 之后调用。
   */
  async function processMessages(msgs: DanmakuMsg[]): Promise<void> {
    if (!printing.value || !msgs.length) return;
    if (!rules.value.some((r) => r.enabled)) return;

    for (const msg of msgs) {
      if (!msg.avatar) continue; // 没有头像无法打印
      for (const rule of rules.value) {
        if (matchesRule(msg, rule)) {
          const ok = await ipc.app.enqueuePrintTask({
            nickname: msg.user || "观众",
            avatarUrl: msg.avatar,
            event: msg.event,
            count: rule.count,
            size: rule.size,
          });
          if (ok) printedCount.value += rule.count;
        }
      }
    }
  }

  /**
   * 手动测试：用指定参数直接投递一个打印任务（页面调试用）。
   */
  async function testPrint(task: {
    nickname: string;
    avatarUrl: string;
    event: string;
    count: number;
    size: number;
  }): Promise<boolean> {
    if (!printing.value) return false;
    return await ipc.app.enqueuePrintTask(task);
  }

  return {
    rules,
    mode,
    printing,
    printedCount,
    addRule,
    updateRule,
    deleteRule,
    deleteSelected,
    toggleEnabled,
    setRules,
    startPrint,
    stopPrint,
    processMessages,
    testPrint,
  };
});
