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

/** 当前游戏窗口的音频状态（更新时复用，避免每次都要重开窗口） */
let currentGameAudio = { mute: false, volume: 1, sinkDeviceId: '' }

function clampVolume(volume: number) {
  return Math.max(0, Math.min(1, volume))
}

/**
 * 生成音频注入脚本：
 * - 劫持 AudioNode.prototype.connect，所有连到 context.destination 的节点被改连到
 *   该上下文的 masterGain，从而统一控制 Web Audio 输出音量（无需游戏创建 GainNode）。
 * - 劫持 HTMLMediaElement.prototype.volume 的 setter，强制使用我们设定的音量。
 * - 首次执行安装拦截并暴露 window.__gameAudio，之后每次执行只更新音量 / 输出设备。
 */
function buildAudioPatchScript(volume: number, sinkDeviceId: string) {
  const v = clampVolume(volume)
  const sinkId = JSON.stringify(sinkDeviceId || '')
  return `
    (function() {
      var v = ${v};
      var sinkId = ${sinkId};
      var api = window.__gameAudio;
      if (!api) {
        var state = { volume: v, sinkId: sinkId };
        var contexts = [];

        // 保存 context.destination -> masterGain 的映射，劫持 connect 时统一改道
        function getMaster(ctx) {
          if (ctx.__masterGain) return ctx.__masterGain;
          try {
            var mg = ctx.createGain();
            mg.gain.value = state.volume;
            var dest = ctx.destination;
            // 用原始 connect 直接连到真实 destination，避免再次被劫持造成自环
            __origConnect.call(mg, dest);
            ctx.__masterGain = mg;
            contexts.push(ctx);
          } catch(e) {}
          return ctx.__masterGain;
        }

        // 劫持 AudioNode.prototype.connect
        var AudioNode = window.AudioNode || window.AudioNode;
        var nodeProto = AudioNode && AudioNode.prototype;
        var __origConnect = nodeProto && nodeProto.connect;
        if (nodeProto && __origConnect && !nodeProto.__gameAudioPatched) {
          nodeProto.connect = function(dest) {
            try {
              if (dest && dest.context && dest === dest.context.destination) {
                var master = getMaster(dest.context);
                if (master) {
                  var args = Array.prototype.slice.call(arguments);
                  args[0] = master;
                  return __origConnect.apply(this, args);
                }
              }
            } catch(e) {}
            return __origConnect.apply(this, arguments);
          };
          nodeProto.__gameAudioPatched = true;
        }

        // 劫持 HTMLMediaElement.volume 的 setter，使游戏自身的音量设置被覆盖
        var mediaProto = (window.HTMLMediaElement || {}).prototype;
        if (mediaProto && !mediaProto.__gameAudioPatched) {
          try {
            var volDesc = Object.getOwnPropertyDescriptor(mediaProto, 'volume');
            var mutedDesc = Object.getOwnPropertyDescriptor(mediaProto, 'muted');
            if (volDesc) {
              Object.defineProperty(mediaProto, 'volume', {
                configurable: true,
                get: function() { return state.volume; },
                set: function() { volDesc.set.call(this, state.volume); },
              });
            }
            var origPlay = mediaProto.play;
            mediaProto.play = function() {
              try { this.volume = state.volume; if (mutedDesc) mutedDesc.set.call(this, false); } catch(e) {}
              return origPlay.apply(this, arguments);
            };
            mediaProto.__gameAudioPatched = true;
          } catch(e) {}
        }

        // 给已存在的音频/视频元素立即应用音量
        function applyMedia() {
          document.querySelectorAll('audio, video').forEach(function(el) {
            try { el.volume = state.volume; el.muted = false; } catch(e) {}
            if (state.sinkId && el.setSinkId && el.sinkId !== state.sinkId) {
              el.setSinkId(state.sinkId).catch(function(){});
            }
          });
        }

        api = window.__gameAudio = {
          setVolume: function(next) {
            state.volume = next;
            contexts.forEach(function(ctx) {
              try { if (ctx.__masterGain) ctx.__masterGain.gain.value = next; } catch(e) {}
            });
            applyMedia();
          },
          setSink: function(next) {
            state.sinkId = next;
            contexts.forEach(function(ctx) {
              try {
                if (ctx.setSinkId && ctx.sinkId !== next) ctx.setSinkId(next).catch(function(){});
              } catch(e) {}
            });
            applyMedia();
          },
          applyMedia: applyMedia,
        };

        new MutationObserver(applyMedia).observe(document.documentElement, { childList: true, subtree: true });
        applyMedia();
      }
      api.setVolume(v);
      api.setSink(sinkId);
    })();
  `
}

/** 把当前音频状态注入到游戏窗口（页面重载或设置变化时调用） */
function injectGameAudio(win: BrowserWindow) {
  if (win.isDestroyed()) return
  const { volume, sinkDeviceId } = currentGameAudio
  win.webContents
    .executeJavaScript(buildAudioPatchScript(volume, sinkDeviceId))
    .then(() => console.log('[game] 音量脚本注入成功, v=', clampVolume(volume)))
    .catch((e) => console.error('[game] 注入失败:', e))
}

/**
 * 实时更新已打开游戏窗口的音量 / 静音 / 输出设备。
 * @returns 是否找到可更新的游戏窗口
 */
export function updateGameAudio(options: {
  mute?: boolean
  volume?: number
  sinkDeviceId?: string
}): boolean {
  currentGameAudio = {
    mute: options.mute ?? currentGameAudio.mute,
    volume: clampVolume(options.volume ?? currentGameAudio.volume),
    sinkDeviceId: options.sinkDeviceId ?? currentGameAudio.sinkDeviceId,
  }

  const win = currentGameWin
  if (!win || win.isDestroyed()) return false

  win.webContents.setAudioMuted(currentGameAudio.mute)
  injectGameAudio(win)
  return true
}

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

  // 记录窗口与音频状态：静音用 Electron 原生 API，音量/设备用注入脚本，两者都可实时更新
  currentGameWin = gameWin
  currentGameAudio = { mute, volume: clampVolume(volume), sinkDeviceId }
  console.log('[game] 设置音频:', currentGameAudio)
  gameWin.webContents.setAudioMuted(mute)

  // 页面加载完注一次，再延迟注两次（SPA 游戏可能动态创建 AudioContext）
  // dom-ready 比 did-finish-load 更早，尽量在游戏创建 AudioContext 之前安装拦截
  const inject = () => injectGameAudio(gameWin)
  gameWin.webContents.on('dom-ready', inject)
  gameWin.webContents.on('did-finish-load', inject)
  setTimeout(inject, 2000)
  setTimeout(inject, 5000)

  gameWin.on('closed', () => {
    if (currentGameWin === gameWin) currentGameWin = null
  })

  return gameWin
}

export function closeGameWindow() {
  if (currentGameWin && !currentGameWin.isDestroyed()) {
    currentGameWin.close()
    currentGameWin = null
  }
}
