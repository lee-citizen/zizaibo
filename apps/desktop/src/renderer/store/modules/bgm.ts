import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import { ipc } from "@renderer/utils/ipcRenderer";
import { routeAudioElement } from "@renderer/utils/audio-output";
import type { MusicMeta, UserMusicTrack } from "ipc-contract";

import music1 from "@renderer/assets/bg_music/music_1.mp3";
import music2 from "@renderer/assets/bg_music/music_2.mp3";
import music3 from "@renderer/assets/bg_music/music_3.mp3";
import music4 from "@renderer/assets/bg_music/music_4.mp3";
import music5 from "@renderer/assets/bg_music/music_5.mp3";
import music6 from "@renderer/assets/bg_music/music_6.mp3";
import music7 from "@renderer/assets/bg_music/music_7.mp3";
import music8 from "@renderer/assets/bg_music/music_8.mp3";
import music9 from "@renderer/assets/bg_music/music_9.mp3";
import music10 from "@renderer/assets/bg_music/music_10.mp3";
import music11 from "@renderer/assets/bg_music/music_11.mp3";
import music12 from "@renderer/assets/bg_music/music_12.mp3";
import music13 from "@renderer/assets/bg_music/music_13.mp3";
import music14 from "@renderer/assets/bg_music/music_14.mp3";
import music15 from "@renderer/assets/bg_music/music_15.mp3";
import music16 from "@renderer/assets/bg_music/music_16.mp3";
import music17 from "@renderer/assets/bg_music/music_17.mp3";
import music18 from "@renderer/assets/bg_music/music_18.mp3";
import music19 from "@renderer/assets/bg_music/music_19.mp3";
import music20 from "@renderer/assets/bg_music/music_20.mp3";

interface Track {
  id: string;
  name: string;
  url: string;
  builtin: boolean;
  fileName?: string;
}

type LoopMode = "list" | "single";

interface PersistState {
  volume: number;
  muted: boolean;
  loopMode: LoopMode;
}

const SETTINGS_KEY = "bg-music-settings";
const FAVORITES_KEY = "bg-music-favorites";

/** 内置曲目（构建期打包资源） */
const BUILTIN_TRACKS: Track[] = [
  { id: "builtin-1", name: "music_1.mp3", url: music1, builtin: true },
  { id: "builtin-2", name: "music_2.mp3", url: music2, builtin: true },
  { id: "builtin-3", name: "music_3.mp3", url: music3, builtin: true },
  { id: "builtin-4", name: "music_4.mp3", url: music4, builtin: true },
  { id: "builtin-5", name: "music_5.mp3", url: music5, builtin: true },
  { id: "builtin-6", name: "music_6.mp3", url: music6, builtin: true },
  { id: "builtin-7", name: "music_7.mp3", url: music7, builtin: true },
  { id: "builtin-8", name: "music_8.mp3", url: music8, builtin: true },
  { id: "builtin-9", name: "music_9.mp3", url: music9, builtin: true },
  { id: "builtin-10", name: "music_10.mp3", url: music10, builtin: true },
  { id: "builtin-11", name: "music_11.mp3", url: music11, builtin: true },
  { id: "builtin-12", name: "music_12.mp3", url: music12, builtin: true },
  { id: "builtin-13", name: "music_13.mp3", url: music13, builtin: true },
  { id: "builtin-14", name: "music_14.mp3", url: music14, builtin: true },
  { id: "builtin-15", name: "music_15.mp3", url: music15, builtin: true },
  { id: "builtin-16", name: "music_16.mp3", url: music16, builtin: true },
  { id: "builtin-17", name: "music_17.mp3", url: music17, builtin: true },
  { id: "builtin-18", name: "music_18.mp3", url: music18, builtin: true },
  { id: "builtin-19", name: "music_19.mp3", url: music19, builtin: true },
  { id: "builtin-20", name: "music_20.mp3", url: music20, builtin: true },
];

// 模块级 Audio 单例：整个应用生命周期唯一，路由切换不销毁
let audio: HTMLAudioElement | null = null;
let inited = false;

