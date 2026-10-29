import { app, dialog, BrowserWindow } from "electron";
import { ensureDir, copy, remove, readdir, stat } from "fs-extra";
import { existsSync } from "fs";
import { join, extname, basename, dirname } from "path";
import Store from "electron-store";
import type { MusicMeta, UserMusicTrack } from "ipc-contract";

/** 用户上传音乐的落盘目录：<userData>/bg-music-user */
const USER_MUSIC_DIR = join(app.getPath("userData"), "bg-music-user");

/** 允许的音频扩展名（小写，含点）—— 仅保留最常见格式 */
const ALLOWED_EXTS = new Set([".mp3", ".wav", ".m4a"]);

/** 确保用户音乐目录存在 */
export async function ensureUserMusicDir(): Promise<void> {
  await ensureDir(USER_MUSIC_DIR);
}

/** 生成不冲突的目标文件名：原名 + " (n)" 序号 */
function uniqueFileName(dir: string, fileName: string): string {
  const ext = extname(fileName);
  const base = basename(fileName, ext);
  let candidate = fileName;
  let n = 1;
  // 同步检查存在性（导入时文件少，开销可忽略）
  while (existsSync(join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

function makeId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 生成自定义协议 URL：app-user-music://music/<encoded fileName>
 * 由主进程 protocol.handle 接管，跨 macOS/Windows 稳定加载媒体（file:// 在 Windows 上对媒体加载不可靠）。
 * 用固定 host "music" 占位，文件名放在 pathname，避免中文文件名被当作 hostname 做 punycode 编码。
 */
function fileUrl(fileName: string): string {
  return `app-user-music://music/${encodeURIComponent(fileName)}`;
}

/**
 * 打开原生文件选择框，把选中的音频拷贝到 userData 目录。
 * 返回成功导入的曲目元数据列表（取消选择返回空数组）。
 */
export async function addUserMusic(): Promise<UserMusicTrack[]> {
  await ensureUserMusicDir();
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(window ?? undefined, {
    title: "选择音乐文件",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "音频文件", extensions: ["mp3", "wav", "m4a"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return [];

  const imported: UserMusicTrack[] = [];
  for (const srcPath of result.filePaths) {
    const ext = extname(srcPath).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    const fileName = uniqueFileName(USER_MUSIC_DIR, basename(srcPath));
    const destPath = join(USER_MUSIC_DIR, fileName);
    try {
      await copy(srcPath, destPath);
      const st = await stat(destPath);
      imported.push({
        id: makeId(),
        name: fileName,
        fileName,
        url: fileUrl(fileName),
        size: st.size,
        addedAt: Date.now(),
      });
    } catch (err) {
      console.error("[user-music] 拷贝失败:", srcPath, err);
    }
  }
  return imported;
}

/** 删除一个用户曲目文件 */
export async function deleteUserMusic(fileName: string): Promise<void> {
  // basename 剥离目录组件，杜绝路径穿越（macOS 的 "/" 与 Windows 的 "\" 均被 basename 处理）
  const safeName = basename(fileName);
  const target = join(USER_MUSIC_DIR, safeName);
  // 二次校验：目标文件的父目录必须就是 USER_MUSIC_DIR，
  // 避免 startsWith 在 "/a/b" 匹配 "/a/bc" 这类边界上的误判（跨平台均适用）。
  if (dirname(target) !== USER_MUSIC_DIR) return;
  try {
    await remove(target);
  } catch (err) {
    console.error("[user-music] 删除失败:", fileName, err);
  }
}

/** 扫描 userData 目录，返回所有用户曲目（用于启动对账） */
export async function listUserMusic(): Promise<UserMusicTrack[]> {
  await ensureUserMusicDir();
  const files = await readdir(USER_MUSIC_DIR);
  const tracks: UserMusicTrack[] = [];
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    try {
      const st = await stat(join(USER_MUSIC_DIR, f));
      if (!st.isFile()) continue;
      tracks.push({
        id: `user-${st.ctimeMs}-${f}`,
        name: f,
        fileName: f,
        url: fileUrl(f),
        size: st.size,
        addedAt: st.ctimeMs,
      });
    } catch {
      /* ignore */
    }
  }
  return tracks;
}

export { USER_MUSIC_DIR };

// ===================== 元数据持久化（electron-store） =====================

const META_KEY = "bg-music-meta";
const CURRENT_VERSION = 1;

const metaStore = new Store<Record<string, string>>({
  name: "music-meta",
});

function defaultMeta(): MusicMeta {
  return {
    version: CURRENT_VERSION,
    userTracks: [],
    hiddenBuiltins: [],
    currentId: "",
  };
}

/** 读取背景音乐元数据，版本不匹配则返回默认结构 */
export function getMusicMeta(): MusicMeta {
  try {
    const raw = metaStore.get(META_KEY) as string | undefined;
    if (!raw) return defaultMeta();
    const parsed = JSON.parse(raw) as Partial<MusicMeta>;
    if (parsed.version !== CURRENT_VERSION) return defaultMeta();
    return {
      version: CURRENT_VERSION,
      userTracks: Array.isArray(parsed.userTracks) ? parsed.userTracks : [],
      hiddenBuiltins: Array.isArray(parsed.hiddenBuiltins) ? parsed.hiddenBuiltins : [],
      currentId: typeof parsed.currentId === "string" ? parsed.currentId : "",
    };
  } catch {
    return defaultMeta();
  }
}

/** 写入背景音乐元数据 */
export function setMusicMeta(meta: MusicMeta): void {
  metaStore.set(META_KEY, JSON.stringify(meta));
}
