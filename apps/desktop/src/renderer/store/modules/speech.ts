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
    key: "storyteller",
    label: "深沉故事",
    voice: "zh-CN-YunjianNeural",
    matchKeywords: ["Yunjian", "云健"],
    rate: 0.95,
    pitchHz: -5,
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
  // 粤语
  {
    voiceURI: "zh-HK-HiuGaaiNeural",
    name: "晓佳（女，粤语）",
    lang: "zh-HK",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-HK-HiuMaanNeural",
    name: "晓曼（女，粤语）",
    lang: "zh-HK",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-HK-WanLungNeural",
    name: "云龙（男，粤语）",
    lang: "zh-HK",
    localService: false,
    default: false,
  },
  // 台湾腔
  {
    voiceURI: "zh-TW-HsiaoChenNeural",
    name: "晓臻（女，台湾腔）",
    lang: "zh-TW",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-TW-HsiaoYuNeural",
    name: "晓语（女，台湾腔）",
    lang: "zh-TW",
    localService: false,
    default: false,
  },
  {
    voiceURI: "zh-TW-YunJheNeural",
    name: "云哲（男，台湾腔）",
    lang: "zh-TW",
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
  /** 加载可用语音列表：统一使用 edge-tts 微软神经声音（跨平台，音质一致）。
   *  离线朗读时 speak() 会自动回退到本地 Web Speech。 */
  function loadVoices(): void {
    voices.value = EDGE_TTS_CHINESE_VOICES;
    // 历史上可能保存过 Edge 不支持的音色，这里纠正为第一个可用音色
    const valid = EDGE_TTS_CHINESE_VOICES.some((v) => v.voiceURI === selectedVoiceURI.value);
    if (!valid) {
      selectedVoiceURI.value = EDGE_TTS_CHINESE_VOICES[0].voiceURI;
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

  /** 读取用户设置的 TTS 音量（0~1），默认 1.0（最大音量） */
  function getTtsVolume(): number {
    const raw = localStorage.getItem("tts-volume");
    if (raw === null) return 1.0; // 未设置过，默认最大音量
    const v = Number(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 1.0;
  }

  /** 把音频元素的输出设备切到用户选择的设备。带超时保护，避免 setSinkId 卡住导致播放永远不开始。 */
  async function applyOutputDevice(audioEl: HTMLAudioElement): Promise<void> {
    const deviceId = localStorage.getItem("audio-output-device-id") || "";
    if (!deviceId || deviceId === "default") return;
    if (typeof audioEl.setSinkId !== "function") return;
    try {
      await Promise.race([
        audioEl.setSinkId(deviceId),
        new Promise((_, reject) => setTimeout(() => reject(new Error("sinkId timeout")), 1000)),
      ]);
    } catch {
      /* 设备不存在/超时：忽略，继续用默认设备播放 */
    }
  }

  /**
   * 应用启动时自动选中系统默认播放设备。
   * 仅当能精确匹配到系统默认设备时才设置，避免选错设备导致无声。
   * 匹配不到时不设置，音频走系统默认输出（setSinkId 不调用）。
   */
  async function ensureDefaultOutputDevice(): Promise<void> {
    const saved = localStorage.getItem("audio-output-device-id");
    if (saved) return; // 已有选择，不覆盖

    try {
      // 先触发一次 getUserMedia，让 enumerateDevices 能拿到 label
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch { /* 忽略 */ }

      const list = await navigator.mediaDevices.enumerateDevices();
      const seen = new Set<string>();
      const devices = list
        .filter((d) => d.kind === "audiooutput")
        .filter((d) => {
          if (!d.label || !d.deviceId) return false;
          if (/^(default|system)\b/i.test(d.label)) return false;
          const key = d.label.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      if (devices.length === 0) return;

      // 拿系统默认设备名，精确匹配才设置；匹配不到则不设置（走系统默认输出）
      try {
        const defaultName: string | null = await ipc.app.getDefaultAudioDevice();
        const matched = defaultName
          ? devices.find((d) => d.label.toLowerCase().includes(defaultName.toLowerCase()))
          : null;
        if (matched) {
          localStorage.setItem("audio-output-device-id", matched.deviceId);
          window.dispatchEvent(new CustomEvent("audio-output-device-change", { detail: matched.deviceId }));
        }
      } catch { /* 忽略 */ }
    } catch { /* 忽略 */ }
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
      // 监听输出设备切换
      window.addEventListener("audio-output-device-change", () => void applyOutputDevice(edgeAudio!));
    }
    // 暂停当前播放；设置新 src 会自动中断旧播放并加载新音频
    edgeAudio.pause();
    await applyOutputDevice(edgeAudio);
    edgeAudio.volume = getTtsVolume();
    edgeAudio.src = url;
    try {
      await edgeAudio.play();
    } catch (err) {
      // 播放被新请求中断（AbortError / interrupted）属正常情况，不视为错误
      const name = err instanceof Error ? err.name : "";
      const msg = err instanceof Error ? err.message : String(err);
      if (name === "AbortError" || msg.includes("interrupted")) {
        return;
      }
      isSpeaking.value = false;
      throw err;
    }
  }

  /** 把当前选中的声音映射为 edge-tts 可用的 ShortName。
   *  声音列表已统一为 edge-tts 神经声音，selectedVoiceURI 即为 ShortName。 */
  function resolveEdgeVoice(): string {
    return selectedVoiceURI.value || "zh-CN-XiaoxiaoNeural";
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

  /** 用当前配置朗读一段文本。优先 edge-tts（跨平台神经声音），失败回退本地 Web Speech。 */
  function speak(text: string): void {
    if (!text || !text.trim()) return;
    void speakWithFallback(text);
  }

  /** edge-tts 合成失败时回退到系统 Web Speech，保证离线也能出声 */
  async function speakWithFallback(text: string): Promise<void> {
    try {
      await speakEdgeTts(text);
    } catch {
      // edge-tts 失败（离线/网络问题）：回退本地系统声音
      if (!window.speechSynthesis) return;
      stopSpeaking();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate.value;
      u.pitch = hzToPitch(pitchHz.value);
      u.volume = getTtsVolume();
      u.lang = "zh-CN";
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
      ElMessage.info({ message: "在线音色不可用，已使用系统声音朗读", offset: 40 });
    }
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
      window.addEventListener("audio-output-device-change", () => void applyOutputDevice(guideAudio!));
    }
    return guideAudio;
  }

  /** 引导播报：按播报方式取一条「我的语音」，用独立 Audio 播放（与循环播放互不干扰） */
  async function playGuideVoice(): Promise<void> {
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
    await applyOutputDevice(a);
    a.volume = getTtsVolume();
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

    // 加载语音列表（统一使用 edge-tts 神经声音，不依赖系统 speechSynthesis）
    loadVoices();

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
    ensureDefaultOutputDevice,
    saveTts,
    previewGeneratedVoice,
    saveGeneratedVoice,
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
