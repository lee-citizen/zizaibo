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
let currentGameAudio = {
  mute: false,
  volume: 1,
  sinkDeviceId: '',
  sinkDeviceLabel: '',
  /** 游戏窗口源内的 deviceId（由大厅页面直接传入，优先级高于 label 匹配） */
  sinkDeviceIdDirect: '',
}

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
function buildAudioPatchScript(volume: number, sinkDeviceLabel: string) {
  const v = clampVolume(volume)
  const targetLabel = JSON.stringify(sinkDeviceLabel || '')
  return `
    (function() {
      var v = ${v};
      var targetLabel = ${targetLabel};
      var api = window.__gameAudio;
      if (!api) {
        // sinkId 留空：在游戏窗口源内按 label 重新枚举设备后再填
        var state = { volume: v, sinkId: '', label: targetLabel };
        var contexts = [];

        // 在游戏窗口源内枚举设备，按 label 匹配本地 deviceId（deviceId 是按源隔离的，
        // 主窗口枚举到的 id 在游戏窗口源里不存在，必须用 label 重新匹配）
        // 先 getUserMedia 授权，enumerateDevices 才会返回真实 label 和稳定 deviceId
        function ensureMediaPermission(cb) {
          try {
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
              stream.getTracks().forEach(function(t){ t.stop(); });
              cb();
            }).catch(function(){ cb(); });
          } catch(e) { cb(); }
        }

        function resolveSinkId(cb) {
          if (!state.label) { state.sinkId = ''; if (cb) cb(); return; }
          ensureMediaPermission(function(){
            try {
              navigator.mediaDevices.enumerateDevices().then(function(list){
                var want = state.label.toLowerCase();
                var match = null;
                for (var i = 0; i < list.length; i++) {
                  var d = list[i];
                  if (d.kind !== 'audiooutput' || !d.label) continue;
                  if (d.label.toLowerCase().indexOf(want) !== -1) { match = d; break; }
                }
                state.sinkId = match ? match.deviceId : '';
                state.__matchedLabel = match ? match.label : '';
                if (cb) cb();
              }).catch(function(){ state.sinkId = ''; if (cb) cb(); });
            } catch(e) { state.sinkId = ''; if (cb) cb(); }
          });
        }

        // 把当前 sinkId 应用到所有已追踪的 AudioContext
        function applySinkId() {
          var id = state.sinkId;
          contexts.forEach(function(ctx) {
            try {
              if (ctx.setSinkId && ctx.sinkId !== id) ctx.setSinkId(id).catch(function(){});
            } catch(e) {}
          });
          applyMedia();
        }

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

        // 劫持 AudioContext / webkitAudioContext 构造函数：
        // 每个新建的上下文立即 setSinkId，并加入 contexts 数组便于后续切换
        function patchCtxCtor(name) {
          var Ctor = window[name];
          if (!Ctor || Ctor.__gameAudioPatched) return;
          var Wrapped = function() {
            var ctx = new (Function.prototype.bind.apply(Ctor, [null].concat(Array.prototype.slice.call(arguments))))();
            if (contexts.indexOf(ctx) === -1) contexts.push(ctx);
            applySinkId();
            return ctx;
          };
          Wrapped.prototype = Ctor.prototype;
          try { Object.defineProperty(window, name, { value: Wrapped, configurable: true }); } catch(e) {}
          Ctor.__gameAudioPatched = true;
        }
        patchCtxCtor('AudioContext');
        patchCtxCtor('webkitAudioContext');

        // 兜底：AudioContext.resume 时再尝试一次 setSinkId（覆盖注入前已创建的上下文）
        var ctxProto = (window.AudioContext || window.webkitAudioContext || {}).prototype;
        if (ctxProto && ctxProto.resume && !ctxProto.__gameAudioResumePatched) {
          var origResume = ctxProto.resume;
          ctxProto.resume = function() {
            var self = this;
            if (contexts.indexOf(self) === -1) contexts.push(self);
            applySinkId();
            return origResume.apply(self, arguments);
          };
          ctxProto.__gameAudioResumePatched = true;
        }

        // 劫持 HTMLMediaElement：音量强制覆盖；输出设备通过共享 AudioContext 路由
        // （el.setSinkId 在 Windows 会静默回退到扬声器，因此改用 createMediaElementSource
        //  → gain → 共享 AudioContext.destination，由共享上下文的 setSinkId 控制输出设备）
        var mediaProto = (window.HTMLMediaElement || {}).prototype;
        var mediaCtx = null;
        var routedMedia = new WeakMap();

        function getMediaCtx() {
          if (mediaCtx) return mediaCtx;
          try {
            var AC = window.AudioContext || window.webkitAudioContext;
            mediaCtx = new AC();
            contexts.push(mediaCtx);
            applySinkId();
          } catch(e) {}
          return mediaCtx;
        }

        // 把单个媒体元素接入共享上下文（跨域资源会失败，回退到 el.setSinkId）
        function routeMedia(el) {
          if (routedMedia.has(el)) return routedMedia.get(el);
          var ctx = getMediaCtx();
          if (!ctx) return null;
          try {
            var src = ctx.createMediaElementSource(el);
            var gain = ctx.createGain();
            gain.gain.value = state.volume;
            src.connect(gain);
            gain.connect(ctx.destination);
            var entry = { src: src, gain: gain };
            routedMedia.set(el, entry);
            return entry;
          } catch(e) {
            // 跨域等原因：回退到 element.setSinkId（macOS 可用，Windows 可能仍走扬声器）
            try {
              el.volume = state.volume;
              el.muted = false;
              if (state.sinkId && el.setSinkId && el.sinkId !== state.sinkId) {
                el.setSinkId(state.sinkId).catch(function(){});
              }
            } catch(err) {}
            return null;
          }
        }

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
              routeMedia(this);
              return origPlay.apply(this, arguments);
            };
            mediaProto.__gameAudioPatched = true;
          } catch(e) {}
        }

        // 遍历所有音频/视频元素：接入共享上下文 + 应用音量
        function applyMedia() {
          document.querySelectorAll('audio, video').forEach(function(el) {
            try {
              var entry = routeMedia(el);
              if (entry) {
                entry.gain.gain.value = state.volume;
              } else {
                el.volume = state.volume;
                el.muted = false;
                if (state.sinkId && el.setSinkId && el.sinkId !== state.sinkId) {
                  el.setSinkId(state.sinkId).catch(function(){});
                }
              }
            } catch(e) {}
          });
        }

        // ========== 浮动设备选择器（游戏窗口内直接选设备，绕过跨源 label 问题） ==========
        var pickerBtn = null;
        var pickerPanel = null;

        function buildDevicePicker() {
          if (pickerBtn) return;
          try {
            pickerBtn = document.createElement('div');
            pickerBtn.id = '__game_audio_picker_btn';
            pickerBtn.textContent = '🔊';
            pickerBtn.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;' +
              'width:36px;height:36px;line-height:36px;text-align:center;' +
              'background:rgba(0,0,0,0.6);color:#fff;border-radius:8px;cursor:pointer;' +
              'font-size:18px;user-select:none;font-family:sans-serif;';
            pickerBtn.title = '选择音频输出设备';
            pickerBtn.addEventListener('click', showDevicePanel);
            document.documentElement.appendChild(pickerBtn);
          } catch(e) {}
        }

        function showDevicePanel() {
          if (pickerPanel) { pickerPanel.remove(); pickerPanel = null; }
          pickerPanel = document.createElement('div');
          pickerPanel.style.cssText = 'position:fixed;right:8px;bottom:52px;z-index:2147483647;' +
            'background:rgba(0,0,0,0.92);color:#fff;border-radius:8px;padding:8px;' +
            'min-width:200px;max-width:280px;font-size:13px;font-family:sans-serif;';
          var title = document.createElement('div');
          title.textContent = '选择输出设备';
          title.style.cssText = 'margin-bottom:6px;font-weight:bold;';
          pickerPanel.appendChild(title);

          ensureMediaPermission(function(){
            navigator.mediaDevices.enumerateDevices().then(function(list){
              var outs = list.filter(function(d){ return d.kind === 'audiooutput'; });
              outs.forEach(function(d){
                var item = document.createElement('div');
                item.textContent = d.label || '(未命名设备)';
                item.style.cssText = 'padding:6px 8px;cursor:pointer;border-radius:4px;' +
                  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                if (d.deviceId === state.sinkId) {
                  item.style.background = 'rgba(64,158,255,0.4)';
                }
                item.addEventListener('mouseenter', function(){ item.style.background = 'rgba(255,255,255,0.15)'; });
                item.addEventListener('mouseleave', function(){
                  item.style.background = d.deviceId === state.sinkId ? 'rgba(64,158,255,0.4)' : '';
                });
                item.addEventListener('click', function(){
                  state.sinkId = d.deviceId;
                  state.label = d.label;
                  state.__matchedLabel = d.label;
                  applySinkId();
                  if (pickerPanel) { pickerPanel.remove(); pickerPanel = null; }
                });
                pickerPanel.appendChild(item);
              });
              if (outs.length === 0) {
                var empty = document.createElement('div');
                empty.textContent = '未检测到输出设备';
                empty.style.cssText = 'padding:6px;color:#999;';
                pickerPanel.appendChild(empty);
              }
            }).catch(function(){});
          });

          document.documentElement.appendChild(pickerPanel);
          // 点击外部关闭
          setTimeout(function(){
            document.addEventListener('click', function onDoc(e){
              if (pickerPanel && !pickerPanel.contains(e.target) && e.target !== pickerBtn) {
                pickerPanel.remove(); pickerPanel = null;
                document.removeEventListener('click', onDoc);
              }
            });
          }, 0);
        }

        api = window.__gameAudio = {
          setVolume: function(next) {
            state.volume = next;
            contexts.forEach(function(ctx) {
              try { if (ctx.__masterGain) ctx.__masterGain.gain.value = next; } catch(e) {}
            });
            applyMedia();
          },
          setSink: function(nextLabel) {
            state.label = nextLabel || '';
            resolveSinkId(applySinkId);
          },
          // 直接设置游戏窗口源内的 deviceId（由大厅页面传过来，无需 label 匹配）
          setSinkIdDirect: function(deviceId) {
            state.sinkId = deviceId || '';
            state.label = '';
            state.__matchedLabel = deviceId ? '(direct)' : '';
            applySinkId();
          },
          applyMedia: applyMedia,
          showDevicePicker: showDevicePanel,
          // 暴露内部状态供主进程诊断
          __state: state,
          __contexts: contexts,
          __getMediaCtx: getMediaCtx,
          __routedMedia: routedMedia,
          // 收集诊断信息
          diagnose: function() {
            var result = {
              hasApi: true,
              state: { volume: state.volume, sinkId: state.sinkId || '(default)', label: state.label, matchedLabel: state.__matchedLabel || '' },
              contexts: [],
              media: { total: 0, routed: 0, fallback: 0 },
              mediaCtx: null,
            };
            contexts.forEach(function(ctx, i) {
              result.contexts.push({
                index: i,
                sinkId: ctx.sinkId || '(empty/default)',
                state: ctx.state,
                isMediaCtx: ctx === mediaCtx,
                hasMasterGain: !!ctx.__masterGain,
                supportsSetSinkId: typeof ctx.setSinkId === 'function',
              });
            });
            if (mediaCtx) {
              result.mediaCtx = { sinkId: mediaCtx.sinkId || '(empty/default)', state: mediaCtx.state };
            }
            var els = document.querySelectorAll('audio, video');
            result.media.total = els.length;
            els.forEach(function(el) {
              if (routedMedia.has(el)) result.media.routed++;
              else result.media.fallback++;
            });
            return result;
          },
        };

        new MutationObserver(applyMedia).observe(document.documentElement, { childList: true, subtree: true });
        applyMedia();
        // 创建浮动设备选择按钮
        buildDevicePicker();
        // 首次安装：按 label 解析本地 deviceId 并应用；若匹配失败则弹出选择器让用户手动选
        resolveSinkId(function(){
          applySinkId();
          if (state.label && !state.sinkId) {
            // 主窗口传的 label 在游戏窗口里匹配不到，弹出选择器
            setTimeout(showDevicePanel, 800);
          }
        });
      }
      api.setVolume(v);
      api.setSink(targetLabel);
    })();
  `
}

