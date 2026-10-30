import { BrowserWindow, screen } from 'electron'
import { IsUseSysTitle } from '@main/config/const'

const GAME_WIN_WIDTH = 393
const GAME_WIN_HEIGHT = 800

// 记录当前打开的游戏窗口（避免重复开多个）
let currentGameWin: BrowserWindow | null = null

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
    titleBarStyle: IsUseSysTitle ? 'default' : 'hidden',
    backgroundColor: '#000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      devTools: process.env.NODE_ENV === 'development',
    },
  })

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