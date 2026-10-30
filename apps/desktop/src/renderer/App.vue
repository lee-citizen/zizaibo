<template>
  <title-bar />

  <div class="layout flex">
    <Sidebar />
    <div class="main flex-1 flex flex-col min-h-0">
      <!-- 页面内容区：flex:1 + min-h:0 让子页面的 h-full overflow-y-auto 正确工作 -->
      <div class="page-container flex-1 min-h-0 overflow-hidden">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </div>
      <StatusBar />
    </div>
  </div>
</template>

<script setup lang="ts">
import TitleBar from "@renderer/components/title-bar/title-bar.vue";
import { ipc } from "@renderer/utils/ipcRenderer";
import Sidebar from "@renderer/components/sidebar/sidebar.vue";
import StatusBar from "@renderer/components/status-bar/status-bar.vue";
import { onMounted } from "vue";
import { useSpeechStore } from "@renderer/store/modules/speech";

const speech = useSpeechStore();

onMounted(() => {
  ipc.app.winReady();
  // 首次启动自动选中系统默认播放设备
  void speech.ensureDefaultOutputDevice();
});
</script>

<style lang="scss" scoped>
.main {
  box-sizing: border-box;
}

.layout {
  height: 100%;
  padding-top: 30px;
  background: #f7f9f9;
  overflow: hidden;
}
</style>