/** 把当前音频状态注入到游戏窗口（页面重载或设置变化时调用） */
function injectGameAudio(win: BrowserWindow) {
  if (win.isDestroyed()) return
  const { volume, sinkDeviceLabel, sinkDeviceIdDirect } = currentGameAudio
  const script = buildAudioPatchScript(volume, sinkDeviceLabel)

  // 遍历所有框架（主框架 + 所有 iframe）注入，避免游戏在 iframe 里时漏拦截
  const injectFrame = async (frame: Electron.WebFrameMain) => {
    try {
      await frame.executeJavaScript(script)
      // 注入完成后，如果有直接指定的 deviceId（游戏窗口源内），直接应用
      if (sinkDeviceIdDirect) {
        await frame.executeJavaScript(
          `if(window.__gameAudio){window.__gameAudio.setSinkIdDirect(${JSON.stringify(sinkDeviceIdDirect)});}`,
        )
      }
    } catch {
      /* 跨域框架无权限注入，忽略 */
    }
  }

  const frames: Electron.WebFrameMain[] = []
  const collect = (f: Electron.WebFrameMain) => {
    frames.push(f)
    for (const child of f.frames) collect(child)
  }
  try {
    collect(win.webContents.mainFrame)
  } catch {
    frames.push(win.webContents.mainFrame)
  }

  Promise.all(frames.map(injectFrame))
    .then(() => console.log('[game] 音量脚本注入成功, v=', clampVolume(volume), ', frames=', frames.length))
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
  sinkDeviceLabel?: string
  /** 游戏窗口源内的 deviceId（直接 setSinkId，不走 label 匹配） */
  sinkDeviceIdDirect?: string
}): boolean {
  currentGameAudio = {
    mute: options.mute ?? currentGameAudio.mute,
    volume: clampVolume(options.volume ?? currentGameAudio.volume),
    sinkDeviceId: options.sinkDeviceId ?? currentGameAudio.sinkDeviceId,
    sinkDeviceLabel: options.sinkDeviceLabel ?? currentGameAudio.sinkDeviceLabel,
    sinkDeviceIdDirect: options.sinkDeviceIdDirect ?? currentGameAudio.sinkDeviceIdDirect,
  }

  const win = currentGameWin
  if (!win || win.isDestroyed()) return false

  win.webContents.setAudioMuted(currentGameAudio.mute)
  injectGameAudio(win)
  return true
}

