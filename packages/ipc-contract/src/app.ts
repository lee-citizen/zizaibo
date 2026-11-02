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
  /** 窗口最小化 */
  winMinimize(): void;
  /** 窗口最大化 / 还原切换 */
  winToggleMaximize(): void;
  /** 窗口是否已最大化 */
  winIsMaximized(): boolean;
  /** 窗口关闭 */
  winClose(): void;
  /** 获取静态资源路径 */
  getStaticPath(): string;
  /** 退出应用 */
  quit(): void;
  /** 重启应用（热更新完成后调用） */
  relaunch(): void;
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
  /**
   * 实时更新已打开游戏窗口的音量 / 静音 / 输出设备（不重新打开窗口）
   * @returns 是否找到可更新的游戏窗口
   */
  updateGameAudio(args: GameAudioArgs): boolean;
  /**
   * 游戏跳转：调用后台 /api/v1/game/jump 接口，返回游戏真实 URL
   * 401 时抛出 'UNAUTHORIZED' 错误
   */
  gameJump(args: { token: string; gameKey: string }): string;
  /** 获取当前系统默认音频输出设备名 */
  getDefaultAudioDevice(): string | null;
  /** 打开系统音量合成器/声音设置 */
  openSystemMixer(): void;
  /** 检测虚拟声卡是否已安装，返回设备名（未安装返回 null） */
  detectVirtualAudioDevice(): string | null;
  /** 用系统默认浏览器打开外部链接（兼容 mac/win） */
  openExternalUrl(url: string): void;
  /**
   * 下载整包更新安装包，校验 SHA-256 后打开安装程序并退出当前应用
   * @param downloadUrl 安装包下载地址
   * @param sha256 期望的 SHA-256（空字符串跳过校验）
   * @param fileName 保存文件名
   */
  downloadAndInstallUpdate(args: {
    downloadUrl: string;
    sha256: string;
    fileName: string;
  }): void;
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

  // ---------- 智能朗读：我的语音 ----------
  /** 打开原生文件选择框，把选中的音频拷贝到 userData/bg-voice-user 目录 */
  addUserVoice(): UserVoiceTrack[];
  /** 保存一段现场录音（base64）到 userData/bg-voice-user 目录 */
  saveUserVoiceRecording(args: SaveUserVoiceRecordingArgs): UserVoiceTrack;
  /** 从磁盘删除指定语音文件 */
  deleteUserVoice(args: DeleteUserMusicArgs): void;
  /** 扫描 userData/bg-voice-user 目录，返回所有语音曲目 */
  listUserVoice(): UserVoiceTrack[];
  /** 读取语音管理元数据 */
  getVoiceMeta(): VoiceMeta;
  /** 写入语音管理元数据 */
  setVoiceMeta(args: SetVoiceMetaArgs): void;

  /** 调用 edge-tts（微软 Edge 在线 TTS）合成语音，返回 base64 编码的 mp3 音频 */
  edgeTtsSynthesize(args: EdgeTtsArgs): EdgeTtsResult;

  // ---------- 连接直播（connect）----------
  /** 打开直播间独立窗口（persist 会话保持登录），返回 windowId */
  connectOpenRoom(args: ConnectOpenRoomArgs): ConnectOpenRoomResult;
  /** 关闭直播间窗口 */
  connectCloseRoom(args: ConnectStopArgs): void;
  /** 开始监听直播间窗口内的弹幕，installScript 由渲染层注入到所有子 frame */
  connectStart(args: ConnectStartArgs): void;
  /** 停止监听并清理会话（不关窗口） */
  connectStop(args: ConnectStopArgs): void;
  /** 拉取一轮弹幕/人数数据（渲染层定时轮询，主进程遍历所有子 frame 汇总） */
  connectPull(args: ConnectStopArgs): ConnectPullResult | null;
  /** 收集直播间窗口所有 frame 的页面结构诊断信息（用于校准弹幕选择器） */
  connectDiagnose(args: ConnectDiagnoseArgs): ConnectDiagnoseResult;
  /** 隐藏直播间窗口（移出屏幕，弹幕采集不中断） */
  connectHideRoom(args: ConnectStopArgs): void;
  /** 恢复显示直播间窗口（移回原位） */
  connectShowRoom(args: ConnectStopArgs): void;
  /** 查询直播间窗口是否已隐藏 */
  connectIsRoomHidden(args: ConnectStopArgs): boolean;
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

// ===================== 连接直播（connect）=====================

