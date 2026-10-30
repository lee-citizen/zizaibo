import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useSpeechStore } from "./speech";

/**
 * 自动报时，三种模式：
 * - 全天整点：0~23 每个整点准点播报
 * - 白天整点：8~23 每个整点准点播报
 * - 随机报时：整点后随机 2~25 分钟播报（全天），模拟真人主播的自然节奏，
 *   相邻两次报时间隔 = (60 - 25) + 2 = 37 分钟起步，满足「至少半小时以上」。
 * 不做小时时间表。文案 {minute} 占位符自动兼容整点/非整点说法。
 */

const CLOCK_SETTINGS_KEY = "speech-clock-settings";
/** 巡检间隔：每 15 秒检查一次是否到达报时目标 */
const CHECK_INTERVAL_MS = 15000;
/** 整点后随机偏移区间（分钟） */
const OFFSET_MIN_MIN = 2;
const OFFSET_MAX_MIN = 25;
/** 目标时刻需在当前时间之后至少 20 秒才排程（刚开启时避免立即触发） */
const MIN_AHEAD_MS = 20000;
/** 错过目标超过该时长（休眠唤醒等）则跳过本次播报，只排下一次 */
const LATE_TOLERANCE_MS = 5 * 60000;

export type ClockMode = "all" | "daytime" | "random";

interface ClockSettings {
  enabled?: boolean;
  mode?: ClockMode;
  template?: string;
  appendWelcome?: boolean;
  welcomeText?: string;
}

/** 旧版默认模板（只有整点语义），加载时自动迁移为支持分钟的版本 */
const LEGACY_DEFAULT_TEMPLATE = "现在是北京时间{hour}点整";
const DEFAULT_TEMPLATE = "现在是北京时间{hour}点{minute}";