/**
 * 获取游戏窗口源内枚举到的输出设备列表（带真实 label）。
 * 在游戏窗口内 getUserMedia + enumerateDevices，返回的 deviceId 可直接用于该窗口的 setSinkId。
 */
export async function getGameWindowDevices(): Promise<
  { deviceId: string; label: string; isDefault: boolean }[]
> {
  const win = currentGameWin
  if (!win || win.isDestroyed()) return []
  try {
    const result = await win.webContents.executeJavaScript(`
      (function(){
        return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
          stream.getTracks().forEach(function(t){ t.stop(); });
          return navigator.mediaDevices.enumerateDevices();
        }).then(function(list){
          var outs = list.filter(function(d){ return d.kind === 'audiooutput'; });
          return outs.map(function(d){
            return { deviceId: d.deviceId, label: d.label || d.deviceId, isDefault: d.deviceId === 'default' };
          });
        }).catch(function(){ return []; });
      })();
    `)
    return result as { deviceId: string; label: string; isDefault: boolean }[]
  } catch {
    return []
  }
}

/**
 * 诊断游戏窗口音频状态：注入是否成功、各 AudioContext 的 sinkId、
 * 媒体元素路由情况、设备枚举、speaker-selection 权限、setSinkId 探针。
 * @returns 诊断文本，无游戏窗口时返回提示
 */