function loadSettings(): PersistState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistState>;
      return {
        volume:
          typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 100
            ? parsed.volume
            : 100,
        muted: Boolean(parsed.muted),
        loopMode: parsed.loopMode === "single" ? "single" : "list",
      };
    }
  } catch {
    /* ignore */
  }
  return { volume: 100, muted: false, loopMode: "list" };
}

function userTrackToTrack(t: UserMusicTrack): Track {
  return {
    id: t.id,
    name: t.name,
    // 直接使用主进程返回的自定义协议 URL（app-user-music://music/...）
    url: t.url,
    builtin: false,
    fileName: t.fileName,
  };
}

export const useBgmStore = defineStore("bgm", () => {
  // ---- state ----
  const playlist = ref<Track[]>([]);
  const currentIndex = ref<number>(-1);
  const isPlaying = ref(false);
  const volume = ref<number>(100);
  const muted = ref<boolean>(false);
  const loopMode = ref<LoopMode>("list");
  const currentId = ref<string>("");

  // 收藏：本地持久化（track id 集合）
  const favorites = ref<Set<string>>(new Set());
  // 是否只展示收藏
  const showOnlyFavorites = ref(false);

  // 仅内存保存，不落盘
  let userTracksMeta: UserMusicTrack[] = [];
  let hiddenBuiltins: string[] = [];

  // ---- getters ----
  const currentTrack = computed<Track | null>(() => {
    if (currentIndex.value < 0 || currentIndex.value >= playlist.value.length) {
      return null;
    }
    return playlist.value[currentIndex.value];
  });

  // 过滤后的播放列表（用于展示）
  const filteredPlaylist = computed<Track[]>(() => {
    if (!showOnlyFavorites.value) return playlist.value;
    return playlist.value.filter((t) => favorites.value.has(t.id));
  });

  const favoriteCount = computed(() => favorites.value.size);

  // ---- helpers ----
  function loadFavorites(): void {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        favorites.value = new Set(arr);
      }
    } catch {
      /* ignore */
    }
  }

  function saveFavorites(): void {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites.value]));
    } catch {
      /* ignore */
    }
  }

  function saveSettings(): void {
    const data: PersistState = {
      volume: volume.value,
      muted: muted.value,
      loopMode: loopMode.value,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  async function saveMeta(): Promise<void> {
    const meta: MusicMeta = {
      version: 1,
      userTracks: userTracksMeta,
      hiddenBuiltins,
      currentId: currentId.value,
    };
    try {
      await ipc.app.setMusicMeta({ meta });
    } catch (err) {
      console.error("[bgm] 保存元数据失败:", err);
    }
  }

  function rebuildPlaylist(): void {
    const builtins = BUILTIN_TRACKS.filter((b) => !hiddenBuiltins.includes(b.id));
    const users = userTracksMeta.map(userTrackToTrack);
    playlist.value = [...builtins, ...users];
    // 校正 currentIndex
    if (currentId.value) {
      const idx = playlist.value.findIndex((t) => t.id === currentId.value);
      currentIndex.value = idx;
    } else {
      currentIndex.value = -1;
    }
  }

  // ---- audio event handlers ----
  function onPlay(): void {
    isPlaying.value = true;
  }
  function onPause(): void {
    isPlaying.value = false;
  }
  function onEnded(): void {
    if (!audio) return;
    if (loopMode.value === "single") {
      audio.currentTime = 0;
      playAudio();
    } else {
      playNext();
    }
  }
  function onError(): void {
    isPlaying.value = false;
    const name = currentTrack.value?.name ?? "未知曲目";
    ElMessage.error({ message: `播放失败：${name}`, offset: 40 });
  }

  /**
   * 统一的播放入口。
   * 首次设置 src 后立即 play() 可能因音源尚未加载到可播放状态而被拒绝，
   * 此时监听一次 canplay，就绪后自动重试，保证首次点击即出声。
   */
  function playAudio(): void {
    if (!audio) return;
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        if (!audio) return;
        audio.addEventListener(
          "canplay",
          () => {
            audio?.play().catch(() => {
              isPlaying.value = false;
            });
          },
          { once: true },
        );
      });
    }
  }

  // ---- 初始化 ----
  async function init(): Promise<void> {
    if (inited) return;
    inited = true;

    const settings = loadSettings();
    volume.value = settings.volume;
    muted.value = settings.muted;
    loopMode.value = settings.loopMode;

    // 加载收藏
    loadFavorites();

    audio = new Audio();
    // auto：设置 src 后积极缓冲，避免首次 play 因数据未就绪被拒绝而无声
    audio.preload = "auto";
    // createMediaElementSource 需要媒体元素 crossOrigin=anonymous 才能读取跨域协议的音频流
    audio.crossOrigin = "anonymous";
    audio.volume = volume.value / 100;
    audio.muted = muted.value;

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    // 接入统一音频路由：输出设备由 AudioContext.setSinkId 统一控制
    routeAudioElement(audio);

    // 加载元数据 + 对账磁盘
    try {
      const [meta, diskList] = await Promise.all([ipc.app.getMusicMeta(), ipc.app.listUserMusic()]);
      hiddenBuiltins = meta.hiddenBuiltins ?? [];
      currentId.value = meta.currentId ?? "";

      // 对账：以磁盘为准，元数据里有但磁盘没有的丢弃；磁盘有但元数据没有的补入
      const diskByName = new Map(diskList.map((t) => [t.fileName, t]));
      const merged: UserMusicTrack[] = [];
      for (const t of meta.userTracks ?? []) {
        const onDisk = diskByName.get(t.fileName);
        if (onDisk) {
          // 优先采用磁盘扫描结果（含正确的自定义协议 url），保留元数据中的 id
          merged.push({ ...onDisk, id: t.id });
          diskByName.delete(t.fileName);
        }
      }
      // 磁盘孤儿补入
      for (const t of diskByName.values()) {
        merged.push(t);
      }
      userTracksMeta = merged;
      if (merged.length !== (meta.userTracks?.length ?? 0)) {
        await saveMeta();
      }

      rebuildPlaylist();
    } catch (err) {
      console.error("[bgm] 初始化加载失败:", err);
      rebuildPlaylist();
    }
  }

  // ---- 播放控制 ----
  function playTrack(index: number): void {
    if (!audio) return;
    if (index < 0 || index >= playlist.value.length) return;
    const track = playlist.value[index];
    if (!track) return;

    // 点击当前曲目：切换播放 / 暂停，而不是从头重播
    if (index === currentIndex.value) {
      if (isPlaying.value) {
        audio.pause();
      } else {
        // 应用重启后 currentIndex 由持久化 currentId 恢复，但 audio.src 可能尚未设置
        if (!audio.currentSrc) {
          audio.src = track.url;
        }
        playAudio();
      }
      return;
    }

    // 点击其它曲目：切换并从头播放
    currentIndex.value = index;
    currentId.value = track.id;
    void saveMeta();
    audio.src = track.url;
    playAudio();
  }

  function togglePlay(): void {
    if (!audio) return;
    if (playlist.value.length === 0) {
      ElMessage.warning({ message: "播放列表为空，请先添加音乐", offset: 40 });
      return;
    }
    if (currentIndex.value < 0) {
      playTrack(0);
      return;
    }
    if (isPlaying.value) {
      audio.pause();
    } else {
      // 应用重启后 currentIndex 由持久化 currentId 恢复，但 audio.src 尚未设置，
      // 此时直接 playAudio() 会因无音源而失败；需先通过 playTrack 设置 src。
      if (!audio.currentSrc) {
        playTrack(currentIndex.value);
      } else {
        playAudio();
      }
    }
  }

  function stop(): void {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    isPlaying.value = false;
  }

  function playPrev(): void {
    if (playlist.value.length === 0) return;
    if (currentIndex.value <= 0) {
      playTrack(playlist.value.length - 1);
    } else {
      playTrack(currentIndex.value - 1);
    }
  }

  function playNext(): void {
    if (playlist.value.length === 0) return;
    if (currentIndex.value >= playlist.value.length - 1) {
      playTrack(0);
    } else {
      playTrack(currentIndex.value + 1);
    }
  }

  function toggleLoopMode(): void {
    loopMode.value = loopMode.value === "list" ? "single" : "list";
    saveSettings();
    ElMessage.info({
      message: loopMode.value === "list" ? "已切换为列表循环" : "已切换为单曲循环",
      offset: 40,
    });
  }

  function setVolume(val: number): void {
    volume.value = val;
    if (audio) audio.volume = val / 100;
    saveSettings();
  }

  function toggleMute(): void {
    muted.value = !muted.value;
    if (audio) audio.muted = muted.value;
    saveSettings();
  }

  // ---- 列表管理 ----
  async function addUserMusic(): Promise<void> {
    try {
      const imported = await ipc.app.addUserMusic();
      if (imported.length === 0) return;
      userTracksMeta = [...userTracksMeta, ...imported];
      rebuildPlaylist();
      await saveMeta();
      ElMessage.success({ message: `已添加 ${imported.length} 首音乐`, offset: 40 });
    } catch (err) {
      console.error("[bgm] 添加音乐失败:", err);
      ElMessage.error({ message: "添加音乐失败", offset: 40 });
    }
  }

  async function removeTrack(index: number): Promise<void> {
    const track = playlist.value[index];
    if (!track) return;
    const wasCurrent = index === currentIndex.value;

    if (track.builtin) {
      // 内置曲目：仅隐藏，不删文件
      if (!hiddenBuiltins.includes(track.id)) {
        hiddenBuiltins = [...hiddenBuiltins, track.id];
      }
    } else {
      // 用户曲目：删磁盘文件 + 移除元数据
      if (track.fileName) {
        await ipc.app.deleteUserMusic({ fileName: track.fileName });
      }
      userTracksMeta = userTracksMeta.filter((t) => t.id !== track.id);
    }

    rebuildPlaylist();

    if (playlist.value.length === 0) {
      stop();
      currentIndex.value = -1;
      currentId.value = "";
    } else if (wasCurrent) {
      const nextIndex = Math.min(index, playlist.value.length - 1);
      if (isPlaying.value) {
        playTrack(nextIndex);
      } else {
        currentIndex.value = nextIndex;
        currentId.value = playlist.value[nextIndex]?.id ?? "";
      }
    } else if (index < currentIndex.value) {
      currentIndex.value -= 1;
    }

    await saveMeta();
  }

  async function restoreBuiltin(): Promise<void> {
    hiddenBuiltins = [];
    rebuildPlaylist();
    await saveMeta();
    ElMessage.success({ message: "已恢复内置音乐", offset: 40 });
  }

  async function clearAll(): Promise<void> {
    // 删除所有用户曲目磁盘文件
    for (const t of userTracksMeta) {
      await ipc.app.deleteUserMusic({ fileName: t.fileName });
    }
    userTracksMeta = [];
    // 隐藏全部内置
    hiddenBuiltins = BUILTIN_TRACKS.map((b) => b.id);
    stop();
    currentIndex.value = -1;
    currentId.value = "";
    rebuildPlaylist();
    await saveMeta();
    ElMessage.info({ message: "已清空播放列表", offset: 40 });
  }

  // ---- 收藏 ----
  function isFavorite(trackId: string): boolean {
    return favorites.value.has(trackId);
  }

  function toggleFavorite(trackId: string): void {
    const next = new Set(favorites.value);
    if (next.has(trackId)) {
      next.delete(trackId);
    } else {
      next.add(trackId);
    }
    favorites.value = next;
    saveFavorites();
  }

  function toggleFavoriteFilter(): void {
    showOnlyFavorites.value = !showOnlyFavorites.value;
  }

  return {
    // state
    playlist,
    currentIndex,
    isPlaying,
    volume,
    muted,
    loopMode,
    currentTrack,
    favorites,
    showOnlyFavorites,
    filteredPlaylist,
    favoriteCount,
    // actions
    init,
    playTrack,
    togglePlay,
    stop,
    playPrev,
    playNext,
    toggleLoopMode,
    setVolume,
    toggleMute,
    addUserMusic,
    removeTrack,
    restoreBuiltin,
    clearAll,
    isFavorite,
    toggleFavorite,
    toggleFavoriteFilter,
  };
});
