<template>
  <div class="music-page h-full overflow-y-auto bg-gray-50">
    <div class="px-8 py-6 space-y-5">
      <!-- 标题 -->
      <div class="flex items-center gap-2">
        <span class="text-2xl">🎵</span>
        <h1 class="text-2xl font-bold text-gray-800">背景音乐</h1>
      </div>

      <!-- 工具栏 -->
      <div class="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <div class="flex items-center gap-3 flex-wrap">
          <el-button type="primary" :icon="bgm.isPlaying ? VideoPause : VideoPlay" @click="bgm.togglePlay">
            {{ bgm.isPlaying ? "暂停" : "播放" }}
          </el-button>
          <el-button :icon="RefreshRight" @click="bgm.toggleLoopMode">
            {{ bgm.loopMode === "list" ? "列表循环" : "单曲循环" }}
          </el-button>
          <el-button type="success" :icon="Plus" @click="bgm.addUserMusic">
            添加自己的音乐
          </el-button>
          <el-button type="danger" :icon="Delete" @click="onClearAll" :disabled="!bgm.playlist.length">
            全部删除
          </el-button>
          <el-button :icon="RefreshLeft" @click="bgm.restoreBuiltin">恢复内置</el-button>
          <el-button :type="bgm.showOnlyFavorites ? 'warning' : 'default'" :icon="Star" @click="bgm.toggleFavoriteFilter">
            {{ bgm.showOnlyFavorites ? `全部 (${bgm.playlist.length})` : `仅看收藏 (${bgm.favoriteCount})` }}
          </el-button>
        </div>
      </div>

      <!-- 当前曲目 + 上下首（无进度条） -->
      <div class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="text-xs text-gray-400 mb-1">当前播放</p>
            <p class="text-base font-medium text-gray-800 truncate">
              {{ bgm.currentTrack ? bgm.currentTrack.name : "未选择曲目" }}
            </p>
          </div>
          <div class="flex items-center gap-2 text-sm text-gray-500">
            <button
              class="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors disabled:opacity-40"
              :disabled="!bgm.playlist.length" @click="bgm.playPrev">
              <el-icon>
                <CaretLeft />
              </el-icon>
            </button>
            <button
              class="w-11 h-11 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center transition-colors disabled:opacity-40"
              :disabled="!bgm.playlist.length" @click="bgm.togglePlay">
              <el-icon>
                <component :is="bgm.isPlaying ? VideoPause : VideoPlay" />
              </el-icon>
            </button>
            <button
              class="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors disabled:opacity-40"
              :disabled="!bgm.playlist.length" @click="bgm.playNext">
              <el-icon>
                <CaretRight />
              </el-icon>
            </button>
          </div>
        </div>
      </div>

      <!-- 音量 + 状态 -->
      <div class="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <div class="flex items-center gap-4 flex-wrap">
          <button
            class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
            @click="bgm.toggleMute">
            <el-icon>
              <component :is="bgm.muted || bgm.volume === 0 ? Mute : Headset" />
            </el-icon>
          </button>
          <span class="text-sm text-gray-500 whitespace-nowrap">音量</span>
          <el-slider :model-value="bgm.volume" class="flex-1 max-w-xs" :min="0" :max="100" :step="1"
            :disabled="bgm.muted" show-input @update:model-value="bgm.setVolume" />
          <span class="text-sm text-gray-500 whitespace-nowrap">
            {{ bgm.muted ? 0 : bgm.volume }}%
          </span>

          <div class="ml-auto flex items-center gap-2 text-sm text-gray-500">
            <span class="inline-flex items-center gap-1.5" :class="bgm.isPlaying ? 'text-green-600' : 'text-gray-400'">
              <span class="w-2 h-2 rounded-full" :class="bgm.isPlaying ? 'bg-green-500' : 'bg-gray-300'" />
              {{ bgm.isPlaying ? "正在播放" : "已停止" }}
            </span>
            <span class="text-gray-300">|</span>
            <span>共 {{ bgm.playlist.length }} 首</span>
          </div>
        </div>
      </div>

      <!-- 播放列表 -->
      <div class="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div v-if="bgm.filteredPlaylist.length" class="divide-y divide-gray-100">
          <div v-for="(track, index) in bgm.filteredPlaylist" :key="track.id"
            class="flex items-center gap-3 px-4 py-3 transition-colors"
            :class="index === bgm.currentIndex ? 'bg-blue-50' : 'hover:bg-gray-50'">
            <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0" :class="index === bgm.currentIndex && bgm.isPlaying
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-500'
              ">
              {{ index === bgm.currentIndex && bgm.isPlaying ? "♪" : index + 1 }}
            </span>
            <span class="flex-1 truncate text-sm"
              :class="index === bgm.currentIndex ? 'text-blue-600 font-medium' : 'text-gray-700'">
              {{ track.name }}
            </span>
            <button
              class="w-7 h-7 rounded-full flex items-center justify-center transition-colors shrink-0"
              :class="bgm.isFavorite(track.id) ? 'text-yellow-400' : 'text-gray-300 hover:text-gray-400'"
              :title="bgm.isFavorite(track.id) ? '取消收藏' : '收藏'"
              @click="bgm.toggleFavorite(track.id)">
              <el-icon>
                <component :is="bgm.isFavorite(track.id) ? StarFilled : Star" />
              </el-icon>
            </button>
            <el-button size="small" text type="primary" @click="bgm.playTrack(index)">
              {{ index === bgm.currentIndex && bgm.isPlaying ? "暂停" : "播放" }}
            </el-button>
            <el-button size="small" text type="danger" @click="bgm.removeTrack(index)">
              删除
            </el-button>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="px-8 py-16 text-center text-gray-400">
          <svg class="w-16 h-16 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9 19V6l12-3v13M9 19c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3zm12-3c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3z" />
          </svg>
          <p>暂无音乐，点击「添加自己的音乐」或「恢复内置」</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBgmStore } from "@renderer/store/modules/bgm";
import { ElMessageBox } from "element-plus";
import {
  VideoPlay,
  VideoPause,
  RefreshRight,
  RefreshLeft,
  Plus,
  Delete,
  CaretLeft,
  CaretRight,
  Mute,
  Headset,
  Star,
  StarFilled,
} from "@element-plus/icons-vue";

const bgm = useBgmStore();

async function onClearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      "确定要清空播放列表吗？用户上传的音乐将从磁盘删除，内置音乐将被隐藏。",
      "提示",
      {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
        offset: 40,
      },
    );
    await bgm.clearAll();
  } catch {
    /* 用户取消 */
  }
}
</script>

<style lang="scss" scoped>
.music-page {
  min-height: 100%;
}
</style>
