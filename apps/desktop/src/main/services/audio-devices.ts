import { execSync, exec } from 'child_process'

/** 音频设备信息 */
export interface AudioDevice {
  /** 设备名称 */
  name: string
  /** 是否当前默认输出设备 */
  isDefault: boolean
}

/** 执行系统命令拿当前默认输出设备名（跨平台） */
export function getDefaultOutputDeviceName(): string | null {
  try {
    if (process.platform === 'darwin') {
      // system_profiler 格式：设备名在上面一行，下面有 "Default Output Device: Yes"
      // 用 grep -B5 往前找 5 行，取第一行就是设备名
      const out = execSync(
        `system_profiler SPAudioDataType 2>/dev/null | grep -B2 "Default Output Device: Yes" | head -1 | sed 's/^[[:space:]]*//' | sed 's/:$//'`,
        { encoding: 'utf-8' }
      ).trim()
      console.log('[audio] macOS 默认输出设备:', out || '(空)')
      return out || null
    }
    else if (process.platform === 'win32') {
      const ps = `Get-PnpDevice -Class AudioEndpoint | Where-Object {$_.Status -eq 'OK' -and $_.FriendlyName -match '扬声器|Speakers'} | Select-Object -First 1 -ExpandProperty FriendlyName`
      const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf-8' }).trim()
      console.log('[audio] Windows 默认输出设备:', out || '(空)')
      return out || null
    }
    else {
      const out = execSync('pactl get-default-sink 2>/dev/null', { encoding: 'utf-8' }).trim()
      console.log('[audio] Linux 默认输出设备:', out || '(空)')
      return out || null
    }
  } catch (e) {
    console.error('[audio] 获取默认输出设备失败:', e)
    return null
  }
}

/** 检测虚拟声卡是否已安装，返回设备名（未安装返回 null）
 *  macOS: BlackHole
 *  Windows: VB-CABLE (CABLE Input / CABLE Output)
 */
export function detectVirtualAudioDevice(): string | null {
  try {
    if (process.platform === 'darwin') {
      // BlackHole 设备名包含 "BlackHole"
      const out = execSync(
        `system_profiler SPAudioDataType 2>/dev/null | grep -i "BlackHole" | head -1 | sed 's/^[[:space:]]*//' | sed 's/:$//'`,
        { encoding: 'utf-8' }
      ).trim()
      console.log('[audio] 检测 BlackHole:', out || '(未安装)')
      return out || null
    }
    else if (process.platform === 'win32') {
      // VB-CABLE 设备名包含 "CABLE"
      const ps = `Get-PnpDevice -Class AudioEndpoint | Where-Object {$_.FriendlyName -match 'CABLE'} | Select-Object -First 1 -ExpandProperty FriendlyName`
      const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf-8' }).trim()
      console.log('[audio] 检测 VB-CABLE:', out || '(未安装)')
      return out || null
    }
    return null
  } catch (e) {
    console.error('[audio] 检测虚拟声卡失败:', e)
    return null
  }
}

/** 打开系统音量合成器/声音设置（跨平台） */
export function openSystemMixer(): void {
  try {
    if (process.platform === 'win32') {
      exec('sndvol.exe')
    }
    else if (process.platform === 'darwin') {
      exec('open x-apple.systempreferences:com.apple.preference.sound')
    }
    else {
      exec('pavucontrol')
    }
  } catch (e) {
    console.error('[audio] 打开系统音量设置失败:', e)
  }
}