import { BrowserWindow, screen } from 'electron'
import { IsUseSysTitle } from '@main/config/const'

// 手机竖屏比例：宽 / 高 = 0.5（9:18），目标高 960 → 宽 480
const GAME_ASPECT_RATIO = 0.5
const GAME_BASE_HEIGHT = 960
const GAME_BASE_WIDTH = Math.round(GAME_BASE_HEIGHT * GAME_ASPECT_RATIO)

// 桌面端 Chrome UA：与浏览器直接访问一致，避免移动版页面的触摸逻辑干扰点击
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// 记录当前打开的游戏窗口（避免重复开多个）
let currentGameWin: BrowserWindow | null = null

const isWindows = process.platform === 'win32'

/** 按屏幕可用工作区等比缩小，保持 9:18，宽高任一方向都不溢出 */
function getGameContentSize(workArea: { width: number; height: number }) {
  const scale = Math.min(
    1,
    workArea.width / GAME_BASE_WIDTH,
    workArea.height / GAME_BASE_HEIGHT,
  )
  let width = Math.max(1, Math.floor(GAME_BASE_WIDTH * scale))
  let height = width * 2
  if (height > workArea.height) {
    height = Math.max(1, Math.floor(workArea.height))
    width = Math.max(1, Math.floor(height / 2))
    height = width * 2
  }
  return { width, height }
}

/**
 * 设置内容区尺寸并保证窗口外框（Windows 系统标题栏）也不超出工作区。
 * 内容区严格保持宽:高 = 1:2。
 */
function fitGameWindow(
  win: BrowserWindow,
  workArea: { x: number; y: number; width: number; height: number },
) {
  let { width, height } = getGameContentSize(workArea)

  for (let i = 0; i < 4; i++) {
    win.setContentSize(width, height)
    const [outerWidth, outerHeight] = win.getSize()
    if (outerWidth <= workArea.width && outerHeight <= workArea.height) break

    const scale = Math.min(workArea.width / outerWidth, workArea.height / outerHeight)
    height = Math.max(1, Math.floor(height * scale))
    width = Math.max(1, Math.floor(height / 2))
    height = width * 2
  }

  // 按最终外框尺寸居中到工作区，避免被任务栏 / Dock 遮挡
  const [outerWidth, outerHeight] = win.getSize()
  win.setPosition(
    Math.round(workArea.x + (workArea.width - outerWidth) / 2),
    Math.round(workArea.y + (workArea.height - outerHeight) / 2),
  )
  return win.getContentSize()
}

