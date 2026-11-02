import { BrowserWindow, screen } from 'electron'
import { IsUseSysTitle } from '@main/config/const'

const GAME_WIN_WIDTH = 393
const GAME_WIN_HEIGHT = 800

// 桌面端 Chrome UA：与浏览器直接访问一致，避免移动版页面的触摸逻辑干扰点击
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// 记录当前打开的游戏窗口（避免重复开多个）
let currentGameWin: BrowserWindow | null = null

const isWindows = process.platform === 'win32'

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

  const { workAreaSize } = screen.getPrimaryDisplay()
  const x = Math.round((workAreaSize.width - GAME_WIN_WIDTH) / 2)
  const y = Math.round((workAreaSize.height - GAME_WIN_HEIGHT) / 2)

  const gameWin = new BrowserWindow({
    width: GAME_WIN_WIDTH,
    height: GAME_WIN_HEIGHT,
    x, y,
    title: title || '游戏',
    // macOS 下 hidden 仍保留原生红绿灯（可关闭）；Windows 下 hidden 会连标题栏和窗口按钮
    // 一起去掉导致无法关闭，因此 Windows 使用系统默认标题栏
    titleBarStyle: IsUseSysTitle || isWindows ? 'default' : 'hidden',
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

  // Windows 使用系统标题栏后，窗口整体高度会比内容多出标题栏，这里把内容区固定回
  // 393x800 并重新居中，避免游戏底部被裁切、窗口位置偏移
  if (isWindows) {
    gameWin.setContentSize(GAME_WIN_WIDTH, GAME_WIN_HEIGHT)
    gameWin.center()
  }

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
        if (contentWidth > GAME_WIN_WIDTH) {
          const zoom = GAME_WIN_WIDTH / contentWidth
          gameWin.webContents.setZoomFactor(zoom)
          console.log(`[game] 缩放: ${zoom.toFixed(3)} (内容宽 ${contentWidth} / 窗口 ${GAME_WIN_WIDTH})`)
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
