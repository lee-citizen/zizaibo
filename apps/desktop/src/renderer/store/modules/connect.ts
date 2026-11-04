import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { DanmakuMsg } from "ipc-contract";

/**
 * 连接直播 store（M1：抖音）
 * 只做数据持有与派生：轮询、注入等采集链路在 connect.vue 中驱动。
 */

const MAX_MESSAGES = 200;
/** 断流判定：弹幕采集器已就绪但超过该时长没有新消息 */
const STALL_MS = 120000;
/** 采集器迟迟未就绪的判定阈值 */
const NOT_READY_MS = 45000;

export const useConnectStore = defineStore("connect", () => {
  /** 输入框中的直播间链接 */
  const roomUrlInput = ref("");
  /** 是否已连接（直播间窗口已打开并开始采集） */
  const connected = ref(false);
  /** 直播间窗口的 webContents id */
  const windowId = ref(0);
  /** 直播间窗口是否已隐藏（移出屏幕，弹幕采集不中断） */
  const roomHidden = ref(false);
  /** 连接发起时间（用于「迟迟未就绪」判定） */
  const connectedAt = ref(0);
  /** 平台标识，M1 只有 douyin */
  const platform = ref("douyin");

  /** 弹幕列表（新消息在顶部，环形上限） */
  const messages = ref<DanmakuMsg[]>([]);
  /** 观看人数原始文本（如 1.2万） */
  const viewerText = ref("");
  /** 最近 60 秒弹幕条数（随每次拉取刷新） */
  const rate = ref(0);
  /** 暂停自动更新提示（回看历史时冻结顶部插入） */
  const paused = ref(false);
  /** 暂停期间暂存的消息，恢复后合并展示 */
  const pending = ref<DanmakuMsg[]>([]);
  /** 暂停期间积压条数（供界面提示） */
  const pendingCount = ref(0);
  /** emoji 标记 -> 图片地址（把弹幕里的 [标记] 还原成表情图） */
  const emojiMap = ref<Record<string, string>>({});

  // 采集器状态
  const collectorReady = ref(false);
  const lastMsgAt = ref(0);

  /** 是否处于「断流/未就绪」提示状态 */
  const stalled = computed(() => {
    if (!connected.value) return false;
    const now = Date.now();
    if (!collectorReady.value) return now - connectedAt.value > NOT_READY_MS;
    return now - lastMsgAt.value > STALL_MS;
  });

  const stalledText = computed(() => {
    if (!connected.value) return "";
    if (!collectorReady.value)
      return "尚未识别到弹幕区：请确认直播间窗口已打开并加载完成，若出现登录/验证提示请先处理，识别后自动恢复";
    return "长时间没有新弹幕：可能是直播间较安静，或直播间窗口出现登录/验证提示，处理后自动恢复";
  });

  /** 去重键：uid 优先 */
  function msgKey(m: DanmakuMsg): string {
    return `${m.uid || m.user}|${m.text}|${m.ts}`;
  }

  function applyPull(res: {
    msgs: DanmakuMsg[];
    viewer: string;
    ready: boolean;
    lastMsgAt: number;
    emojiMap?: Record<string, string>;
  }): DanmakuMsg[] {
    if (!connected.value) return [];
    collectorReady.value = res.ready;
    if (res.viewer) viewerText.value = res.viewer;
    if (res.lastMsgAt > lastMsgAt.value) lastMsgAt.value = res.lastMsgAt;
    if (res.emojiMap && Object.keys(res.emojiMap).length) {
      emojiMap.value = { ...emojiMap.value, ...res.emojiMap };
    }
    const fresh: DanmakuMsg[] = [];
    if (res.msgs.length) {
      const filtered = res.msgs.filter(
        (m) => m && m.text && !messages.value.some((o) => msgKey(o) === msgKey(m)),
      );
      if (paused.value) {
        // 暂停时先暂存，恢复后一次性并入，不丢数据
        pending.value = [...pending.value, ...filtered].slice(-500);
        pendingCount.value = pending.value.length;
      } else {
        // 聊天式：最新在底部，新消息追加到末尾，保留最近 MAX 条
        const sorted = [...filtered].sort((a, b) => a.ts - b.ts);
        messages.value = [...messages.value, ...sorted].slice(-MAX_MESSAGES);
        fresh.push(...sorted);
      }
      // 60 秒窗口速率（暂停期间按暂存+已有计算）
      const cutoff = Date.now() - 60000;
      const all = paused.value ? [...pending.value, ...messages.value] : messages.value;
      rate.value = all.filter((m) => m.ts > cutoff).length;
    }
    return fresh;
  }

  function setConnected(v: boolean): void {
    connected.value = v;
    connectedAt.value = v ? Date.now() : 0;
    if (!v) {
      // 断开连接：只清连接/采集状态，保留弹幕列表和人数（用户点清空才清）
      collectorReady.value = false;
      lastMsgAt.value = 0;
      paused.value = false;
      pending.value = [];
      pendingCount.value = 0;
      roomHidden.value = false;
    }
  }

  function reset(): void {
    messages.value = [];
    viewerText.value = "";
    rate.value = 0;
    collectorReady.value = false;
    lastMsgAt.value = 0;
    paused.value = false;
    pending.value = [];
    pendingCount.value = 0;
  }

  function clearMessages(): void {
    messages.value = [];
    pending.value = [];
    pendingCount.value = 0;
  }

  /** 恢复自动更新：把暂存消息并入列表 */
  function resume(): void {
    paused.value = false;
    if (pending.value.length) {
      const sorted = [...pending.value].sort((a, b) => a.ts - b.ts);
      messages.value = [...messages.value, ...sorted].slice(-MAX_MESSAGES);
      pending.value = [];
      pendingCount.value = 0;
    }
  }

  return {
    roomUrlInput,
    connected,
    connectedAt,
    windowId,
    roomHidden,
    platform,
    messages,
    viewerText,
    rate,
    paused,
    pendingCount,
    emojiMap,
    collectorReady,
    lastMsgAt,
    stalled,
    stalledText,
    applyPull,
    setConnected,
    reset,
    clearMessages,
    resume,
  };
});