export function openGameWindow(
  url: string,
  title?: string,
  options: { mute?: boolean; volume?: number; sinkDeviceId?: string } = {},
) {
  const { mute = false, volume = 1, sinkDeviceId = '' } = options

  // 如果已经有了就先关
  if (currentGameWin && !currentGameWin.isDestroyed()) {
    currentGameWin.close()
    currentGameWin = null
  }

  const { workArea } = screen.getPrimaryDisplay()
  const initialSize = getGameContentSize(workArea)

  const gameWin = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    // width / height 表示内容区尺寸，保证严格 9:18
    useContentSize: true,
    title: title || '游戏',
    // macOS 下 hidden 仍保留原生红绿灯（可关闭）；Windows 下 hidden 会连标题栏和窗口按钮
    // 一起去掉导致无法关闭，因此 Windows 使用系统默认标题栏
    titleBarStyle: IsUseSysTitle || isWindows ? 'default' : 'hidden',
    // Windows 下系统标题栏会带出菜单栏（设置｜Edit｜帮助），先隐藏（按 Alt 可临时唤出）
    autoHideMenuBar: true,
    backgroundColor: '#000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      devTools: process.env.NODE_ENV === 'development',
    },
  })

  if (isWindows) {
    // 彻底移除菜单栏，避免游戏操作中误按 Alt 唤出
    gameWin.removeMenu()
  }
  // 统一按 9:18 设置内容区；Windows 标题栏导致外框超出工作区时再等比收缩并居中
  const contentSize = fitGameWindow(gameWin, workArea)
  console.log('[game] 窗口内容区尺寸:', contentSize)

  // 1. 设置桌面端 Chrome UA：与浏览器直接访问行为一致
  gameWin.webContents.setUserAgent(DESKTOP_UA)

  // 2. 注入：隐藏滚动条
  const injectNoScroll = () => {
    if (gameWin.isDestroyed()) return
    gameWin.webContents
      .executeJavaScript(`
        (function() {
          try {
            var s = document.createElement('style');
            s.textContent = 'html,body{margin:0;padding:0;overflow:hidden!important}' +
              '::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}' +
              'body{-ms-overflow-style:none;scrollbar-width:none}';
            document.head.appendChild(s);
          } catch(e){}
        })();
      `)
      .catch(() => {})
  }

  // 3. 用 Electron 原生 zoom 缩放页面到窗口宽度（浏览器级缩放，对 Canvas/WebGL 友好）
  const fitToWindowByZoom = () => {
    if (gameWin.isDestroyed()) return
    gameWin.webContents
      .executeJavaScript(`
        (function() {
          try {
            return Math.max(
              document.documentElement.scrollWidth,
              document.body ? document.body.scrollWidth : 0,
              1
            );
          } catch(e) { return 1; }
        })();
      `)
      .then((contentWidth: number) => {
        if (gameWin.isDestroyed()) return
        // 使用当前内容区实际宽度，避免窗口尺寸变化后缩放与窗口不一致
        const [winWidth] = gameWin.getContentSize()
        if (contentWidth > winWidth) {
          const zoom = winWidth / contentWidth
          gameWin.webContents.setZoomFactor(zoom)
          console.log(`[game] 缩放: ${zoom.toFixed(3)} (内容宽 ${contentWidth} / 窗口 ${winWidth})`)
        } else {
          gameWin.webContents.setZoomFactor(1)
        }
      })
      .catch(() => {})
  }

  // 每次导航完成后重新注入 + 缩放（重试几次应对异步渲染的游戏）
  const onLoaded = () => {
    injectNoScroll()
    fitToWindowByZoom()
    setTimeout(fitToWindowByZoom, 500)
    setTimeout(fitToWindowByZoom, 1500)
    setTimeout(fitToWindowByZoom, 3500)
  }
  gameWin.webContents.on('did-finish-load', onLoaded)
  gameWin.webContents.on('did-navigate', onLoaded)

  gameWin.loadURL(url)
  gameWin.once('ready-to-show', () => gameWin.show())

  // ✅ 用 Electron 原生 API 静音 + 兜底 Web Audio 拦截
  console.log('[game] 设置音频:', { mute, volume })
  gameWin.webContents.setAudioMuted(mute)

  // 如果没静音，额外注脚本拦截 Web Audio API（部分游戏需要）
  if (!mute) {
    const v = Math.max(0, Math.min(1, volume))
    const sinkId = JSON.stringify(sinkDeviceId)
    const patchScript = `
      (function() {
        var v = ${v};
        var sinkId = ${sinkId};
        // 拦截 Web Audio API
        var _AC = window.AudioContext;
        if (_AC && !_AC.__patched) {
          var proto = _AC.prototype;
          if (proto.createGain && proto.createGain.__wrapped !== true) {
            var origCreateGain = proto.createGain;
            proto.createGain = function() {
              var node = origCreateGain.apply(this, arguments);
              try { node.gain.value = v; } catch(e) {}
              return node;
            };
            proto.createGain.__wrapped = true;
          }
          // 给 AudioContext 设置输出设备（setSinkId，Chrome/Edge 支持）
          if (sinkId && proto.setSinkId) {
            var origResume = proto.resume;
            proto.resume = function() {
              var r = origResume.apply(this, arguments);
              if (this.sinkId !== sinkId) {
                this.setSinkId(sinkId).catch(function(){});
              }
              return r;
            };
          }
          _AC.__patched = true;
        }
        // 同时处理 DOM 媒体元素（万一有）
        function applyMedia() {
          document.querySelectorAll('audio, video').forEach(function(el) {
            el.volume = v;
            el.muted = false;
            if (sinkId && el.setSinkId && el.sinkId !== sinkId) {
              el.setSinkId(sinkId).catch(function(){});
            }
          });
        }
        applyMedia();
        var mo = new MutationObserver(applyMedia);
        mo.observe(document.documentElement, { childList: true, subtree: true });
      })();
    `
    // 页面加载完注一次，再延迟注两次（SPA 游戏可能动态创建 AudioContext）
    const inject = () => {
      if (gameWin.isDestroyed()) return
      gameWin.webContents.executeJavaScript(patchScript)
        .then(() => console.log('[game] 音量脚本注入成功, v=', v))
        .catch(e => console.error('[game] 注入失败:', e))
    }
    gameWin.webContents.on('did-finish-load', inject)
    setTimeout(inject, 2000)
    setTimeout(inject, 5000)
  }

  gameWin.on('closed', () => {
    if (currentGameWin === gameWin) currentGameWin = null
  })

  currentGameWin = gameWin
  return gameWin
}

export function closeGameWindow() {
  if (currentGameWin && !currentGameWin.isDestroyed()) {
    currentGameWin.close()
    currentGameWin = null
  }
}
