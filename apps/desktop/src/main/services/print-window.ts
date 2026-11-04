import { BrowserWindow } from 'electron'
import { staticPaths } from '../config/static-path'

export type PrintMode = '2d' | '3d'

export interface PrintTask {
  nickname: string
  avatarUrl: string
  /** entry / follow / gift / like / comment */
  event: string
  /** 1=小头像, 2=大头像 */
  size: number
  /** 1~100 */
  count: number
}

// 记录当前打开的打印窗口（避免重复开多个）
let currentPrintWin: BrowserWindow | null = null
let currentMode: PrintMode = '2d'

/**
 * 打印窗口 URL：
 * - Dev:  http://localhost:PORT/web/avatar2d.html
 * - Prod: file://{staticPath.__static}/web/avatar2d.html
 *
 * staticPaths = dev: http://localhost:PORT/  prod: file:///.../renderer
 * 统一去掉末尾斜杠后拼接 /web/xxx.html
 */
function buildPrintUrl(mode: PrintMode): string {
  const file = mode === '3d' ? 'avatar3d.html' : 'avatar2d.html'
  const base = staticPaths.endsWith('/') ? staticPaths.slice(0, -1) : staticPaths
  return `${base}/web/${file}`
}

/**
 * 打开头像打印窗口。若已有打印窗口则先关闭再按新模式重开。
 */
export function openPrintWindow(mode: PrintMode = '2d'): void {
  // 如果已经有了就先关
  if (currentPrintWin && !currentPrintWin.isDestroyed()) {
    currentPrintWin.close()
    currentPrintWin = null
  }

  currentMode = mode
  const url = buildPrintUrl(mode)

  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: mode === '3d' ? '头像打印 · 3D' : '头像打印 · 2D',
    autoHideMenuBar: true,
    backgroundColor: '#17191e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 打印窗口需要加载抖音头像等跨域图片，关闭 web 安全限制
      webSecurity: false,
      allowRunningInsecureContent: true,
      devTools: process.env.NODE_ENV === 'development',
    },
  })

  win.setMenuBarVisibility(false)
  win.loadURL(url)
  win.once('ready-to-show', () => win.show())

  win.on('closed', () => {
    if (currentPrintWin === win) {
      currentPrintWin = null
    }
  })

  currentPrintWin = win
  console.log(`[print] 打开打印窗口 mode=${mode} url=${url}`)
}

/**
 * 向打印窗口投递一个打印任务。
 * 打印窗口内已暴露 window.enqueuePrint({nickname, avatarUrl, event, count, size})。
 * @returns 是否成功投递（窗口未打开或注入失败返回 false）
 */
export async function enqueuePrintTask(task: PrintTask): Promise<boolean> {
  const win = currentPrintWin
  if (!win || win.isDestroyed()) return false

  const payload = JSON.stringify({
    nickname: task.nickname,
    avatarUrl: task.avatarUrl,
    event: task.event,
    count: task.count,
    size: task.size,
  })

  try {
    const result = await win.webContents.executeJavaScript(
      `(async function(){ try { return await window.enqueuePrint(${payload}); } catch(e){ return {__error: String(e && e.message || e)}; } })();`,
    )
    if (result && typeof result === 'object' && (result as { __error?: string }).__error) {
      console.warn('[print] enqueuePrint 内部错误:', (result as { __error: string }).__error)
      return false
    }
    return true
  } catch (e) {
    console.error('[print] enqueuePrintTask 执行失败:', e)
    return false
  }
}

/** 关闭打印窗口 */
export function closePrintWindow(): void {
  if (currentPrintWin && !currentPrintWin.isDestroyed()) {
    currentPrintWin.close()
    currentPrintWin = null
  }
}

/** 打印窗口是否已打开 */
export function isPrintWindowOpen(): boolean {
  return !!currentPrintWin && !currentPrintWin.isDestroyed()
}
