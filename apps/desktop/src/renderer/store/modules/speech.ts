import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import { ipc } from "@renderer/utils/ipcRenderer";
import type { UserVoiceTrack, VoiceMeta } from "ipc-contract";

// ===================== 类型定义 =====================

interface VoiceItem {
  id: string;
  name: string;
  url: string;
  fileName: string;
  recorded: boolean;
}

interface TtsPreset {
  key: string;
  label: string;
  voice: string;
  /** 用于匹配系统声音的关键词（Windows 微软声音 name 含拼音，如 "Yunxi"；也支持中文名 "云希"） */
  matchKeywords: string[];
  rate: number; // speechSynthesis rate
  pitchHz: number; // 音调 Hz 偏移
}

interface GuideConfig {
  enabled: boolean;
  random: boolean;
  minInterval: number;
  maxInterval: number;
  scripts: string[];
}

// ===================== 常量 =====================

/** 一键预设：音色 + 语速 + 音调 */
export const TTS_PRESETS: TtsPreset[] = [
  {
    key: "enthusiastic",
    label: "热情带货",
    voice: "zh-CN-YunxiNeural",
    matchKeywords: ["Yunxi", "云希"],
    rate: 1.15,
    pitchHz: 8,
  },
  {
    key: "gentle",
    label: "温柔互动",
    voice: "zh-CN-XiaoxiaoNeural",
    matchKeywords: ["Xiaoxiao", "晓晓"],
    rate: 1.0,
    pitchHz: 5,
  },
  {
    key: "funny",
    label: "搞笑搞怪",
    voice: "zh-CN-YunjianNeural",
    matchKeywords: ["Yunjian", "云健"],
    rate: 1.25,
    pitchHz: 18,
  },
  {
    key: "relaxed",
    label: "沉浸解说",
    voice: "zh-CN-YunyangNeural",
    matchKeywords: ["Yunyang", "云扬"],
    rate: 0.95,
    pitchHz: -5,
  },
];

/**
 * macOS 上无微软本地声音，使用 edge-tts 的微软中文神经声音列表。
 * 注意：这里只列 Edge 免费接口真实可用的音色，Azure 专用音色（如 YunyeNeural）会连接被拒。
 */
const EDGE_TTS_CHINESE_VOICES: SpeechSynthesisVoice[] = [
  {
    voiceURI: "zh-CN-YunxiNeural",
    name: "云希（男，热情）",
    lang: "zh-CN",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-CN-XiaoxiaoNeural",
    name: "晓晓（女，温柔）",
    lang: "zh-CN",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-CN-YunjianNeural",
    name: "云健（男，搞怪）",
    lang: "zh-CN",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-CN-YunyangNeural",
    name: "云扬（男，沉稳）",
    lang: "zh-CN",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-CN-YunxiaNeural",
    name: "云夏（男，少年）",
    lang: "zh-CN",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-CN-XiaoyiNeural",
    name: "晓伊（女，活泼）",
    lang: "zh-CN",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-CN-liaoning-XiaobeiNeural",
    name: "晓北（女，东北腔）",
    lang: "zh-CN",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-CN-shaanxi-XiaoniNeural",
    name: "晓妮（女，陕西腔）",
    lang: "zh-CN",
    localService: false,
    default: false,
  },
];

const DEFAULT_GUIDE: GuideConfig = {
  enabled: false,
  random: true,
  minInterval: 60,
  maxInterval: 180,
  scripts: [
    "喜欢主播的点个关注哦",
    "想玩的家人扣1",
    "觉得好玩的送个小红心吧",
    "加入粉丝团看更多精彩操作",
  ],
};

const TTS_SETTINGS_KEY = "speech-tts-settings";
const GUIDE_SETTINGS_KEY = "speech-guide-settings";
const VOICE_SETTINGS_KEY = "speech-voice-settings";

/** 是否为 macOS（渲染进程用 navigator.platform 判断，sandbox 下无 process） */
function detectIsMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || "");
}

export const IS_MAC = detectIsMac();

/** Hz 偏移转 speechSynthesis 相对 pitch（0~2）。以 150Hz 为基准频率近似换算。 */
function hzToPitch(hz: number): number {
  const rel = (150 + hz) / 150;
  return Math.max(0.5, Math.min(2, rel));
}

