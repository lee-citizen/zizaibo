<template>
  <div class="settings-page h-full overflow-y-auto bg-gray-50 px-8 py-6 space-y-5">
    <!-- ========== 关于本程序 ========== -->
    <section class="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 class="text-base font-semibold text-gray-800 mb-3">关于本程序</h2>
      <p class="text-sm text-gray-500">
        当前版本：<span class="text-gray-800 font-medium">v{{ appVersion }}</span>
        <span class="text-xs text-gray-400 ml-2">（设置页显示的版本 = 程序真实版本，重装新版后打开这里一眼确认）</span>
      </p>
    </section>

    <!-- ========== 检查更新 ========== -->
    <section class="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 class="text-base font-semibold text-gray-800 mb-3">检查更新</h2>
      <div class="flex items-center gap-4 flex-wrap">
        <el-button type="primary" :loading="updateChecking" @click="onCheckUpdate">
          <el-icon class="mr-1"><Download /></el-icon>
          检查更新
        </el-button>
        <span class="text-sm" :class="updateError ? 'text-red-400' : 'text-gray-500'">
          {{ updateStatusText }}
        </span>
      </div>
      <p class="text-xs text-gray-400 mt-2">
        当前版本 v{{ appVersion }}，有新版本时会自动下载并提示重启。
      </p>
    </section>

    <!-- ========== 语音输出 ========== -->
    <section class="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 class="text-base font-semibold text-gray-800 mb-4">语音输出（对齐 AI 游戏自动声卡模式）</h2>

      <div class="flex items-center gap-4 mb-3">
        <div class="flex items-center gap-2 text-sm text-gray-600">
          <span>输出设备：</span>
          <el-select v-model="outputDevice" style="width: 240px" @change="onOutputDeviceChange">
            <el-option v-for="d in audioDevices" :key="d.deviceId" :label="d.label" :value="d.deviceId" />
          </el-select>
        </div>
        <el-button size="small" @click="refreshDevices">
          <el-icon>
            <Refresh />
          </el-icon>
          刷新设备
        </el-button>
        <el-button size="small" :loading="diagnosing" @click="runDiagnostics">音频诊断</el-button>
      </div>
      <p class="text-xs text-gray-400 leading-relaxed mb-4">
        选择声音输出到哪个设备：选扬声器/耳机 → 你自己能听到；选 BlackHole / CABLE 等虚拟声卡 → 直播软件把麦克风设为该虚拟声卡，观众就能听到 TTS 和背景音乐。
      </p>

      <!-- 诊断信息 -->
      <div v-if="diagText" class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-gray-700">诊断信息</span>
          <el-button size="small" @click="copyDiagnostics">一键复制</el-button>
        </div>
        <pre class="bg-gray-900 text-green-300 text-xs p-3 rounded-lg overflow-auto max-h-72 whitespace-pre-wrap">{{ diagText }}</pre>
      </div>

      <div class="flex items-center gap-4 mb-4">
        <span class="text-sm text-gray-600" style="width: 80px">TTS 音量：</span>
        <el-slider v-model="ttsVolume" style="width: 240px" />
        <el-button size="small" @click="onTestTts">试听一下</el-button>
      </div>

      <!-- 声卡检测状态 -->
      <div class="flex items-center gap-3 mb-2">
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
          :class="virtualDevice ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'">
          <span class="w-2 h-2 rounded-full" :class="virtualDevice ? 'bg-green-500' : 'bg-red-500'" />
          {{ virtualDevice ? `已检测到：${virtualDevice}` : '声卡锁定失败：找不到虚拟声卡' }}
        </span>
        <span class="text-xs text-gray-400">（可能没装或没重启电脑）</span>
        <el-button size="small" @click="detectDevice">重新检测</el-button>
      </div>

      <div v-if="!virtualDevice" class="flex items-center gap-3">
        <el-button type="primary" @click="downloadVirtualCard">
          <el-icon>
            <Download />
          </el-icon>
          一键下载虚拟声卡
        </el-button>
        <p class="text-xs text-gray-400 leading-relaxed">
          没装进声卡「卡自己」：要用直播声卡，点下载 → 弹出的官方安装器点 Install Driver → 装完重启电脑 → 回这里点刷新设备就能看到 {{ driverName }}
        </p>
      </div>
    </section>

    <!-- ========== 互动音效（暂隐藏） ========== -->
    <section v-if="false" class="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 class="text-base font-semibold text-gray-800 mb-4">互动音效</h2>
      <div class="flex items-center gap-6 flex-wrap">
        <el-checkbox v-model="soundGift">收到礼物时播放音效</el-checkbox>
        <el-checkbox v-model="soundFollow">关注时也满</el-checkbox>
        <el-checkbox v-model="soundEnter">进场欢迎时播放音效</el-checkbox>
        <el-button size="small" @click="onTestSound">测试音效</el-button>
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-600">音量：</span>
          <el-slider v-model="soundVolume" style="width: 128px" />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh, Download } from "@element-plus/icons-vue";
