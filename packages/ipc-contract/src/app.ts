/**
 * app 域：应用基础功能（invoke：渲染进程 -> 主进程）
 *
 * 本文件只声明类型，渲染进程会以 import type 的方式引用，不允许引入任何运行时代码。
 * 对应主进程实现：@main/services/ipc-main-handle 的 appIpcHandlers
 */

/** 用户上传的音乐曲目（元数据，文件落在 userData/bg-music-user/） */
export interface UserMusicTrack {
  /** 唯一 id，形如 user-<addedAt>-<random> */
  id: string;
  /** 显示名称（通常等于 fileName） */
  name: string;
  /** 磁盘真实文件名（含扩展名） */
  fileName: string;
  /** 可直接用于 audio.src 的 file:// URL */
  url: string;
  /** 文件大小（字节） */
  size: number;
  /** 导入时间戳（ms） */
  addedAt: number;
}

/** 背景音乐元数据（整体以 JSON 字符串存入 electron-store） */
export interface MusicMeta {
  /** 数据结构版本，用于迁移 */
  version: number;
  /** 用户上传的曲目元数据列表 */
  userTracks: UserMusicTrack[];
  /** 被隐藏（用户删除）的内置曲目 id，如 builtin-1 */
  hiddenBuiltins: string[];
  /** 当前播放曲目 id（重启后续播用），为空表示无记录 */
  currentId: string;
}

/** 应用基础功能 */
export interface AppContract {
  /** 是否使用系统标题栏 */
  isUseSysTitle(): boolean;
  /** 获取静态资源路径 */
  getStaticPath(): string;
  /** 退出应用 */
  quit(): void;
  /** 检查整包更新（electron-updater） */
  checkUpdate(): void;
  /** 退出并安装整包更新 */
  confirmUpdate(): void;
  /** 打开消息对话框 */
  openMessagebox(args: Electron.MessageBoxOptions): Electron.MessageBoxReturnValue;
  /** 打开错误对话框 */
  openErrorbox(args: OpenErrorboxArgs): void;
  /** 开始下载文件 */
  startDownload(url: string): void;
  /** 打开新窗口 */
  openWin(args: OpenWinArgs): void;
  /** 窗口准备就绪 */
  winReady(): void;
  /** @deprecated 演示用，已废弃 */
  startServer(): string;
  /** @deprecated 演示用，已废弃 */
  stopServer(): string;
  /** 检查是否在"我的电脑"中显示（仅 Windows） */
  checkShowOnMyComputer(): boolean;
  /** 设置是否在"我的电脑"中显示（仅 Windows） */
  setShowOnMyComputer(show: boolean): boolean;
  setStoreValue(args: SetStoreValueArgs): void;
  getStoreValue(args: StoreKeyArgs): unknown;
  deleteStoreValue(args: StoreKeyArgs): void;
  /** 打开游戏窗口（手机尺寸 BrowserWindow） */
  openGameWindow(args: OpenGameWindowArgs): void;
  /** 获取当前系统默认音频输出设备名 */
  getDefaultAudioDevice(): string | null;
  /** 打开系统音量合成器/声音设置 */
  openSystemMixer(): void;
  /** 获取本机机器码（基于 app.getMachineId 的硬件指纹） */
  getMachineId(): string;

  /** 打开原生文件选择框并把选中的音频拷贝到 userData 目录，返回成功导入的曲目 */
  addUserMusic(): UserMusicTrack[];
  /** 从磁盘删除指定用户曲目文件 */
  deleteUserMusic(args: DeleteUserMusicArgs): void;
  /** 扫描 userData 目录，返回所有用户曲目（用于启动对账） */
  listUserMusic(): UserMusicTrack[];
  /** 读取背景音乐元数据（用户曲目 + 内置隐藏列表 + 当前曲目） */
  getMusicMeta(): MusicMeta;
  /** 写入背景音乐元数据 */
  setMusicMeta(args: SetMusicMetaArgs): void;
}

/** deleteUserMusic 的载荷 */
export interface DeleteUserMusicArgs {
  /** 磁盘文件名（含扩展名） */
  fileName: string;
}

/** setMusicMeta 的载荷 */
export interface SetMusicMetaArgs {
  meta: MusicMeta;
}

/** openErrorbox 的载荷 */
export interface OpenErrorboxArgs {
  title: string;
  message: string;
}

/** openWin 的载荷 */
export interface OpenWinArgs {
  /** 新的窗口地址 */
  url: string;
  /** 是否是支付页 */
  isPay?: boolean;
  /** 支付参数 */
  payUrl?: string;
  /** 发送给新页面的数据 */
  sendData?: unknown;
}

/** setStoreValue 的载荷 */
export interface SetStoreValueArgs {
  key: string;
  value: string;
}

/** getStoreValue / deleteStoreValue 的载荷 */
export interface StoreKeyArgs {
  key: string;
}

/** openGameWindow 的载荷 */
export interface OpenGameWindowArgs {
  /** 游戏 URL */
  url: string;
  /** 窗口标题 */
  title?: string;
  /** 是否静音 */
  mute?: boolean;
  /** 音量 0~1，默认 1 */
  volume?: number;
}
