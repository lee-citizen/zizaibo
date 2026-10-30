import { BrowserWindow, webContents } from "electron";
import type { ConnectPullResult } from "ipc-contract";

/**
 * 连接直播（M1：抖音）——独立直播间窗口方案
 *
 * 不在主窗口内嵌 webview，而是弹出一个独立的 Electron BrowserWindow
 * 加载直播间：用户可以在里面看直播、登录，登录态落在 persist:connect 分区。
 * 弹幕采集由主进程对该窗口的 webContents 所有子 frame 注入脚本完成
 * （抖音弹幕在跨域 iframe 中，WebFrameMain.executeJavaScript 可穿透）。
 *
 * 注入脚本（installScript）由渲染层提供，自包含且幂等：每次执行都会
 * 安装采集器（首次）并返回自上轮以来的新增数据。
 */

interface DanmakuSession {
  installScript: string;
}

/** windowId -> 会话 */
const sessions = new Map<number, DanmakuSession>();
/** windowId -> 隐藏前的原始位置 [x, y]，恢复时移回 */
const hiddenPositions = new Map<number, [number, number]>();
/** 移出屏幕的目标坐标（足够远，确保不在任何屏幕内） */
const OFFSCREEN_POS: [number, number] = [-30000, -30000];

/** 打开直播间独立窗口 */
export function connectOpenRoom(args: { url: string }): { windowId: number } {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "直播间（LiveTools）",
    autoHideMenuBar: true,
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: false,
      // 登录态持久：用户在窗口里登录一次，后续连接免登录
      partition: "persist:connect",
      // 关键：窗口移出屏幕隐藏后，禁止 Chromium 后台节流，
      // 保证弹幕页面 JS 正常执行、弹幕继续滚动，采集不中断。
      backgroundThrottling: false,
    },
  });
  // 页面自己有标题栏信息，避免双标题
  win.on("page-title-updated", (e) => e.preventDefault());
  // 拦截非 http(s) 导航：抖音页面会尝试调起 bytedance:// 等内部协议，
  // Electron 不认这些协议，放行只会刷 ERR_BLOCKED_BY_CSP 警告
  win.webContents.on("will-navigate", (e, url) => {
    if (!/^https?:/i.test(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 允许页面自己开 http(s) 新窗口（如用户主页），其余一律拒绝
    if (/^https?:/i.test(url)) {
      void win.loadURL(url).catch(() => {});
    }
    return { action: "deny" };
  });
  // loadURL 不阻塞返回：窗口先弹出来，加载过程用户可见
  void win.loadURL(args.url).catch(() => {});
  const windowId = win.webContents.id;
  // 用户手动关窗 → 会话随窗口销毁自然失效（下次 pull 返回 null 通知渲染层）
  win.on("closed", () => {
    sessions.delete(windowId);
  });
  return { windowId };
}

/** 关闭直播间窗口并清理会话 */
export function connectCloseRoom(args: { windowId: number }): void {
  sessions.delete(args.windowId);
  hiddenPositions.delete(args.windowId);
  const wc = webContents.fromId(args.windowId);
  if (wc && !wc.isDestroyed()) {
    const win = BrowserWindow.fromWebContents(wc);
    if (win && !win.isDestroyed()) win.destroy();
  }
}

/** 开始监听：登记注入脚本 */
export function connectStart(args: { windowId: number; installScript: string }): void {
  const wc = webContents.fromId(args.windowId);
  if (!wc || wc.isDestroyed()) {
    throw new Error("直播间窗口不存在或已关闭");
  }
  sessions.set(args.windowId, { installScript: args.installScript });
}

/** 停止监听并清理会话（不关窗口） */
export function connectStop(args: { windowId: number }): void {
  sessions.delete(args.windowId);
}

/** 诊断：对窗口所有 frame 执行诊断脚本，收集页面结构信息 */
export async function connectDiagnose(args: {
  windowId: number;
  diagnoseScript: string;
}): Promise<{ reports: string[] }> {
  const wc = webContents.fromId(args.windowId);
  if (!wc || wc.isDestroyed()) {
    return { reports: ["直播间窗口不存在或已关闭"] };
  }

  const reports: string[] = [];
  let frames;
  try {
    frames = wc.mainFrame.framesInSubtree;
  } catch {
    return { reports: ["无法枚举 frame（窗口已销毁）"] };
  }

  const results = await Promise.allSettled(
    frames.map(async (frame) => {
      const out = await frame.executeJavaScript(args.diagnoseScript, false);
      return String(out ?? "");
    }),
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const head = `===== frame[${i}] =====`;
    if (r.status === "fulfilled") {
      if (r.value) reports.push(`${head}\n${r.value}`);
    } else {
      reports.push(`${head}\n[诊断脚本执行失败] ${String(r.reason?.message ?? r.reason)}`);
    }
  }
  return { reports };
}

/** 拉取一轮数据：遍历所有存活子 frame 执行脚本并汇总 */
export async function connectPull(args: { windowId: number }): Promise<ConnectPullResult | null> {
  const sess = sessions.get(args.windowId);
  if (!sess) return null;
  const wc = webContents.fromId(args.windowId);
  if (!wc || wc.isDestroyed()) {
    // 窗口被用户手动关闭：清会话并通知渲染层断开
    sessions.delete(args.windowId);
    return null;
  }

  const merged: ConnectPullResult = {
    msgs: [],
    viewer: "",
    ready: false,
    lastMsgAt: 0,
    emojiMap: {},
  };

  let frames;
  try {
    frames = wc.mainFrame.framesInSubtree;
  } catch {
    return merged;
  }

  const results = await Promise.allSettled(
    frames.map((frame) => frame.executeJavaScript(sess.installScript, false)),
  );
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const v = r.value as Partial<ConnectPullResult>;
    if (Array.isArray(v.msgs)) merged.msgs.push(...v.msgs);
    if (!merged.viewer && v.viewer) merged.viewer = v.viewer;
    merged.ready = merged.ready || !!v.ready;
    if (typeof v.lastMsgAt === "number" && v.lastMsgAt > merged.lastMsgAt) {
      merged.lastMsgAt = v.lastMsgAt;
    }
    if (v.emojiMap && typeof v.emojiMap === "object") {
      Object.assign(merged.emojiMap, v.emojiMap);
    }
  }
  return merged;
}

