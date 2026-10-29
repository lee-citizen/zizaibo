<template>
  <title-bar />

  <div class="layout flex">
    <Sidebar />
    <div class="main flex-1">
      <StatusBar />
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </div>
  </div>
</template>

<script setup lang="ts">
import TitleBar from "@renderer/components/title-bar/title-bar.vue";
import { ipc } from "@renderer/utils/ipcRenderer";
import Sidebar from "@renderer/components/sidebar/sidebar.vue";
import StatusBar from "@renderer/components/status-bar/status-bar.vue";
import { onMounted } from "vue";
onMounted(() => {
  ipc.app.winReady();
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
