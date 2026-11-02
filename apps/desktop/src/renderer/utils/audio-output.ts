/**
 * 音频输出设备统一路由
 *
 * 背景：HTMLAudioElement.setSinkId 在 Windows 上会"静默回退"——Promise resolve、
 * 读回 sinkId 正确，但声音仍从扬声器出。因此统一走 Web Audio：
 *   单例 AudioContext.setSinkId(deviceId) 控制整个上下文的输出设备，
 *   所有 HTMLAudioElement 通过 createMediaElementSource → gain → ctx.destination 接入。
 *
 * 默认设备：setSinkId('') 回退到系统默认；
 * 其它设备：setSinkId(deviceId) 直接指定。
 */

const DEVICE_KEY = 'audio-output-device-id'

/** 全局唯一的 AudioContext，所有应用内音频都汇到这里统一控制输出设备 */
let audioCtx: AudioContext | null = null
/** 当前选中的输出设备 id（'' 表示系统默认） */
let currentDeviceId = ''
/** 已注册的路由元素清理函数集合 */
const routedCleanups = new Set<() => void>()
/** 已接入路由的元素（防止同一元素被重复 createMediaElementSource 导致双重播放/回音） */
const routedElements = new WeakSet<HTMLAudioElement>()

function getCtx(): AudioContext {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = new Ctor()
    // 立即尝试恢复（suspended 状态下音频会被缓冲，恢复时可能集中播放产生回音）
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

/** 把当前设备应用到 AudioContext（setSinkId） */
async function applyDeviceToCtx(): Promise<void> {
  const ctx = getCtx()
  if (typeof (ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId !== 'function') {
    console.warn('[audio-output] 当前环境不支持 AudioContext.setSinkId')
    return
  }
  try {
    // '' 表示系统默认设备
    await (ctx as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(currentDeviceId)
  } catch (e) {
    console.warn('[audio-output] setSinkId 失败，回退默认设备:', e)
    try {
      await (ctx as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId('')
    } catch {
      /* ignore */
    }
  }
}

/**
 * 把一个 HTMLAudioElement 接入统一路由。
 * 元素自身的 volume / muted 仍可控制音量；输出设备由 AudioContext.setSinkId 统一控制。
 * 返回清理函数（断开 MediaElementSource）。
 */
export function routeAudioElement(el: HTMLAudioElement): () => void {
  // 防止同一元素被重复接入：重复 createMediaElementSource 会抛错或产生双重播放
  if (routedElements.has(el)) {
    return () => {}
  }
  routedElements.add(el)
  const ctx = getCtx()
  let source: MediaElementAudioSourceNode | null = null
  try {
    source = ctx.createMediaElementSource(el)
    const gain = ctx.createGain()
    gain.gain.value = 1
    source.connect(gain)
    gain.connect(ctx.destination)
  } catch (e) {
    // 跨域等原因无法接入，回退到直接 setSinkId（macOS 上通常可用）
    console.warn('[audio-output] createMediaElementSource 失败，回退 element.setSinkId:', e)
    const fallback = () => {
      const id = currentDeviceId || 'default'
      if (id !== 'default' && typeof el.setSinkId === 'function') {
        el.setSinkId(id).catch(() => {})
      }
    }
    fallback()
    const onDevice = () => fallback()
    window.addEventListener('audio-output-device-change', onDevice)
    const cleanup = () => window.removeEventListener('audio-output-device-change', onDevice)
    routedCleanups.add(cleanup)
    return cleanup
  }

  const cleanup = () => {
    try {
      source?.disconnect()
    } catch {
      /* ignore */
    }
  }
  routedCleanups.add(cleanup)
  // 确保已应用当前设备
  void applyDeviceToCtx()
  return cleanup
}

/** 设置输出设备（'' 或 'default' 表示系统默认），实时生效 */
export function setOutputDevice(deviceId: string): void {
  currentDeviceId = deviceId && deviceId !== 'default' ? deviceId : ''
  void applyDeviceToCtx()
  window.dispatchEvent(new CustomEvent('audio-output-device-change', { detail: currentDeviceId || 'default' }))
}

/** 从 localStorage 读取并初始化输出设备（应用启动时调用一次） */
export function initAudioOutput(): void {
  const saved = localStorage.getItem(DEVICE_KEY)
  currentDeviceId = saved && saved !== 'default' ? saved : ''
  void applyDeviceToCtx()
}

/** 当前选中的输出设备 id（'' 表示默认） */
export function getCurrentDeviceId(): string {
  return currentDeviceId
}

/** AudioContext 当前实际的 sinkId（用于诊断） */
export async function getCtxSinkId(): Promise<string> {
  const ctx = getCtx()
  return (ctx as AudioContext & { sinkId?: string }).sinkId ?? ''
}

/** 是否支持 AudioContext.setSinkId */
export function supportsSetSinkId(): boolean {
  const ctx = getCtx()
  return typeof (ctx as AudioContext & { setSinkId?: unknown }).setSinkId === 'function'
}

// ============================================================================
// 设备枚举过滤
// ============================================================================

export interface OutputDevice {
  deviceId: string
  label: string
  isDefault: boolean
}

/**
 * 过滤 enumerateDevices 的原始列表，收敛虚拟声卡：
 * - VB-CABLE：只保留 "CABLE Input (VB-Audio Virtual Cable)"，
 *   排除 "Communications - CABLE Input" 与 "CABLE In 16ch"
 * - BlackHole：只保留一个
 * - 默认设备：保留 Chromium 的 deviceId='default' 别名，置于列表首位
 */
export function filterOutputDevices(list: MediaDeviceInfo[]): OutputDevice[] {
  const kept: OutputDevice[] = []
  const seen = new Set<string>()

  for (const d of list) {
    if (d.kind !== 'audiooutput' || !d.deviceId) continue
    const label = d.label || d.deviceId
    const lower = label.toLowerCase()

    // CABLE 收敛：只保留标准 "CABLE Input"
    if (lower.includes('cable')) {
      if (
        lower.includes('communications') ||
        lower.includes('16ch') ||
        lower.includes('output') ||
        /cable\s+in\b/.test(lower)
      ) {
        continue
      }
    }

    const key = lower
    if (seen.has(key)) continue
    seen.add(key)

    kept.push({
      deviceId: d.deviceId,
      label,
      isDefault: d.deviceId === 'default',
    })
  }

  // BlackHole 只留一个（优先 2ch）
  const blackholes = kept.filter((d) => d.label.toLowerCase().includes('blackhole'))
  if (blackholes.length > 1) {
    const prefer2ch =
      blackholes.find((d) => /2ch/.test(d.label.toLowerCase())) || blackholes[0]
    for (let i = kept.length - 1; i >= 0; i--) {
      if (
        kept[i].label.toLowerCase().includes('blackhole') &&
        kept[i].deviceId !== prefer2ch.deviceId
      ) {
        kept.splice(i, 1)
      }
    }
  }

  // 默认设备置首
  const def = kept.find((d) => d.deviceId === 'default')
  if (def) {
    const rest = kept.filter((d) => d.deviceId !== 'default')
    kept.length = 0
    kept.push(def, ...rest)
  }

  return kept
}

/** 校验已保存的 deviceId 是否仍在当前列表中，否则返回 'default' */
export function resolveValidDeviceId(
  saved: string | null,
  devices: OutputDevice[],
): string {
  if (!saved || saved === 'default') return 'default'
  const exists = devices.some((d) => d.deviceId === saved)
  return exists ? saved : 'default'
}
