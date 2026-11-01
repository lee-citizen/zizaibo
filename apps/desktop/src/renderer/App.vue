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
import { useRouter } from "vue-router";
import { useSpeechStore } from "@renderer/store/modules/speech";
import { useAuthStore } from "@renderer/store/modules/auth";

const speech = useSpeechStore();
const auth = useAuthStore();
const router = useRouter();

/** 启动鉴权流程 */
async function bootstrapAuth() {
  await auth.loadSaved();
  if (auth.token) {
    // 有 token，调用启动鉴权验证有效性
    const ok = await auth.verify();
    if (!ok) {
      // token 无效，尝试自动登录（用记住的卡密）
      const autoOk = await auth.tryAutoLogin();
      if (!autoOk) {
        router.push("/key");
      }
    }
  } else if (auth.autoLogin && auth.rememberedCardKey) {
    // 没有 token 但开启了自动登录，用记住的卡密激活
    const ok = await auth.tryAutoLogin();
    if (!ok) router.push("/key");
  } else {
    // 无 token 且未开启自动登录 → 激活页
    router.push("/key");
  }
}

onMounted(() => {
  ipc.app.winReady();
  // 首次启动自动选中系统默认播放设备
  void speech.ensureDefaultOutputDevice();
  // 启动鉴权
  void bootstrapAuth();
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