export async function getGameAudioDiagnostics(): Promise<string> {
  const win = currentGameWin
  if (!win || win.isDestroyed()) {
    return '【游戏窗口未打开】请先打开一个游戏弹窗，再点击诊断。'
  }

  const lines: string[] = []
  lines.push('=== 游戏弹窗音频诊断 ===')
  lines.push(`当前目标 sinkDeviceId: ${currentGameAudio.sinkDeviceId || '(default)'} (label: ${currentGameAudio.sinkDeviceLabel || 'default'})`)
  lines.push(`mute: ${currentGameAudio.mute}, volume: ${currentGameAudio.volume}`)

  // 1. 注入脚本内部状态
  try {
    const diag: unknown = await win.webContents.executeJavaScript(`
      (function(){
        try {
          if (window.__gameAudio && typeof window.__gameAudio.diagnose === 'function') {
            return window.__gameAudio.diagnose();
          }
          return { hasApi: false };
        } catch(e) { return { hasApi: false, error: String(e) }; }
      })();
    `)
    const d = diag as {
      hasApi: boolean
      state?: { volume: number; sinkId: string }
      contexts?: Array<{ sinkId: string; state: string; isMediaCtx: boolean; hasMasterGain: boolean; supportsSetSinkId: boolean }>
      media?: { total: number; routed: number; fallback: number }
      mediaCtx?: { sinkId: string; state: string } | null
      error?: string
    }
    if (d.error) {
      lines.push(`注入脚本异常: ${d.error}`)
    } else if (!d.hasApi) {
      lines.push('注入脚本未安装（window.__gameAudio 不存在）—— 页面可能未加载完成或跨源隔离拦截')
    } else {
      lines.push(`\n[注入状态] volume=${d.state?.volume}, 目标label=${(d.state as {label?:string})?.label || '(default)'}, 匹配到=${(d.state as {matchedLabel?:string})?.matchedLabel || '(无)'}, 解析sinkId=${d.state?.sinkId || '(default)'}`)
      lines.push(`[AudioContext 数量] ${d.contexts?.length ?? 0}`)
      d.contexts?.forEach((c, i) => {
        lines.push(
          `  ctx[${i}] sinkId=${c.sinkId} state=${c.state} mediaCtx=${c.isMediaCtx} ` +
            `masterGain=${c.hasMasterGain} supportsSetSinkId=${c.supportsSetSinkId}`,
        )
      })
      if (d.mediaCtx) {
        lines.push(`[共享媒体 ctx] sinkId=${d.mediaCtx.sinkId} state=${d.mediaCtx.state}`)
      } else {
        lines.push('[共享媒体 ctx] 未创建（页面可能还没有 audio/video 元素）')
      }
      lines.push(
        `[媒体元素] total=${d.media?.total ?? 0} routed=${d.media?.routed ?? 0} fallback=${d.media?.fallback ?? 0}`,
      )
    }
  } catch (e) {
    lines.push(`执行诊断脚本失败: ${String(e)}`)
  }

  // 2. 设备枚举（游戏窗口内）
  try {
    const devices = await win.webContents.executeJavaScript(`
      navigator.mediaDevices.enumerateDevices().then(function(list){
        return list.filter(function(d){ return d.kind === 'audiooutput'; })
          .map(function(d){ return d.deviceId + ' || ' + d.label; });
      });
    `)
    const devs = devices as string[]
    lines.push(`\n[游戏窗口枚举到的输出设备] (${devs.length})`)
    devs.forEach((x) => lines.push(`  ${x}`))
  } catch (e) {
    lines.push(`枚举设备失败: ${String(e)}`)
  }

  // 3. speaker-selection 权限
  try {
    const perm = await win.webContents.executeJavaScript(`
      navigator.permissions.query({ name: 'speaker-selection' }).then(function(p){ return p.state; });
    `)
    lines.push(`\n[speaker-selection 权限] ${perm}`)
  } catch (e) {
    lines.push(`权限查询失败: ${String(e)}`)
  }

  // 4. setSinkId 探针：在游戏窗口源内按 label 匹配本地 deviceId 后再测
  try {
    const probe = await win.webContents.executeJavaScript(`
      (function(){
        var label = ${JSON.stringify(currentGameAudio.sinkDeviceLabel || '')};
        return navigator.mediaDevices.enumerateDevices().then(function(list){
          var target = '';
          var matched = '';
          if (label && label !== 'default') {
            var want = label.toLowerCase();
            for (var i = 0; i < list.length; i++) {
              var d = list[i];
              if (d.kind === 'audiooutput' && d.label && d.label.toLowerCase().indexOf(want) !== -1) {
                target = d.deviceId; matched = d.label; break;
              }
            }
          }
          if (!target) return '未按 label 匹配到设备，使用 default (label=' + (label||'(空)') + ')';
          try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            return ctx.setSinkId(target).then(function(){
              return 'resolve, matched=' + matched + ', ctx.sinkId=' + (ctx.sinkId || '(empty/default)');
            }).catch(function(e){
              return 'reject: ' + String(e) + ' (matched=' + matched + ')';
            });
          } catch(e) { return 'create-context-fail: ' + String(e); }
        });
      })();
    `)
    lines.push(`\n[setSinkId 探针] label=${currentGameAudio.sinkDeviceLabel || 'default'} → ${probe}`)
  } catch (e) {
    lines.push(`探针失败: ${String(e)}`)
  }

  return lines.join('\n')
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
  options: { mute?: boolean; volume?: number; sinkDeviceId?: string; sinkDeviceLabel?: string } = {},
) {
  const { mute = false, volume = 1, sinkDeviceId = '', sinkDeviceLabel = '' } = options

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
  currentGameAudio = {
    mute,
    volume: clampVolume(volume),
    sinkDeviceId,
    sinkDeviceLabel,
    sinkDeviceIdDirect: '',
  }
  console.log('[game] 设置音频:', currentGameAudio)
  gameWin.webContents.setAudioMuted(mute)

  // 页面加载完注一次，再延迟注两次（SPA 游戏可能动态创建 AudioContext）
  // dom-ready 比 did-finish-load 更早，尽量在游戏创建 AudioContext 之前安装拦截
  // did-frame-finish-load 覆盖 iframe 加载完成的场景
  const inject = () => injectGameAudio(gameWin)
  gameWin.webContents.on('dom-ready', inject)
  gameWin.webContents.on('did-finish-load', inject)
  gameWin.webContents.on('did-frame-finish-load', inject)
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