/** 单条弹幕 */
export interface DanmakuMsg {
  /** 用户昵称（抓不到为空串，展示时不显示昵称前缀） */
  user: string;
  /** 发送人 id（优先 sec_uid，其次数字 id，抓不到为空串） */
  uid: string;
  /** 用户等级（如 "32"，抓不到为空串） */
  level: string;
  /** 等级徽章图片 URL（抓不到为空串） */
  levelImg: string;
  /** 粉丝团灯牌图片 URL（抓不到为空串） */
  fansImg: string;
  /** 弹幕/礼物/进场文本 */
  text: string;
  /** 整条弹幕的 HTML（含等级徽章、粉丝团灯牌、昵称、内容、emoji） */
  html: string;
  /** 时间戳（ms） */
  ts: number;
}

/** connectOpenRoom 的载荷 */
export interface ConnectOpenRoomArgs {
  /** 直播间地址（渲染层已归一化校验） */
  url: string;
}

/** connectOpenRoom 的返回 */
export interface ConnectOpenRoomResult {
  /** 直播间窗口的 webContents id，后续 start/pull/close 都用它 */
  windowId: number;
}

/** connectStart 的载荷 */
export interface ConnectStartArgs {
  /** 直播间窗口的 webContents id */
  windowId: number;
  /** 注入脚本（自包含、幂等，执行即安装采集器并返回一轮数据） */
  installScript: string;
}

/** connectStop / connectPull 的载荷 */
export interface ConnectStopArgs {
  windowId: number;
}

/** connectPull 的返回：主进程遍历所有子 frame 汇总后的结果 */
export interface ConnectPullResult {
  /** 本轮新弹幕 */
  msgs: DanmakuMsg[];
  /** 观看人数原始文本（如 "1.2万"），空表示暂未抓到 */
  viewer: string;
  /** 弹幕容器是否已绑定采集器 */
  ready: boolean;
  /** 最近一条弹幕的时间戳 */
  lastMsgAt: number;
  /** emoji 标记 -> 图片地址（把弹幕里的 [标记] 还原成表情图） */
  emojiMap: Record<string, string>;
}

/** connectDiagnose 的载荷：对直播间窗口所有 frame 执行诊断脚本 */
export interface ConnectDiagnoseArgs {
  windowId: number;
  /** 诊断脚本（自包含，返回一段诊断文本） */
  diagnoseScript: string;
}

/** connectDiagnose 的返回：每个 frame 一段诊断文本 */
export interface ConnectDiagnoseResult {
  reports: string[];
}

// ===================== 智能朗读（speech）=====================

/** 用户上传/录制的语音曲目（文件落在 userData/bg-voice-user/） */
export interface UserVoiceTrack {
  /** 唯一 id */
  id: string;
  /** 显示名称 */
  name: string;
  /** 磁盘真实文件名（含扩展名） */
  fileName: string;
  /** 可直接用于 audio.src 的自定义协议 URL */
  url: string;
  /** 文件大小（字节） */
  size: number;
  /** 导入/录制时间戳（ms） */
  addedAt: number;
  /** 是否为现场录音 */
  recorded: boolean;
}

/** 语音管理元数据（整体以 JSON 字符串存入 electron-store） */
export interface VoiceMeta {
  /** 数据结构版本 */
  version: number;
  /** 用户语音曲目元数据列表 */
  tracks: UserVoiceTrack[];
  /** 当前播放曲目 id */
  currentId: string;
}

/** saveUserVoiceRecording 的载荷 */
export interface SaveUserVoiceRecordingArgs {
  /** 文件名（含扩展名，如 recording-xxx.webm） */
  fileName: string;
  /** base64 编码的音频数据（不含 data: URL 前缀） */
  base64: string;
  /** 显示名称 */
  name: string;
  /** 是否为现场录音（默认为 true；TTS 生成的音频传 false） */
  recorded?: boolean;
}

/** setVoiceMeta 的载荷 */
export interface SetVoiceMetaArgs {
  meta: VoiceMeta;
}

/** edge-tts 合成参数（微软 Edge 在线 TTS，免费无需密钥） */
export interface EdgeTtsArgs {
  /** 待朗读文本 */
  text: string;
  /** 微软声音名，如 zh-CN-YunxiNeural */
  voice: string;
  /** 语速百分比偏移，如 +15 表示 +15% */
  ratePercent: number;
  /** 音调 Hz 偏移，如 +8 表示 +8Hz */
  pitchHz: number;
}

/** edge-tts 合成结果（base64 编码的 mp3 音频） */
export interface EdgeTtsResult {
  /** base64 编码的音频数据 */
  base64: string;
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

/** updateGameAudio 的载荷，任意字段不传则保留当前值 */
export interface GameAudioArgs {
  /** 是否静音 */
  mute?: boolean;
  /** 音量 0~1 */
  volume?: number;
  /** 音频输出设备 ID（setSinkId），空字符串表示系统默认 */
  sinkDeviceId?: string;
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
  /** 音频输出设备 ID（setSinkId），不传则用系统默认 */
  sinkDeviceId?: string;
}
