import { app, dialog, BrowserWindow } from "electron";
import { ensureDir, copy, remove, readdir, stat, writeFile } from "fs-extra";
import { existsSync } from "fs";
import { join, extname, basename, dirname } from "path";
import Store from "electron-store";
import type { SaveUserVoiceRecordingArgs, UserVoiceTrack, VoiceMeta } from "ipc-contract";

/** 用户语音的落盘目录：<userData>/bg-voice-user */
const USER_VOICE_DIR = join(app.getPath("userData"), "bg-voice-user");

/** 允许的音频扩展名（小写，含点） */
const ALLOWED_EXTS = new Set([".mp3", ".wav", ".m4a", ".webm", ".ogg"]);

/** 确保用户语音目录存在 */
export async function ensureUserVoiceDir(): Promise<void> {
  await ensureDir(USER_VOICE_DIR);
}

/** 生成不冲突的目标文件名：原名 + " (n)" 序号 */
function uniqueFileName(dir: string, fileName: string): string {
  const ext = extname(fileName);
  const base = basename(fileName, ext);
  let candidate = fileName;
  let n = 1;
  while (existsSync(join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

function makeId(): string {
  return `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 生成自定义协议 URL：app-user-music://voice/<encoded fileName>
 * 与音乐共用同一协议 scheme，通过 host 区分 music/voice，由主进程 protocol.handle 按 host 路由到不同目录。
 */
function fileUrl(fileName: string): string {
  return `app-user-music://voice/${encodeURIComponent(fileName)}`;
}

/**
 * 打开原生文件选择框，把选中的音频拷贝到 userData/bg-voice-user 目录。
 * 返回成功导入的曲目元数据列表（取消选择返回空数组）。
 */
export async function addUserVoice(): Promise<UserVoiceTrack[]> {
  await ensureUserVoiceDir();
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(window ?? undefined, {
    title: "选择语音文件",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "音频文件", extensions: ["mp3", "wav", "m4a", "webm", "ogg"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return [];

  const imported: UserVoiceTrack[] = [];
  for (const srcPath of result.filePaths) {
    const ext = extname(srcPath).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    const fileName = uniqueFileName(USER_VOICE_DIR, basename(srcPath));
    const destPath = join(USER_VOICE_DIR, fileName);
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
        recorded: false,
      });
    } catch (err) {
      console.error("[user-voice] 拷贝失败:", srcPath, err);
    }
  }
  return imported;
}

/**
 * 保存一段现场录音（base64）到 userData/bg-voice-user 目录。
 */
export async function saveUserVoiceRecording(
  args: SaveUserVoiceRecordingArgs,
): Promise<UserVoiceTrack> {
  await ensureUserVoiceDir();
  const fileName = uniqueFileName(USER_VOICE_DIR, args.fileName);
  const destPath = join(USER_VOICE_DIR, fileName);
  const buffer = Buffer.from(args.base64, "base64");
  await writeFile(destPath, buffer);
  const st = await stat(destPath);
  return {
    id: makeId(),
    name: args.name || fileName,
    fileName,
    url: fileUrl(fileName),
    size: st.size,
    addedAt: Date.now(),
    recorded: args.recorded ?? true,
  };
}

/** 删除一个用户语音文件 */
export async function deleteUserVoice(fileName: string): Promise<void> {
  const safeName = basename(fileName);
  const target = join(USER_VOICE_DIR, safeName);
  if (dirname(target) !== USER_VOICE_DIR) return;
  try {
    await remove(target);
  } catch (err) {
    console.error("[user-voice] 删除失败:", fileName, err);
  }
}

/** 扫描 userData/bg-voice-user 目录，返回所有语音曲目（用于启动对账） */
export async function listUserVoice(): Promise<UserVoiceTrack[]> {
  await ensureUserVoiceDir();
  const files = await readdir(USER_VOICE_DIR);
  const tracks: UserVoiceTrack[] = [];
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    try {
      const st = await stat(join(USER_VOICE_DIR, f));
      if (!st.isFile()) continue;
      tracks.push({
        id: `voice-${st.ctimeMs}-${f}`,
        name: f,
        fileName: f,
        url: fileUrl(f),
        size: st.size,
        addedAt: st.ctimeMs,
        recorded: false,
      });
    } catch {
      /* ignore */
    }
  }
  return tracks;
}

export { USER_VOICE_DIR };

// ===================== 元数据持久化（electron-store） =====================

const META_KEY = "bg-voice-meta";
const CURRENT_VERSION = 1;

const metaStore = new Store<Record<string, string>>({
  name: "voice-meta",
});

function defaultMeta(): VoiceMeta {
  return {
    version: CURRENT_VERSION,
    tracks: [],
    currentId: "",
  };
}

/** 读取语音管理元数据，版本不匹配则返回默认结构 */
export function getVoiceMeta(): VoiceMeta {
  try {
    const raw = metaStore.get(META_KEY) as string | undefined;
    if (!raw) return defaultMeta();
    const parsed = JSON.parse(raw) as Partial<VoiceMeta>;
    if (parsed.version !== CURRENT_VERSION) return defaultMeta();
    return {
      version: CURRENT_VERSION,
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
      currentId: typeof parsed.currentId === "string" ? parsed.currentId : "",
    };
  } catch {
    return defaultMeta();
  }
}

/** 写入语音管理元数据 */
export function setVoiceMeta(meta: VoiceMeta): void {
  metaStore.set(META_KEY, JSON.stringify(meta));
}
