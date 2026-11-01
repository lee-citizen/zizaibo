import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ipc } from '@renderer/utils/ipcRenderer'
import request, { setAuthToken } from '@renderer/utils/request'

/** electron-store 中存储授权信息的 key */
const STORE_TOKEN_KEY = 'auth:token'
const STORE_CARD_KEY = 'auth:cardKey'
const STORE_SETTINGS_KEY = 'auth:settings'

interface ActivationResult {
  token: string
  authorized: boolean
  license_type: 'permanent' | 'duration'
  expires_at: number | null
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref('')
  const deviceId = ref('')
  const authorized = ref(false)
  const licenseType = ref<'permanent' | 'duration'>('permanent')
  const expiresAt = ref<number | null>(null)
  const rememberKey = ref(true)
  const autoLogin = ref(false)
  /** 记住的卡密（仅 rememberKey=true 时持久化） */
  const rememberedCardKey = ref('')
  /** 鉴权中（启动时用） */
  const verifying = ref(false)

  const isAuthorized = computed(() => authorized.value)

  /** 从 electron-store 读取已保存的授权信息 */
  async function loadSaved() {
    try {
      const t = await ipc.app.getStoreValue({ key: STORE_TOKEN_KEY })
      token.value = (t as string) || ''
      setAuthToken(token.value)
      const settings = (await ipc.app.getStoreValue({ key: STORE_SETTINGS_KEY })) as
        | { rememberKey?: boolean; autoLogin?: boolean }
        | undefined
      if (settings) {
        rememberKey.value = settings.rememberKey ?? true
        autoLogin.value = settings.autoLogin ?? false
      }
      const ck = await ipc.app.getStoreValue({ key: STORE_CARD_KEY })
      rememberedCardKey.value = (ck as string) || ''
    } catch {
      /* ignore */
    }
  }

  /** 持久化授权信息 */
  async function persist() {
    try {
      await ipc.app.setStoreValue({ key: STORE_TOKEN_KEY, value: token.value })
      await ipc.app.setStoreValue({
        key: STORE_SETTINGS_KEY,
        value: { rememberKey: rememberKey.value, autoLogin: autoLogin.value },
      })
      // 卡密仅在记住卡密时保存
      if (rememberKey.value) {
        await ipc.app.setStoreValue({ key: STORE_CARD_KEY, value: rememberedCardKey.value })
      } else {
        await ipc.app.deleteStoreValue({ key: STORE_CARD_KEY })
      }
    } catch {
      /* ignore */
    }
  }

  /** 获取机器码 */
  async function ensureDeviceId() {
    if (!deviceId.value) {
      deviceId.value = (await ipc.app.getMachineId()) || ''
    }
    return deviceId.value
  }

  /**
   * 卡密激活
   * 成功后保存 token，再次调用 verify 确认授权状态
   */
  async function activate(cardKey: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = cardKey.trim()
    if (!trimmed) return { ok: false, message: '请输入卡密' }

    const did = await ensureDeviceId()
    try {
      const res = await request.post('/api/v1/activation', {
        card_key: trimmed,
        device_id: did,
      })
      const data = res.data as { code: string; data?: ActivationResult; message?: string }
      if (data.code === 'OK' && data.data?.authorized) {
        token.value = data.data.token
        setAuthToken(token.value)
        licenseType.value = data.data.license_type
        expiresAt.value = data.data.expires_at
        authorized.value = true
        rememberedCardKey.value = trimmed
        await persist()
        return { ok: true, message: '激活成功' }
      }
      return { ok: false, message: data.message || '激活失败' }
    } catch (e: any) {
      const resp = e?.response?.data
      const code = resp?.code
      let msg = resp?.message || '激活失败，请检查网络'
      if (code === 'INVALID_CARD') msg = '卡密无效或已禁用'
      else if (code === 'CARD_USED') msg = '卡密已绑定其他设备'
      return { ok: false, message: msg }
    }
  }

  /**
   * 启动鉴权：用本地 token 调用游戏列表接口验证有效性
   * 文档未单独提供鉴权接口，游戏列表接口需要 token，可兼作鉴权
   */
  async function verify(): Promise<boolean> {
    if (!token.value) {
      authorized.value = false
      return false
    }
    verifying.value = true
    try {
      const res = await request.get('/api/v1/games', {
        headers: { Authorization: `Bearer ${token.value}` },
      })
      const data = res.data as { code: string }
      if (data.code === 'OK') {
        authorized.value = true
        return true
      }
      authorized.value = false
      return false
    } catch (e: any) {
      // 401 或其他错误 → token 无效
      authorized.value = false
      return false
    } finally {
      verifying.value = false
    }
  }

  /** 退出登录：清除 token，不清除记住的卡密（可选） */
  async function logout(clearCardKey = false) {
    token.value = ''
    setAuthToken('')
    authorized.value = false
    licenseType.value = 'permanent'
    expiresAt.value = null
    if (clearCardKey) {
      rememberedCardKey.value = ''
      rememberKey.value = false
      autoLogin.value = false
    }
    await persist()
  }

  /** 自动登录：用记住的卡密自动激活 */
  async function tryAutoLogin(): Promise<boolean> {
    if (!autoLogin.value || !rememberedCardKey.value) return false
    const result = await activate(rememberedCardKey.value)
    return result.ok
  }

  return {
    token,
    deviceId,
    authorized,
    licenseType,
    expiresAt,
    rememberKey,
    autoLogin,
    rememberedCardKey,
    verifying,
    isAuthorized,
    loadSaved,
    ensureDeviceId,
    activate,
    verify,
    logout,
    tryAutoLogin,
  }
})
