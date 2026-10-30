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

    <!-- ========== 游戏库更新 ========== -->
    <section class="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 class="text-base font-semibold text-gray-800 mb-3">游戏库更新</h2>
      <div class="flex items-center gap-4">
        <el-button type="success" @click="onSyncGames">同步游戏库</el-button>
        <p class="text-sm text-gray-400">已对接官方游戏库，启动自动同步，有新游戏必这里手动拉一次</p>
      </div>
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
      </div>
      <p class="text-xs text-gray-400 leading-relaxed mb-4">
        选择声音输出到哪个设备：选扬声器/耳机 → 你自己能听到；选 BlackHole / CABLE 等虚拟声卡 → 直播软件把麦克风设为该虚拟声卡，观众就能听到 TTS 和背景音乐。
      </p>

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
import { ElMessage } from "element-plus";
import { Refresh, Download } from "@element-plus/icons-vue";
import { ipc } from "@renderer/utils/ipcRenderer";
import { useSpeechStore } from "@renderer/store/modules/speech";
import pkg from "../../../../package.json";

const speech = useSpeechStore();

const appVersion = pkg.version;

// ---- 语音输出 ----
const OUTPUT_DEVICE_KEY = "audio-output-device-id";
const TTS_VOLUME_KEY = "tts-volume";
const outputDevice = ref(localStorage.getItem(OUTPUT_DEVICE_KEY) || "");
const ttsVolume = ref(Number(localStorage.getItem(TTS_VOLUME_KEY)) || 80);
const audioDevices = ref<MediaDeviceInfo[]>([]);

// 持久化：输出设备切换
function onOutputDeviceChange(val: string) {
  localStorage.setItem(OUTPUT_DEVICE_KEY, val);
  window.dispatchEvent(new CustomEvent("audio-output-device-change", { detail: val }));
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
    const seen = new Set<string>();
    audioDevices.value = list
      .filter((d) => d.kind === "audiooutput")
      .filter((d) => {
        if (!d.label || !d.deviceId) return false;
        if (/^(default|system)\b/i.test(d.label)) return false;
        const key = d.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));

    // 如果 localStorage 已有选择且仍在列表里，保持；否则默认选系统默认设备
    const saved = localStorage.getItem(OUTPUT_DEVICE_KEY);
    const stillValid = saved && audioDevices.value.some((d) => d.deviceId === saved);
    if (stillValid) {
      outputDevice.value = saved!;
    } else {
      // 拿系统默认设备名，匹配列表选中
      try {
        const defaultName: string | null = await ipc.app.getDefaultAudioDevice();
        const matched = defaultName
          ? audioDevices.value.find((d) => d.label.toLowerCase().includes(defaultName.toLowerCase()))
          : null;
        outputDevice.value = matched ? matched.deviceId : (audioDevices.value[0]?.deviceId || "");
      } catch {
        outputDevice.value = audioDevices.value[0]?.deviceId || "";
      }
      // 自动应用默认选择
      if (outputDevice.value) onOutputDeviceChange(outputDevice.value);
    }

    ElMessage.success("设备列表已刷新");
  } catch {
    ElMessage.error("刷新设备失败");
  }
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

// ---- 游戏库更新 ----
function onSyncGames() {
  ElMessage.info("游戏库同步功能开发中");
}

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
