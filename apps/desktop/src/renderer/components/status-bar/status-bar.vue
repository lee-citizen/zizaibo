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
          class="w-3.5 h-3.5 text-amber-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
          />
        </svg>
        <span>会员有效 · 2026-10-28 01:50:59</span>
      </div>
    </div>

    <!-- 右侧操作 -->
    <el-button size="small">
      <span>隐藏直播画面窗口</span>
    </el-button>
  </nav>
</template>

<script setup lang="ts">
import { useConnectStore } from '@renderer/store/modules/connect'

const connect = useConnectStore()
</script>