// ===================== 窗口隐藏 / 显示（弹幕采集不中断） =====================

/**
 * 隐藏直播间窗口：把窗口移出屏幕可视区域。
 * 不使用 hide() / 最小化，因为这两种方式在部分平台仍会触发 Chromium 后台节流；
 * 移出屏幕后窗口在技术上仍是「可见」状态，配合 backgroundThrottling:false，
 * 页面 JS 正常执行、弹幕继续滚动，采集不受影响。
 */
export function connectHideRoom(args: { windowId: number }): void {
  const wc = webContents.fromId(args.windowId);
  if (!wc || wc.isDestroyed()) return;
  const win = BrowserWindow.fromWebContents(wc);
  if (!win || win.isDestroyed()) return;
  // 已隐藏则不重复处理
  if (hiddenPositions.has(args.windowId)) return;
  const [x, y] = win.getPosition();
  hiddenPositions.set(args.windowId, [x, y]);
  win.setPosition(OFFSCREEN_POS[0], OFFSCREEN_POS[1]);
}

/** 恢复显示直播间窗口：移回隐藏前的位置 */
export function connectShowRoom(args: { windowId: number }): void {
  const wc = webContents.fromId(args.windowId);
  if (!wc || wc.isDestroyed()) return;
  const win = BrowserWindow.fromWebContents(wc);
  if (!win || win.isDestroyed()) return;
  const pos = hiddenPositions.get(args.windowId);
  if (!pos) return;
  win.setPosition(pos[0], pos[1]);
  hiddenPositions.delete(args.windowId);
}

/** 查询直播间窗口是否已隐藏 */
export function connectIsRoomHidden(args: { windowId: number }): boolean {
  return hiddenPositions.has(args.windowId);
}
