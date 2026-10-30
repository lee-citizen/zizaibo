<template>
  <!-- 使用系统标题栏时不渲染自定义标题栏 -->
  <template v-if="!IsUseSysTitle">
    <!-- Windows / Linux：自定义标题栏，右上角窗口控制按钮 -->
    <div v-if="isNotMac" class="window-title">
      <div class="title-bar-drag" />
      <div class="window-controls">
        <button
          class="win-btn"
          title="最小化"
          @click="onMinimize"
        >
          <svg class="win-icon" viewBox="0 0 12 12">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          class="win-btn"
          :title="isMaximized ? '还原' : '最大化'"
          @click="onToggleMaximize"
        >
          <!-- 最大化：方框；还原：两个重叠方框 -->
          <svg v-if="!isMaximized" class="win-icon" viewBox="0 0 12 12">
            <rect
              x="1.5"
              y="1.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
          </svg>
          <svg v-else class="win-icon" viewBox="0 0 12 12">
            <rect
              x="1.5"
              y="3"
              width="7.5"
              height="7.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
            <path
              d="M3 3 L3 1.5 L10.5 1.5 L10.5 9 L9 9"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
          </svg>
        </button>
        <button class="win-btn win-close" title="关闭" @click="onClose">
          <svg class="win-icon" viewBox="0 0 12 12">
            <path
              d="M1.5 1.5 L10.5 10.5 M10.5 1.5 L1.5 10.5"
              stroke="currentColor"
              stroke-width="1"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- macOS：保留空标题栏区域，系统红绿灯按钮会自动显示在左上角 -->
    <div v-else class="window-title mac" />
  </template>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ipc } from '@renderer/utils/ipcRenderer'

const IsUseSysTitle = ref(false)
const isNotMac = ref(window.ipcBridge.processInfo.platform !== 'darwin')
const isMaximized = ref(false)

ipc.app.isUseSysTitle().then((res) => {
  IsUseSysTitle.value = res
})

// 同步最大化状态（用户可能双击标题栏或用系统快捷键最大化）
let syncTimer: number | null = null

async function syncMaximized(): Promise<void> {
  try {
    isMaximized.value = await ipc.app.winIsMaximized()
  } catch {
    /* ignore */
  }
}

function onMinimize(): void {
  void ipc.app.winMinimize()
}

function onToggleMaximize(): void {
  void ipc.app.winToggleMaximize()
  void syncMaximized()
}

function onClose(): void {
  void ipc.app.winClose()
}

onMounted(() => {
  void syncMaximized()
  // 定期同步最大化状态，处理双击标题栏等外部触发的最大化
  syncTimer = window.setInterval(() => void syncMaximized(), 500)
})

onUnmounted(() => {
  if (syncTimer !== null) window.clearInterval(syncTimer)
})
</script>

<style rel="stylesheet/scss" lang="scss" scoped>
.window-title {
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 99999;
  background-color: #0f172b;
  border-bottom: 1px solid #1e293b;
  user-select: none;

  // macOS：给系统红绿灯留出左侧空间（红绿灯由系统渲染在左上角）
  &.mac {
    justify-content: flex-start;
    padding-left: 80px;
    // 整条标题栏可拖动窗口；系统红绿灯在独立层，不受 drag 影响仍可点击
    -webkit-app-region: drag;
  }
}

// 拖拽区域：占据左侧所有剩余空间，使标题栏可拖动
.title-bar-drag {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag;
}

.window-controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 46px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: #f1f5f9;
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.15);
  }
}

.win-close:hover {
  background-color: #e81123;
  color: #ffffff;
}

.win-close:active {
  background-color: #c40f1d;
}

.win-icon {
  width: 12px;
  height: 12px;
}
</style>