export const useClockStore = defineStore("clock", () => {
  const enabled = ref(false);
  /**
   * 报时模式：
   * - all：全天整点，0~23 每个整点准点播报
   * - daytime：白天整点，8~23 每个整点准点播报
   * - random：随机报时，整点后 2~25 分钟随机播报（全天），自然间隔 ≥ 半小时
   */
  const mode = ref<ClockMode>("daytime");
  /** 报时文案模板：{hour}=自然时段说法，{minute}=准点说「整」/非整点说「N分」 */
  const template = ref(DEFAULT_TEMPLATE);
  const appendWelcome = ref(true);
  const welcomeText = ref("欢迎来到直播间，喜欢主播的点个关注哦");
  /** 下次报时时间戳（0 = 未排程） */
  const nextChimeAt = ref(0);

  let checkTimer: number | null = null;

  // ---------- 持久化 ----------
  function loadSettings(): void {
    try {
      const raw = localStorage.getItem(CLOCK_SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as ClockSettings;
        if (typeof s.enabled === "boolean") enabled.value = s.enabled;
        if (s.mode === "all" || s.mode === "daytime" || s.mode === "random") mode.value = s.mode;
        if (typeof s.template === "string" && s.template.trim()) {
          // 旧版默认模板只适合整点播报，静默迁移为兼容分钟的新模板
          template.value = s.template === LEGACY_DEFAULT_TEMPLATE ? DEFAULT_TEMPLATE : s.template;
        }
        if (typeof s.appendWelcome === "boolean") appendWelcome.value = s.appendWelcome;
        if (typeof s.welcomeText === "string") welcomeText.value = s.welcomeText;
      }
    } catch {
      /* ignore */
    }
  }

  function saveSettings(): void {
    try {
      localStorage.setItem(
        CLOCK_SETTINGS_KEY,
        JSON.stringify({
          enabled: enabled.value,
          mode: mode.value,
          template: template.value,
          appendWelcome: appendWelcome.value,
          welcomeText: welcomeText.value,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  // ---------- 文案 ----------
  /** 该小时是否在报时时段内（随机模式全天可播） */
  function isAnnounceHour(hour: number): boolean {
    if (mode.value === "random") return true;
    if (mode.value === "all") return true;
    return hour >= 8 && hour <= 23;
  }

  /** 24 小时制转自然时段说法 */
  function hourText(hour: number): string {
    if (hour === 0) return "0";
    if (hour === 12) return "中午12";
    if (hour < 6) return `凌晨${hour}`;
    if (hour < 12) return `早上${hour}`;
    if (hour < 18) return `下午${hour - 12}`;
    return `晚上${hour - 12}`;
  }

  /** 分钟说法：准点说「整」，非整点说「N分」（随机模式自动生效） */
  function minuteText(minute: number): string {
    return minute === 0 ? "整" : `${minute}分`;
  }

  /** 按目标时刻组装播报文案（含欢迎语） */
  function buildText(target: number): string {
    const d = new Date(target);
    let text = template.value
      .replace(/\{hour\}/g, hourText(d.getHours()))
      .replace(/\{minute\}/g, minuteText(d.getMinutes()));
    if (appendWelcome.value && welcomeText.value.trim()) {
      text = `${text}，${welcomeText.value.trim()}`;
    }
    return text;
  }

  // ---------- 排程 ----------
  /**
   * 计算并排定下一次报时。
   * - 整点模式（all/daytime）：目标 = 整点准点。
   * - 随机模式（random）：目标 = 整点 + 2~25 分钟随机偏移，相邻间隔 ≥ 37 分钟。
   * skipCurrentHour=true 时从下一个整点找起（刚播完当前小时档后调用，避免同小时重复播报）。
   */
  function scheduleNext(skipCurrentHour = false): void {
    const now = Date.now();
    const from = new Date(now);
    for (let add = skipCurrentHour ? 1 : 0; add < 49; add++) {
      // Date 构造自动处理跨天进位
      const hourStart = new Date(
        from.getFullYear(),
        from.getMonth(),
        from.getDate(),
        from.getHours() + add,
        0,
        0,
        0,
      );
      if (!isAnnounceHour(hourStart.getHours())) continue;
      let target: number;
      if (mode.value === "random") {
        const offsetMin =
          OFFSET_MIN_MIN + Math.floor(Math.random() * (OFFSET_MAX_MIN - OFFSET_MIN_MIN + 1));
        target = hourStart.getTime() + offsetMin * 60000;
      } else {
        // 整点模式：准点播报
        target = hourStart.getTime();
      }
      if (target - now >= MIN_AHEAD_MS) {
        nextChimeAt.value = target;
        return;
      }
    }
    // 兜底（理论上到不了）：一小时后再查
    nextChimeAt.value = now + 3600000;
  }

  /** 到点播报（复用智能朗读的音色/语速/音调设置） */
  function announce(target: number): void {
    const speech = useSpeechStore();
    speech.speak(buildText(target));
  }

  function checkChime(): void {
    if (!enabled.value) return;
    const now = Date.now();
    if (!nextChimeAt.value) {
      scheduleNext(false);
      return;
    }
    if (now >= nextChimeAt.value) {
      // 迟到太多（休眠唤醒/长时间阻塞）则跳过本次，只排下一次
      if (now - nextChimeAt.value <= LATE_TOLERANCE_MS) {
        announce(nextChimeAt.value);
      }
      scheduleNext(true);
    }
  }

  function startChecker(): void {
    if (checkTimer !== null) return;
    checkTimer = window.setInterval(checkChime, CHECK_INTERVAL_MS);
  }

  function stopChecker(): void {
    if (checkTimer !== null) {
      window.clearInterval(checkTimer);
      checkTimer = null;
    }
  }

  // ---------- 对外操作 ----------
  /** 开启/关闭整点报时（与其它功能无互斥，独立运行） */
  function setEnabled(v: boolean): void {
    enabled.value = v;
    saveSettings();
    if (v) {
      scheduleNext(false);
      startChecker();
    } else {
      nextChimeAt.value = 0;
      stopChecker();
    }
  }

  /** 切换报时时段，若已开启则立即重新排程 */
  function setMode(m: ClockMode): void {
    mode.value = m;
    saveSettings();
    if (enabled.value) scheduleNext(false);
  }

  /** 保存文案相关设置 */
  function save(): void {
    saveSettings();
  }

  /** 试听报时（按当前时间与当前文案设置） */
  function preview(): void {
    const speech = useSpeechStore();
    speech.speak(buildText(Date.now()));
  }

  /** 下次报时的展示文案 */
  const nextChimeText = computed(() => {
    if (!enabled.value || !nextChimeAt.value) return "未开启";
    const d = new Date(nextChimeAt.value);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${sameDay ? "今天" : "明天"} ${hm}`;
  });

  /** 应用启动初始化：恢复设置，若上次处于开启状态则继续排程 */
  function init(): void {
    loadSettings();
    if (enabled.value) {
      scheduleNext(false);
      startChecker();
    }
  }

  return {
    enabled,
    mode,
    template,
    appendWelcome,
    welcomeText,
    nextChimeAt,
    nextChimeText,
    setEnabled,
    setMode,
    save,
    preview,
    init,
  };
});
