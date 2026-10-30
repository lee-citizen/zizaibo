<template>
  <div class="connect-page h-full overflow-y-auto bg-gray-50">
    <div class="px-8 py-6 space-y-5">
      <!-- 标题 -->
      <div class="flex items-center gap-2">
        <span class="text-2xl">🔗</span>
        <h1 class="text-2xl font-bold text-gray-800">连接直播</h1>
        <!-- <el-tag size="small" type="warning" effect="plain" class="ml-1">M1 · 抖音</el-tag> -->
      </div>

      <!-- ========== 地址栏 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div class="flex flex-wrap items-center gap-2">
          <el-input v-model="connect.roomUrlInput" placeholder="粘贴抖音直播间链接，如 https://live.douyin.com/12345678" clearable
            class="flex-1 min-w-[320px]" :disabled="connect.connected" @keyup.enter="onConnect">
            <template #prefix>
              <el-icon>
                <Link />
              </el-icon>
            </template>
          </el-input>
          <el-button v-if="!connect.connected" type="primary" :icon="VideoPlay" :loading="connecting"
            @click="onConnect">
            连接
          </el-button>
          <el-button v-else type="danger" plain :icon="SwitchButton" @click="onDisconnect">
            断开
          </el-button>
        </div>
        <p class="text-xs text-gray-400 mt-2">
          点击连接会弹出独立的直播间窗口，画面与弹幕都在窗口里；若需要登录直接在窗口里扫码，登录状态会记住，采集自动进行
        </p>
      </div>

      <!-- ========== 弹幕面板 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col overflow-hidden"
        style="height: calc(100vh - 300px); min-height: 420px">
        <!-- 统计头 -->
        <div class="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <div class="flex items-center gap-6">
            <div>
              <p class="text-xs text-gray-400">在线人数</p>
              <p class="text-lg font-semibold text-gray-800 leading-tight">
                {{ connect.viewerText || (connect.connected ? "识别中…" : "—") }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-400">弹幕速度</p>
              <p class="text-lg font-semibold text-gray-800 leading-tight">
                {{ connect.connected ? `${connect.rate}/分` : "—" }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-400">已收弹幕</p>
              <p class="text-lg font-semibold text-gray-800 leading-tight">
                {{ connect.connected ? connect.messages.length : "—" }}
              </p>
            </div>
          </div>
          <el-tag :type="connectStatusType" effect="plain" size="small">
            {{ connectStatusText }}
          </el-tag>
        </div>

        <!-- 断流提示 -->
        <div v-if="connect.stalled"
          class="mx-5 mt-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-600 leading-relaxed">
          ⚠️ {{ connect.stalledText }}
        </div>

        <!-- 工具行 -->
        <div class="px-5 py-2.5 border-b border-gray-100 flex items-center justify-between">
          <el-checkbox :model-value="connect.paused" size="small" @change="onTogglePause">
            暂停滚动
            <span v-if="connect.pendingCount" class="text-amber-500">（+{{ connect.pendingCount }}）</span>
          </el-checkbox>
          <div class="flex items-center gap-1">
            <el-button size="small" text type="info" :disabled="!connect.connected" :loading="diagnosing"
              @click="onDiagnose">
              诊断
            </el-button>
            <el-button size="small" text type="danger" :disabled="!connect.messages.length"
              @click="connect.clearMessages">
              清空
            </el-button>
          </div>
        </div>

        <!-- 弹幕列表 -->
        <div ref="listRef" class="flex-1 overflow-y-auto px-5 py-2">
          <div v-if="!connect.messages.length"
            class="h-full flex flex-col items-center justify-center gap-2 text-gray-300">
            <span class="text-4xl">💬</span>
            <p class="text-xs">{{ connect.connected ? "等待弹幕…" : "连接后弹幕会显示在这里" }}</p>
          </div>
          <div v-for="(msg, i) in connect.messages" :key="`${msg.ts}-${i}`"
            class="dm-row py-1.5 text-sm leading-relaxed border-b border-gray-50 last:border-0"
            :class="{ 'is-gift': msg.text.includes('送出') }" :title="msg.uid ? `uid: ${msg.uid}` : '未识别到发送人 id'">
            <span v-if="msg.html" class="dm-item" v-html="msg.html"></span>
            <span v-else-if="msg.user" class="text-blue-500 font-medium mr-1.5">{{ msg.user }}：</span>
            <span v-if="!msg.html" :class="textClass(msg.text)" v-html="renderText(msg.text)"></span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Link, VideoPlay, SwitchButton } from "@element-plus/icons-vue";
import { useConnectStore } from "@renderer/store/modules/connect";
import {
  DANMAKU_DIAGNOSE_SCRIPT,
  DANMAKU_INSTALL_SCRIPT,
  normalizeRoomUrl,
} from "@renderer/utils/danmaku";
import { ipc } from "@renderer/utils/ipcRenderer";

const connect = useConnectStore();
const connecting = ref(false);
const diagnosing = ref(false);
/** 弹幕列表容器（用于自动滚动到底部） */
const listRef = ref<HTMLDivElement | null>(null);

/** 轮询定时器 */
let pullTimer: number | null = null;

// 新消息到达时自动滚动到底部（暂停滚动时不滚）
watch(
  () => connect.messages.length,
  () => {
    if (connect.paused) return;
    nextTick(() => {
      const el = listRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
  { flush: "post" },
);

const connectStatusType = computed(() => {
  if (!connect.connected) return "info";
  return connect.stalled ? "warning" : "success";
});
const connectStatusText = computed(() => {
  if (!connect.connected) return "未连接";
  if (connect.stalled && !connect.collectorReady) return "识别中";
  if (connect.stalled) return "已断流";
  return connect.collectorReady ? "采集中" : "识别中";
});

/** 礼物/进场消息着色 */
function textClass(text: string): string {
  if (/送出/.test(text)) return "text-amber-500";
  if (/来了|进入直播间/.test(text)) return "text-gray-400";
  return "text-gray-700";
}

/** 等级灯牌分段配色（贴近抖音：低级灰蓝 / 中级蓝紫 / 高级金橙红） */
function levelClass(level: string): string {
  const n = Number(level);
  if (!n) return "lv-low";
  if (n >= 45) return "lv-high";
  if (n >= 21) return "lv-mid";
  return "lv-low";
}

/** HTML 转义（v-html 前必做） */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 把弹幕里的 [表情标记] 还原成表情图（标记来自抖音弹幕 img 的 alt，映射在采集时收集） */
function renderText(text: string): string {
  const escaped = esc(text);
  // 注意：v-html 注入的内容不受 scoped 样式影响，所以尺寸必须写内联 style
  return escaped.replace(/\[([^\[\]]{1,12})\]/g, (raw: string, key: string) => {
    const src = connect.emojiMap[key];
    if (!src) return raw;
    return `<img class="dm-emoji" src="${esc(src)}" alt="${esc(key)}" style="display:inline;width:1em;height:1em;vertical-align:-0.15em;object-fit:contain;margin:0 1px;" />`;
  });
}

// ---------- 连接 / 断开 ----------
async function onConnect(): Promise<void> {
  const room = normalizeRoomUrl(connect.roomUrlInput);
  if (!room.ok || !room.url) {
    ElMessage.warning({ message: room.error, offset: 40 });
    return;
  }
  connecting.value = true;
  try {
    connect.reset();
    const { windowId } = await ipc.app.connectOpenRoom({ url: room.url });
    connect.windowId = windowId;
    connect.setConnected(true);
    await ipc.app.connectStart({ windowId, installScript: DANMAKU_INSTALL_SCRIPT });
    startPull(windowId);
  } catch {
    connect.setConnected(false);
    ElMessage.error({ message: "打开直播间窗口失败，请重试", offset: 40 });
  } finally {
    connecting.value = false;
  }
}

async function onDisconnect(): Promise<void> {
  const windowId = connect.windowId;
  stopPull();
  if (windowId) {
    void ipc.app.connectStop({ windowId }).catch(() => { });
    void ipc.app.connectCloseRoom({ windowId }).catch(() => { });
  }
  connect.setConnected(false);
  ElMessage.success({ message: "已断开连接，直播间窗口已关闭", offset: 40 });
}

// ---------- 轮询拉取 ----------
function startPull(windowId: number): void {
  stopPull();
  pullTimer = window.setInterval(async () => {
    if (!connect.connected) return;
    try {
      const res = await ipc.app.connectPull({ windowId });
      if (res) {
        connect.applyPull(res);
      } else {
        // 会话不存在：直播间窗口被用户手动关闭
        stopPull();
        connect.setConnected(false);
        ElMessage.info({ message: "直播间窗口已关闭，采集停止", offset: 40 });
      }
    } catch {
      /* 单轮失败忽略 */
    }
  }, 1500);
}

function stopPull(): void {
  if (pullTimer !== null) {
    window.clearInterval(pullTimer);
    pullTimer = null;
  }
}

// ---------- 工具 ----------
/** 收集直播间页面结构诊断信息（校准弹幕选择器用） */
async function onDiagnose(): Promise<void> {
  if (!connect.windowId) return;
  diagnosing.value = true;
  try {
    const { reports } = await ipc.app.connectDiagnose({
      windowId: connect.windowId,
      diagnoseScript: DANMAKU_DIAGNOSE_SCRIPT,
    });
    const text = reports.join("\n\n").slice(0, 60000);
    try {
      await navigator.clipboard.writeText(text);
      ElMessage.success({
        message: "诊断信息已复制到剪贴板，请粘贴发给开发者",
        offset: 40,
        duration: 5000,
      });
    } catch {
      await ElMessageBox.alert(
        `<pre style="max-height:400px;overflow:auto;font-size:12px;white-space:pre-wrap">${text.replace(/</g, "&lt;")}</pre>`,
        "诊断信息（请全选复制）",
        { dangerouslyUseHTMLString: true, confirmButtonText: "知道了" },
      );
    }
  } catch {
    ElMessage.error({ message: "诊断失败", offset: 40 });
  } finally {
    diagnosing.value = false;
  }
}

function onTogglePause(v: boolean | string | number): void {
  if (v) {
    connect.paused = true;
  } else {
    connect.resume();
  }
}

onUnmounted(() => {
  stopPull();
  const windowId = connect.windowId;
  if (windowId) {
    void ipc.app.connectStop({ windowId }).catch(() => { });
    void ipc.app.connectCloseRoom({ windowId }).catch(() => { });
    connect.setConnected(false);
  }
});
</script>

<style lang="scss" scoped>
/* 抖音风格等级灯牌：按等级段配色 */
.level-badge {
  min-width: 20px;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.25);
}

.lv-low {
  background: linear-gradient(135deg, #7f9bff, #5a7bd8);
}

.lv-mid {
  background: linear-gradient(135deg, #7c6bff, #b05cff);
}

.lv-high {
  background: linear-gradient(135deg, #f9a03c, #f5484d);
}

/* 整条弹幕 DOM 渲染：徽章/昵称/内容/emoji 全在 html 里，只补样式 */
:deep(.dm-item) {
  display: inline;
  color: #2563eb;
  /* 整体蓝色：用户名显示蓝色 */
}

:deep(.dm-item img) {
  display: inline-block;
  vertical-align: -0.15em;
  object-fit: contain;
  max-height: 1.2em;
  width: auto;
}

/* 等级/粉丝团徽章图（height="18"）：高度跟随行高 */
:deep(.dm-item img[height="18"]) {
  height: 1.15em !important;
  width: auto !important;
  margin-right: 3px;
}

/* 弹幕表情图：1em 大小，行内不换行 */
:deep(.dm-item .webcast-chatroom___content-with-emoji-emoji),
:deep(.dm-item .webcast-chatroom___content-with-emoji-emoji img) {
  display: inline !important;
  width: 1em !important;
  height: 1em !important;
  vertical-align: -0.15em !important;
  margin: 0 1px !important;
}

/* 弹幕内容文字：黑色，与蓝色用户名区分 */
:deep(.dm-item .webcast-chatroom___content-with-emoji-text) {
  color: #111827 !important;
}

/* 礼物消息：淡橙色背景高亮 */
.dm-row.is-gift {
  background: #fff7ed;
  border-radius: 4px;
}

.dm-row.is-gift :deep(.dm-item) {
  color: #ea580c;
}
</style>
