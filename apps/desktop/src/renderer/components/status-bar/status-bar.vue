<template>
  <nav
    class="h-10 px-4 border-t flex items-center justify-between text-xs text-slate-400"
  >
    <!-- 左侧状态 -->
    <div class="flex items-center gap-4">
      <!-- 直播连接状态 -->
      <div class="flex items-center gap-1.5">
        <span class="relative flex h-2 w-2">
          <span
            class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
            :class="connect.connected ? 'bg-green-400' : 'bg-red-400'"
          ></span>
          <span
            class="relative inline-flex rounded-full h-2 w-2"
            :class="connect.connected ? 'bg-green-500' : 'bg-red-500'"
          ></span>
        </span>
        <span :class="connect.connected ? 'text-green-500' : ''">{{
          connect.connected ? '已连接直播间' : '未连接直播间'
        }}</span>
      </div>

      <!-- 分割线 -->
      <span class="h-3 w-px bg-slate-700/60"></span>

      <!-- 会员状态 -->
      <div class="flex items-center gap-1.5">
        <svg
          class="w-3.5 h-3.5"
          :class="auth.authorized ? 'text-amber-400' : 'text-slate-500'"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
          />
        </svg>
        <span :class="auth.authorized ? 'text-amber-400' : 'text-slate-500'">{{
          membershipText
        }}</span>
      </div>
    </div>

    <!-- 右侧操作 -->
    <div class="flex items-center gap-2">
      <!-- 仅在已连接直播间时显示隐藏/显示按钮 -->
      <el-button
        v-if="connect.connected"
        size="small"
        :type="connect.roomHidden ? 'primary' : 'default'"
        @click="toggleRoomVisibility"
      >
        <span>{{ connect.roomHidden ? '显示直播画面窗口' : '隐藏直播画面窗口' }}</span>
      </el-button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useConnectStore } from '@renderer/store/modules/connect'
import { useAuthStore } from '@renderer/store/modules/auth'
import { ipc } from '@renderer/utils/ipcRenderer'
import { ElMessage } from 'element-plus'

const connect = useConnectStore()
const auth = useAuthStore()

/** 会员状态文案 */
const membershipText = computed(() => {
  if (!auth.authorized) return '未激活'
  if (auth.licenseType === 'permanent') return '永久会员'
  if (auth.expiresAt) {
    const d = new Date(auth.expiresAt * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `时长会员 · 至 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return '时长会员'
})

/** 切换直播间窗口的显示/隐藏（隐藏后弹幕采集不中断） */
async function toggleRoomVisibility(): Promise<void> {
  if (!connect.windowId) return
  try {
    if (connect.roomHidden) {
      await ipc.app.connectShowRoom({ windowId: connect.windowId })
      connect.roomHidden = false
    } else {
      await ipc.app.connectHideRoom({ windowId: connect.windowId })
      connect.roomHidden = true
    }
  } catch (e) {
    ElMessage.error({
      message: connect.roomHidden ? '显示直播间失败' : '隐藏直播间失败',
      offset: 40,
    })
  }
}
</script>