/** base64 字符串转 Blob */
function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ===================== Store =====================

export const useSpeechStore = defineStore("speech", () => {
  // ---------- TTS 状态 ----------
  const voices = ref<SpeechSynthesisVoice[]>([]);
  const selectedVoiceURI = ref<string>("");
  const rate = ref<number>(1); // 0.3 ~ 2.5（UI 展示为百分比偏移）
  const pitchHz = ref<number>(0); // -100 ~ +100 Hz
  const isSpeaking = ref(false);

  // ---------- edge-tts 播放（仅 macOS 使用） ----------
  // edge-tts 播放用的 Audio 单例
  let edgeAudio: HTMLAudioElement | null = null;

  // ---------- 互动引导状态 ----------
  const guide = ref<GuideConfig>({ ...DEFAULT_GUIDE });
  let guideTimer: number | null = null;
  const playedScripts = ref<Set<string>>(new Set());

  // ---------- 我的语音状态 ----------
  type VoicePlayMode = "sequential" | "random" | "fixed";
  const voiceTracks = ref<VoiceItem[]>([]);
  const voiceEnabled = ref<boolean>(false);
  /** 播报方式：顺序 / 随机 / 固定同一条 */
  const voicePlayMode = ref<VoicePlayMode>("sequential");
  /** 固定播放时指定的条数下标 */
  const voiceFixedIndex = ref<number>(0);
  /** 两条语音之间的间隔（秒，区间内随机） */
  const voiceIntervalMin = ref<number>(60);
  const voiceIntervalMax = ref<number>(180);
  /** 持续播放：无间隔，播完立即下一条 */
  const voiceContinuous = ref<boolean>(false);
  const voiceCurrentIndex = ref(-1);
  const voiceIsPlaying = ref(false);
  /** 引导播报是否用「我的语音」替代 TTS（独立于循环总开关，二者可同时工作） */
  const voiceForGuide = ref<boolean>(false);
  /** 引导播报自己的顺序游标（与循环播放的游标分开） */
  const guideVoiceIndex = ref<number>(-1);
  /** 连播间隔计时器 */
  let voiceNextTimer: number | null = null;

  // 模块级 Audio 单例（我的语音循环播放）
  let audio: HTMLAudioElement | null = null;
  // 引导播报专用 Audio 单例（与循环播放分开，二者可同时发声）
  let guideAudio: HTMLAudioElement | null = null;

  // ---------- 持久化 ----------
  function loadTtsSettings(): void {
    try {
      const raw = localStorage.getItem(TTS_SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { voiceURI?: string; rate?: number; pitchHz?: number };
        if (typeof s.voiceURI === "string") selectedVoiceURI.value = s.voiceURI;
        if (typeof s.rate === "number") rate.value = s.rate;
        if (typeof s.pitchHz === "number") pitchHz.value = s.pitchHz;
      }
    } catch {
      /* ignore */
    }
  }

  function saveTtsSettings(): void {
    try {
      localStorage.setItem(
        TTS_SETTINGS_KEY,
        JSON.stringify({
          voiceURI: selectedVoiceURI.value,
          rate: rate.value,
          pitchHz: pitchHz.value,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  function loadGuideSettings(): void {
    try {
      const raw = localStorage.getItem(GUIDE_SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<GuideConfig>;
        guide.value = {
          enabled: Boolean(s.enabled),
          random: s.random ?? true,
          minInterval: typeof s.minInterval === "number" ? s.minInterval : 60,
          maxInterval: typeof s.maxInterval === "number" ? s.maxInterval : 180,
          scripts: Array.isArray(s.scripts) ? s.scripts : DEFAULT_GUIDE.scripts,
        };
      }
    } catch {
      /* ignore */
    }
  }

  function saveGuideSettings(): void {
    try {
      localStorage.setItem(GUIDE_SETTINGS_KEY, JSON.stringify(guide.value));
    } catch {
      /* ignore */
    }
  }

  function loadVoiceSettings(): void {
    try {
      const raw = localStorage.getItem(VOICE_SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { voiceForGuide?: boolean };
        if (typeof s.voiceForGuide === "boolean") voiceForGuide.value = s.voiceForGuide;
      }
    } catch {
      /* ignore */
    }
  }

  function saveVoiceSettings(): void {
    try {
      localStorage.setItem(
        VOICE_SETTINGS_KEY,
        JSON.stringify({ voiceForGuide: voiceForGuide.value }),
      );
    } catch {
      /* ignore */
    }
  }

  // ---------- TTS ----------
  /** 判断是否为中文声音（lang 以 zh 开头，或 name 含中文/Chinese） */
  function isChineseVoice(v: SpeechSynthesisVoice): boolean {
    if (/^zh/i.test(v.lang)) return true;
    if (/[\u4e00-\u9fa5]/.test(v.name)) return true;
    if (/Chinese|Mandarin|cmn/i.test(v.name)) return true;
    return false;
  }

  /** 加载可用语音列表：macOS 用固定微软神经声音（走 edge-tts），Windows 用系统中文声音 */
  function loadVoices(): void {
    if (IS_MAC) {
      voices.value = EDGE_TTS_CHINESE_VOICES;
      // 历史上可能保存过 Edge 不支持的音色，这里纠正为第一个可用音色
      const valid = EDGE_TTS_CHINESE_VOICES.some((v) => v.voiceURI === selectedVoiceURI.value);
      if (!valid) {
        selectedVoiceURI.value = EDGE_TTS_CHINESE_VOICES[0].voiceURI;
      }
      return;
    }
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const all = window.speechSynthesis.getVoices();
    const zhVoices = all.filter(isChineseVoice);
    voices.value = zhVoices.length > 0 ? zhVoices : all;
    if (!selectedVoiceURI.value) {
      selectedVoiceURI.value = voices.value[0]?.voiceURI ?? "";
    }
  }

  /** 停止所有 TTS 朗读（含 edge-tts 音频） */
  function stopSpeaking(): void {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (edgeAudio) {
      edgeAudio.pause();
      edgeAudio.currentTime = 0;
    }
    isSpeaking.value = false;
  }

  /** 播放一段 base64 mp3（edge-tts 结果） */
  async function playEdgeAudio(base64: string): Promise<void> {
    const blob = base64ToBlob(base64, "audio/mpeg");
    const url = URL.createObjectURL(blob);
    if (!edgeAudio) {
      edgeAudio = new Audio();
      edgeAudio.onended = () => {
        isSpeaking.value = false;
      };
      edgeAudio.onerror = () => {
        isSpeaking.value = false;
        ElMessage.error({ message: "音频播放失败", offset: 40 });
      };
    }
    edgeAudio.src = url;
    await edgeAudio.play();
  }

  /** 把当前选中的声音映射为 edge-tts 可用的 ShortName（Windows 系统声音按名称关键字映射） */
  function resolveEdgeVoice(): string {
    if (IS_MAC) return selectedVoiceURI.value || "zh-CN-XiaoxiaoNeural";
    const v = voices.value.find((x) => x.voiceURI === selectedVoiceURI.value);
    const probe = `${v?.name ?? ""} ${selectedVoiceURI.value}`.toLowerCase();
    const table: Array<[string[], string]> = [
      [["yunxi", "云希"], "zh-CN-YunxiNeural"],
      [["xiaoxiao", "晓晓"], "zh-CN-XiaoxiaoNeural"],
      [["yunjian", "云健"], "zh-CN-YunjianNeural"],
      [["yunyang", "云扬"], "zh-CN-YunyangNeural"],
      [["yunxia", "云夏"], "zh-CN-YunxiaNeural"],
      [["xiaoyi", "晓伊"], "zh-CN-XiaoyiNeural"],
    ];
    for (const [keywords, shortName] of table) {
      if (keywords.some((k) => probe.includes(k))) return shortName;
    }
    return "zh-CN-XiaoxiaoNeural";
  }

  /** 用当前音色/语速/音调把文本合成为 base64 mp3 */
  async function synthesizeText(text: string): Promise<string> {
    const result = await ipc.app.edgeTtsSynthesize({
      text,
      voice: resolveEdgeVoice(),
      ratePercent: Math.round((rate.value - 1) * 100),
      pitchHz: pitchHz.value,
    });
    return result.base64;
  }

  /** 用当前配置朗读一段文本。macOS 走 edge-tts，Windows 走本地 Web Speech。 */
  function speak(text: string): void {
    if (!text || !text.trim()) return;
    if (IS_MAC) {
      void speakEdgeTts(text);
      return;
    }
    if (!window.speechSynthesis) {
      ElMessage.warning({ message: "当前环境不支持语音朗读", offset: 40 });
      return;
    }
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.value.find((x) => x.voiceURI === selectedVoiceURI.value);
    if (v) u.voice = v;
    u.rate = rate.value;
    u.pitch = hzToPitch(pitchHz.value);
    u.lang = v?.lang ?? "zh-CN";
    u.onstart = () => {
      isSpeaking.value = true;
    };
    u.onend = () => {
      isSpeaking.value = false;
    };
    u.onerror = () => {
      isSpeaking.value = false;
    };
    window.speechSynthesis.speak(u);
  }

  /** macOS：调用 edge-tts（微软 Edge 在线 TTS，免费）合成并播放 */
  async function speakEdgeTts(text: string): Promise<void> {
    stopSpeaking();
    isSpeaking.value = true;
    try {
      await playEdgeAudio(await synthesizeText(text));
    } catch (err) {
      isSpeaking.value = false;
      const msg = err instanceof Error ? err.message : String(err);
      ElMessage.error({ message: msg, offset: 40 });
    }
  }

  /** 试听「文字生成语音」的结果（macOS / Windows 均走 edge-tts 在线合成） */
  async function previewGeneratedVoice(text: string): Promise<void> {
    if (!text.trim()) {
      ElMessage.warning({ message: "请先输入要生成的文字", offset: 40 });
      return;
    }
    stopSpeaking();
    isSpeaking.value = true;
    try {
      await playEdgeAudio(await synthesizeText(text));
    } catch (err) {
      isSpeaking.value = false;
      const msg = err instanceof Error ? err.message : String(err);
      ElMessage.error({ message: msg, offset: 40 });
    }
  }

  /** 用当前音色把文字合成音频并保存进「我的语音」 */
  async function saveGeneratedVoice(text: string): Promise<void> {
    const content = text.trim();
    if (!content) {
      ElMessage.warning({ message: "请先输入要生成的文字", offset: 40 });
      return;
    }
    try {
      const base64 = await synthesizeText(content);
      const fileName = `tts-${Date.now()}.mp3`;
      const name = content.length > 16 ? `${content.slice(0, 16)}…` : content;
      const track = await ipc.app.saveUserVoiceRecording({
        fileName,
        base64,
        name,
        recorded: false,
      });
      voiceTracks.value = [...voiceTracks.value, userVoiceTrackToItem(track)];
      await saveVoiceMeta();
      ElMessage.success({ message: "已保存到我的语音", offset: 40 });
      maybeStartVoiceLoop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ElMessage.error({ message: msg, offset: 40 });
    }
  }

  /** 应用预设：自动匹配音色并填充语速/音调 */
  function applyPreset(preset: TtsPreset): void {
    // 按关键词匹配系统声音（Windows 微软声音 name 含拼音 "Yunxi"，也可能含中文 "云希"）
    const matched = voices.value.find((v) =>
      preset.matchKeywords.some(
        (kw) =>
          v.name.toLowerCase().includes(kw.toLowerCase()) ||
          v.voiceURI.toLowerCase().includes(kw.toLowerCase()),
      ),
    );
    if (matched) {
      selectedVoiceURI.value = matched.voiceURI;
    } else {
      // 未找到指定音色时，回退到第一个可用中文声音，保证预设一定能生效
      const fallback = voices.value[0];
      if (fallback) {
        selectedVoiceURI.value = fallback.voiceURI;
        ElMessage.info({
          message: `未找到「${preset.voice}」，已使用「${fallback.name}」并套用语速/音调`,
          offset: 40,
        });
      } else {
        ElMessage.warning({ message: "系统暂无可用中文声音", offset: 40 });
      }
    }
    rate.value = preset.rate;
    pitchHz.value = preset.pitchHz;
  }

  function saveTts(): void {
    saveTtsSettings();
    ElMessage.success({ message: "音色配置已保存", offset: 40 });
  }

  // ---------- 我的语音 ----------
  function userVoiceTrackToItem(t: UserVoiceTrack): VoiceItem {
    return {
      id: t.id,
      name: t.name,
      url: t.url,
      fileName: t.fileName,
      recorded: t.recorded,
    };
  }

  async function saveVoiceMeta(): Promise<void> {
    const meta: VoiceMeta = {
      version: 1,
      tracks: voiceTracks.value.map((v) => ({
        id: v.id,
        name: v.name,
        fileName: v.fileName,
        url: v.url,
        size: 0,
        addedAt: Date.now(),
        recorded: v.recorded,
      })),
      currentId:
        voiceCurrentIndex.value >= 0 ? (voiceTracks.value[voiceCurrentIndex.value]?.id ?? "") : "",
    };
    try {
      await ipc.app.setVoiceMeta({ meta });
    } catch (err) {
      console.error("[speech] 保存语音元数据失败:", err);
    }
  }

  /** 初始化：加载磁盘语音列表并对账 */
  async function initVoices(): Promise<void> {
    try {
      const [meta, diskList] = await Promise.all([ipc.app.getVoiceMeta(), ipc.app.listUserVoice()]);
      const diskByName = new Map(diskList.map((t) => [t.fileName, t]));
      const merged: UserVoiceTrack[] = [];
      for (const t of meta.tracks ?? []) {
        const onDisk = diskByName.get(t.fileName);
        if (onDisk) {
          // 保留用户自定义名称与来源标记
          merged.push({ ...onDisk, id: t.id, name: t.name || onDisk.name, recorded: t.recorded });
          diskByName.delete(t.fileName);
        }
      }
      for (const t of diskByName.values()) merged.push(t);
      voiceTracks.value = merged.map(userVoiceTrackToItem);
      if (meta.currentId) {
        voiceCurrentIndex.value = voiceTracks.value.findIndex((t) => t.id === meta.currentId);
      }
    } catch (err) {
      console.error("[speech] 初始化语音列表失败:", err);
    }
  }

  async function addUserVoice(): Promise<void> {
    try {
      const imported = await ipc.app.addUserVoice();
      if (imported.length === 0) return;
      voiceTracks.value = [...voiceTracks.value, ...imported.map(userVoiceTrackToItem)];
      await saveVoiceMeta();
      ElMessage.success({ message: `已导入 ${imported.length} 条语音`, offset: 40 });
      maybeStartVoiceLoop();
    } catch (err) {
      console.error("[speech] 导入语音失败:", err);
      ElMessage.error({ message: "导入语音失败", offset: 40 });
    }
  }

  /** 保存现场录音：blob -> base64 -> IPC 落盘 */
  async function saveRecording(blob: Blob, name: string): Promise<void> {
    try {
      const base64 = await blobToBase64(blob);
      const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("ogg") ? "ogg" : "webm";
      const fileName = `recording-${Date.now()}.${ext}`;
      const track = await ipc.app.saveUserVoiceRecording({ fileName, base64, name });
      voiceTracks.value = [...voiceTracks.value, userVoiceTrackToItem(track)];
      await saveVoiceMeta();
      ElMessage.success({ message: "录音已保存", offset: 40 });
      maybeStartVoiceLoop();
    } catch (err) {
      console.error("[speech] 保存录音失败:", err);
      ElMessage.error({ message: "保存录音失败", offset: 40 });
    }
  }

  /** 重命名一条语音的显示名称（不改动磁盘文件） */
  async function renameVoice(index: number, name: string): Promise<void> {
    const track = voiceTracks.value[index];
    const trimmed = name.trim();
    if (!track || !trimmed) return;
    voiceTracks.value[index] = { ...track, name: trimmed };
    await saveVoiceMeta();
    ElMessage.success({ message: "名称已更新", offset: 40 });
  }

  async function removeVoice(index: number): Promise<void> {
    const track = voiceTracks.value[index];
    if (!track) return;
    const wasCurrent = index === voiceCurrentIndex.value;
    try {
      await ipc.app.deleteUserVoice({ fileName: track.fileName });
    } catch (err) {
      console.error("[speech] 删除语音失败:", err);
    }
    voiceTracks.value = voiceTracks.value.filter((_, i) => i !== index);
    if (voiceFixedIndex.value >= voiceTracks.value.length) {
      voiceFixedIndex.value = Math.max(0, voiceTracks.value.length - 1);
    } else if (index < voiceFixedIndex.value) {
      voiceFixedIndex.value -= 1;
    }
    if (voiceTracks.value.length === 0) {
      stopVoicePlayback();
      voiceCurrentIndex.value = -1;
    } else if (wasCurrent) {
      voiceCurrentIndex.value = Math.min(index, voiceTracks.value.length - 1);
      if (voiceIsPlaying.value) playVoice(voiceCurrentIndex.value);
    } else if (index < voiceCurrentIndex.value) {
      voiceCurrentIndex.value -= 1;
    }
    await saveVoiceMeta();
  }

  async function clearAllVoices(): Promise<void> {
    for (const t of voiceTracks.value) {
      try {
        await ipc.app.deleteUserVoice({ fileName: t.fileName });
      } catch {
        /* ignore */
      }
    }
    stopVoicePlayback();
    voiceTracks.value = [];
    voiceCurrentIndex.value = -1;
    voiceFixedIndex.value = 0;
    await saveVoiceMeta();
  }

  function ensureAudio(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio();
      audio.addEventListener("ended", onVoiceEnded);
      audio.addEventListener("play", () => {
        voiceIsPlaying.value = true;
      });
      audio.addEventListener("pause", () => {
        voiceIsPlaying.value = false;
      });
    }
    return audio;
  }

  function onVoiceEnded(): void {
    voiceIsPlaying.value = false;
    // 未启用「我的语音」时只在试听当前这一条，不自动连播
    if (!voiceEnabled.value) return;
    scheduleNextVoice();
  }

  function clearNextTimer(): void {
    if (voiceNextTimer !== null) {
      window.clearTimeout(voiceNextTimer);
      voiceNextTimer = null;
    }
  }

  /** 按「间隔 / 持续播放」设置，安排下一轮播报 */
  function scheduleNextVoice(): void {
    clearNextTimer();
    if (!voiceEnabled.value || voiceTracks.value.length === 0) return;
    let delayMs = 0;
    if (!voiceContinuous.value) {
      const min = Math.max(0, Math.min(voiceIntervalMin.value, voiceIntervalMax.value));
      const max = Math.max(min, voiceIntervalMax.value);
      delayMs = Math.floor((min + Math.random() * (max - min)) * 1000);
    }
    voiceNextTimer = window.setTimeout(() => {
      voiceNextTimer = null;
      if (!voiceEnabled.value) return;
      playNextVoice();
    }, delayMs);
  }

  /**
   * 播报设置（持续播放/间隔）变化后调用：
   * 若总开关已开且正处于「等待下一条」的空闲状态，清掉旧计时器按新设置重新调度
   * （勾选持续播放时会立即播下一条，不必干等旧的间隔倒计时）
   */
  function refreshVoiceSchedule(): void {
    if (!voiceEnabled.value) return;
    if (voiceTracks.value.length === 0) return;
    // 正在播放中不用管：ended 之后会按新设置调度
    if (voiceIsPlaying.value) return;
    scheduleNextVoice();
  }

  /** 按当前播报方式取下一条并播放 */
  function playNextVoice(): void {
    if (voiceTracks.value.length === 0) return;
    if (voicePlayMode.value === "fixed") {
      const idx =
        voiceFixedIndex.value >= 0 && voiceFixedIndex.value < voiceTracks.value.length
          ? voiceFixedIndex.value
          : 0;
      playVoice(idx);
      return;
    }
    if (voicePlayMode.value === "random") {
      playRandomVoice();
      return;
    }
    const next = (voiceCurrentIndex.value + 1) % voiceTracks.value.length;
    playVoice(next);
  }

  function playVoice(index: number): void {
    if (index < 0 || index >= voiceTracks.value.length) return;
    voiceCurrentIndex.value = index;
    const a = ensureAudio();
    a.src = voiceTracks.value[index].url;
    a.play().catch(() => {
      voiceIsPlaying.value = false;
    });
  }

  function playRandomVoice(): void {
    if (voiceTracks.value.length === 0) return;
    let idx = Math.floor(Math.random() * voiceTracks.value.length);
    if (voiceTracks.value.length > 1 && idx === voiceCurrentIndex.value) {
      idx = (idx + 1) % voiceTracks.value.length;
    }
    playVoice(idx);
  }

  function toggleVoicePlay(): void {
    if (voiceTracks.value.length === 0) {
      ElMessage.warning({ message: "暂无语音，请先导入或录音", offset: 40 });
      return;
    }
    const a = ensureAudio();
    if (voiceIsPlaying.value) {
      a.pause();
      clearNextTimer();
    } else {
      if (voiceCurrentIndex.value < 0 || !a.currentSrc) {
        playNextVoice();
      } else {
        a.play().catch(() => {
          voiceIsPlaying.value = false;
        });
      }
    }
  }

  function stopVoicePlayback(): void {
    clearNextTimer();
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    voiceIsPlaying.value = false;
  }

  /** 切换播报方式（切到固定播放时校正目标下标） */
  function setVoicePlayMode(mode: VoicePlayMode): void {
    voicePlayMode.value = mode;
    if (mode === "fixed") {
      if (voiceFixedIndex.value < 0 || voiceFixedIndex.value >= voiceTracks.value.length) {
        voiceFixedIndex.value = 0;
      }
    }
  }

  /** 若总开关已开启且当前空闲（没在播、也没有待播计时），立即开始循环播报 */
  function maybeStartVoiceLoop(): void {
    if (!voiceEnabled.value) return;
    if (voiceTracks.value.length === 0) return;
    if (voiceIsPlaying.value || voiceNextTimer !== null) return;
    playNextVoice();
  }

  /** 关闭「我的语音」循环（总开关置否 + 停止播放） */
  function disableVoiceLoop(): void {
    voiceEnabled.value = false;
    stopVoicePlayback();
  }

  /** 关闭「互动引导」（开关置否 + 停止定时/播报） */
  function disableGuide(): void {
    guide.value.enabled = false;
    saveGuideSettings();
    stopGuide();
    stopSpeaking();
    stopGuideVoice();
  }

  /**
   * 开启/关闭「我的语音」总开关；开启时立即按播报方式开始循环。
   * 与「互动引导」互斥：开启一方会自动关闭另一方的开关。
   */
  function setVoiceEnabled(enabled: boolean): void {
    voiceEnabled.value = enabled;
    if (enabled) {
      if (guide.value.enabled) disableGuide();
      if (voiceTracks.value.length === 0) {
        ElMessage.info({ message: "暂无语音，请先导入或录制语音", offset: 40 });
        return;
      }
      maybeStartVoiceLoop();
    } else {
      stopVoicePlayback();
    }
  }

  // ---------- 互动引导 ----------
  /** 获取下一条待播报话术（不重复，直到全部轮播一轮） */
  function pickNextScript(): string | null {
    const scripts = guide.value.scripts.filter((s) => s.trim());
    if (scripts.length === 0) return null;
    const remaining = scripts.filter((s) => !playedScripts.value.has(s));
    const pool = remaining.length > 0 ? remaining : scripts;
    if (pool.length === 0) return null;
    let script: string;
    if (guide.value.random) {
      script = pool[Math.floor(Math.random() * pool.length)];
    } else {
      script = pool[0];
    }
    playedScripts.value.add(script);
    if (playedScripts.value.size >= scripts.length) {
      playedScripts.value.clear();
    }
    return script;
  }

  /** 触发一次引导播报 */
  function triggerGuide(): void {
    const scripts = guide.value.scripts.filter((s) => s.trim());
    if (scripts.length === 0) return;

    // 勾选「用我的语音朗读」且有语音时，用独立 Audio 播放语音替代 TTS（不干扰循环播放）
    if (voiceForGuide.value && voiceTracks.value.length > 0) {
      playGuideVoice();
      return;
    }

    const script = pickNextScript();
    if (script) speak(script);
  }

  /** 引导播报专用 Audio（懒创建） */
  function ensureGuideAudio(): HTMLAudioElement {
    if (!guideAudio) {
      guideAudio = new Audio();
    }
    return guideAudio;
  }

  /** 引导播报：按播报方式取一条「我的语音」，用独立 Audio 播放（与循环播放互不干扰） */
  function playGuideVoice(): void {
    if (voiceTracks.value.length === 0) return;
    let idx: number;
    if (voicePlayMode.value === "fixed") {
      idx =
        voiceFixedIndex.value >= 0 && voiceFixedIndex.value < voiceTracks.value.length
          ? voiceFixedIndex.value
          : 0;
    } else if (voicePlayMode.value === "random") {
      idx = Math.floor(Math.random() * voiceTracks.value.length);
    } else {
      idx = (guideVoiceIndex.value + 1) % voiceTracks.value.length;
    }
    guideVoiceIndex.value = idx;
    const a = ensureGuideAudio();
    a.src = voiceTracks.value[idx].url;
    a.play().catch(() => {
      /* 忽略：自动播放被拒等场景 */
    });
  }

  function stopGuideVoice(): void {
    if (guideAudio) {
      guideAudio.pause();
      guideAudio.currentTime = 0;
    }
  }

  function scheduleNextGuide(): void {
    if (guideTimer !== null) {
      window.clearTimeout(guideTimer);
      guideTimer = null;
    }
    if (!guide.value.enabled) return;
    const { minInterval, maxInterval } = guide.value;
    const min = Math.max(1, Math.min(minInterval, maxInterval));
    const max = Math.max(min, maxInterval);
    const delay = Math.floor((min + Math.random() * (max - min)) * 1000);
    guideTimer = window.setTimeout(() => {
      triggerGuide();
      scheduleNextGuide();
    }, delay);
  }

  function startGuide(): void {
    playedScripts.value.clear();
    scheduleNextGuide();
  }

  function stopGuide(): void {
    if (guideTimer !== null) {
      window.clearTimeout(guideTimer);
      guideTimer = null;
    }
  }

  function toggleGuide(enabled: boolean): void {
    if (enabled) {
      // 与「我的语音」互斥：开启引导时自动关闭我的语音循环
      if (voiceEnabled.value) disableVoiceLoop();
      guide.value.enabled = true;
      saveGuideSettings();
      startGuide();
    } else {
      disableGuide();
    }
  }

  /** 设置「用我的语音朗读」（引导播报用语音替代 TTS），持久化 */
  function setVoiceForGuide(v: boolean): void {
    voiceForGuide.value = v;
    saveVoiceSettings();
    if (!v) stopGuideVoice();
  }

  function saveGuide(): void {
    saveGuideSettings();
    // 若引导已开启，用新配置重新调度
    if (guide.value.enabled) {
      startGuide();
    }
    ElMessage.success({ message: "引导设置已保存", offset: 40 });
  }

  // ---------- 初始化 ----------
  let inited = false;
  async function init(): Promise<void> {
    if (inited) return;
    inited = true;
    loadTtsSettings();
    loadGuideSettings();
    loadVoiceSettings();

    // 加载系统语音（异步就绪）
    if (window.speechSynthesis) {
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    await initVoices();

    // 若引导默认开启，启动调度
    if (guide.value.enabled) startGuide();
  }

  // ---------- getters ----------
  const currentVoice = computed<VoiceItem | null>(() => {
    if (voiceCurrentIndex.value < 0 || voiceCurrentIndex.value >= voiceTracks.value.length)
      return null;
    return voiceTracks.value[voiceCurrentIndex.value];
  });

  const ratePercent = computed(() => Math.round((rate.value - 1) * 100));

  return {
    // TTS
    voices,
    selectedVoiceURI,
    rate,
    pitchHz,
    isSpeaking,
    ratePercent,
    loadVoices,
    speak,
    stopSpeaking,
    applyPreset,
    saveTts,
    previewGeneratedVoice,
    saveGeneratedVoice,
    // 平台标识（macOS 走 edge-tts）
    isMac: IS_MAC,
    // guide
    guide,
    playedScripts,
    triggerGuide,
    toggleGuide,
    saveGuide,
    // voice
    voiceTracks,
    voiceEnabled,
    voicePlayMode,
    voiceFixedIndex,
    voiceIntervalMin,
    voiceIntervalMax,
    voiceContinuous,
    voiceCurrentIndex,
    voiceIsPlaying,
    voiceForGuide,
    guideVoiceIndex,
    currentVoice,
    init,
    addUserVoice,
    saveRecording,
    renameVoice,
    removeVoice,
    clearAllVoices,
    playVoice,
    playNextVoice,
    setVoicePlayMode,
    setVoiceEnabled,
    setVoiceForGuide,
    playGuideVoice,
    refreshVoiceSchedule,
    toggleVoicePlay,
    stopVoicePlayback,
    playRandomVoice,
  };
});

// ===================== 工具 =====================

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去掉 data:audio/webm;base64, 前缀
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