import { ipc, ipcEvents, onIpcEvent } from "@renderer/utils/ipcRenderer";
import { useSpeechStore } from "@renderer/store/modules/speech";
import {
  filterOutputDevices,
  resolveValidDeviceId,
  setOutputDevice,
  getCtxSinkId,
  supportsSetSinkId,
  getCurrentDeviceId,
  type OutputDevice,
} from "@renderer/utils/audio-output";
import pkg from "../../../../package.json";

const speech = useSpeechStore();

const appVersion = pkg.version;

// ---- 语音输出 ----
const OUTPUT_DEVICE_KEY = "audio-output-device-id";
const TTS_VOLUME_KEY = "tts-volume";
const outputDevice = ref(localStorage.getItem(OUTPUT_DEVICE_KEY) || "default");
const ttsVolume = ref(localStorage.getItem(TTS_VOLUME_KEY) !== null ? Number(localStorage.getItem(TTS_VOLUME_KEY)) : 80);
const audioDevices = ref<OutputDevice[]>([]);

// 持久化 + 实时应用：输出设备切换
function onOutputDeviceChange(val: string) {
  const id = val || "default";
  localStorage.setItem(OUTPUT_DEVICE_KEY, id);
  // 通过统一路由立即切换（AudioContext.setSinkId），不重开窗口
  setOutputDevice(id);
  ElMessage.success("输出设备已切换");
}

// 持久化：TTS 音量变化时存 localStorage
watch(ttsVolume, (val) => {
  localStorage.setItem(TTS_VOLUME_KEY, String(val));
});

// ---- 虚拟声卡检测 ----
const virtualDevice = ref<string | null>(null);
/** 当前平台推荐的虚拟声卡名称 */
const driverName = navigator.userAgent.includes("Mac") ? "BlackHole" : "CABLE";
/** 当前平台的虚拟声卡下载链接 */
const driverUrl = navigator.userAgent.includes("Mac")
  ? "https://existential.audio/downloads/BlackHole2ch-0.7.1.pkg"
  : "https://vb-audio.com/Cable/";

async function detectDevice() {
  try {
    virtualDevice.value = await ipc.app.detectVirtualAudioDevice();
  } catch (e) {
    virtualDevice.value = null;
  }
}

function downloadVirtualCard() {
  void ipc.app.openExternalUrl(driverUrl);
}

async function refreshDevices() {
  try {
    // 先触发一次 getUserMedia，让 enumerateDevices 能拿到 label
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch { /* 忽略 */ }

    const list = await navigator.mediaDevices.enumerateDevices();
    const devices = filterOutputDevices(list);
    audioDevices.value = devices;

    // 校验已保存的 deviceId 是否仍存在，否则重置为 default 并提示
    const saved = localStorage.getItem(OUTPUT_DEVICE_KEY);
    const validId = resolveValidDeviceId(saved, devices);
    if (saved && saved !== validId) {
      ElMessage.warning("之前选择的输出设备已不存在，已重置为系统默认");
      localStorage.setItem(OUTPUT_DEVICE_KEY, validId);
      setOutputDevice(validId);
    }
    outputDevice.value = validId;

    ElMessage.success("设备列表已刷新");
  } catch {
    ElMessage.error("刷新设备失败");
  }
}

// ---- 音频诊断 ----
const diagnosing = ref(false);
const diagText = ref("");

async function runDiagnostics() {
  diagnosing.value = true;
  const lines: string[] = [];
  try {
    lines.push(`平台: ${navigator.platform}`);
    lines.push(`UserAgent: ${navigator.userAgent}`);
    lines.push(`支持 AudioContext.setSinkId: ${supportsSetSinkId()}`);
    lines.push(`localStorage 选中设备: ${localStorage.getItem(OUTPUT_DEVICE_KEY) || "(空)"}`);
    lines.push(`当前路由 deviceId: ${getCurrentDeviceId() || "(default)"}`);
    try {
      lines.push(`AudioContext 实际 sinkId: ${await getCtxSinkId() || "(空/default)"}`);
    } catch (e) {
      lines.push(`AudioContext 实际 sinkId: 读取失败 ${e}`);
    }

    // speaker-selection 权限
    try {
      const perm = await navigator.permissions.query({ name: "speaker-selection" as PermissionName });
      lines.push(`speaker-selection 权限: ${perm.state}`);
    } catch (e) {
      lines.push(`speaker-selection 权限: 查询失败 ${e}`);
    }

    // 原始设备枚举
    const raw = await navigator.mediaDevices.enumerateDevices();
    const outputs = raw.filter((d) => d.kind === "audiooutput");
    lines.push(`\n原始 audiooutput 设备 (${outputs.length}):`);
    outputs.forEach((d, i) => {
      lines.push(`  [${i}] deviceId=${d.deviceId || "(空)"} label=${d.label || "(空)"} groupId=${d.groupId || "(空)"}`);
    });

    // 过滤后列表
    lines.push(`\n过滤后设备 (${audioDevices.value.length}):`);
    audioDevices.value.forEach((d) => {
      lines.push(`  - ${d.deviceId} | ${d.label}${d.isDefault ? " [default]" : ""}`);
    });

    // setSinkId 探针
    const id = getCurrentDeviceId() || "default";
    lines.push(`\nsetSinkId 探针 (目标: ${id}):`);
    try {
      const testCtx = new AudioContext();
      await testCtx.setSinkId(id === "default" ? "" : id);
      lines.push(`  结果: resolve, ctx.sinkId=${testCtx.sinkId || "(空/default)"}`);
      await testCtx.close();
    } catch (e) {
      lines.push(`  结果: reject ${e}`);
    }
  } finally {
    diagText.value = lines.join("\n");
    diagnosing.value = false;
  }
}

function copyDiagnostics() {
  if (!diagText.value) return;
  navigator.clipboard.writeText(diagText.value).then(
    () => ElMessage.success("诊断信息已复制到剪贴板"),
    () => ElMessage.error("复制失败，请手动选择文本复制"),
  );
}

function onTestTts() {
  speech.speak("这是一段语音试听，用来测试当前的语音输出设置。");
}

// ---- 互动音效（已隐藏，保留持久化） ----
const SOUND_GIFT_KEY = "sound-gift";
const SOUND_FOLLOW_KEY = "sound-follow";
const SOUND_ENTER_KEY = "sound-enter";
const SOUND_VOLUME_KEY = "sound-volume";
const soundGift = ref(localStorage.getItem(SOUND_GIFT_KEY) !== "false");
const soundFollow = ref(localStorage.getItem(SOUND_FOLLOW_KEY) !== "false");
const soundEnter = ref(localStorage.getItem(SOUND_ENTER_KEY) === "true");
const soundVolume = ref(Number(localStorage.getItem(SOUND_VOLUME_KEY)) || 60);

watch(soundGift, (v) => localStorage.setItem(SOUND_GIFT_KEY, String(v)));
watch(soundFollow, (v) => localStorage.setItem(SOUND_FOLLOW_KEY, String(v)));
watch(soundEnter, (v) => localStorage.setItem(SOUND_ENTER_KEY, String(v)));
watch(soundVolume, (v) => localStorage.setItem(SOUND_VOLUME_KEY, String(v)));

function onTestSound() {
  ElMessage.info("音效测试功能开发中");
}

// ---- 检查更新（增量热更新） ----
const updateChecking = ref(false);
const updateStatusText = ref("");
const updateError = ref("");

/** 热更新状态文案映射 */
const HOT_STATUS_TEXT: Record<string, string> = {
  init: "正在检查更新...",
  downloading: "正在下载更新包...",
  moving: "正在安装更新...",
  finished: "更新完成",
  failed: "更新失败",
  "not-available": "当前已是最新版本",
};

async function onCheckUpdate() {
  if (updateChecking.value) return;
  updateChecking.value = true;
  updateError.value = "";
  updateStatusText.value = "正在检查更新...";
  try {
    await ipc.updater.start();
  } catch (e) {
    updateChecking.value = false;
    updateError.value = "检查更新失败，请稍后重试";
    updateStatusText.value = "";
    ElMessage.error("检查更新失败");
  }
}

// 监听增量热更新状态推送
onIpcEvent(ipcEvents.update.hotStatus, (msg) => {
  updateStatusText.value = HOT_STATUS_TEXT[msg.status] || msg.message || "";
  if (msg.status === "finished") {
    updateChecking.value = false;
    updateError.value = "";
    ElMessageBox.confirm("新版本已下载完成，是否立即重启应用？", "更新完成", {
      confirmButtonText: "立即重启",
      cancelButtonText: "稍后重启",
      type: "success",
    })
      .then(() => {
        void ipc.app.relaunch();
      })
      .catch(() => {
        /* 用户选择稍后重启，下次启动时自动应用更新 */
      });
  } else if (msg.status === "failed") {
    updateChecking.value = false;
    updateError.value = msg.message || "更新失败";
  } else if (msg.status === "not-available") {
    updateChecking.value = false;
    updateError.value = "";
  }
});

onMounted(() => {
  void detectDevice();
  void refreshDevices();
});
</script>

<style lang="scss" scoped>
.settings-page {
  :deep(.el-slider) {
    margin: 0;
  }
}
</style>
