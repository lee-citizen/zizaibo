<template>
  <div class="speech-page h-full overflow-y-auto bg-gray-50">
    <div class="px-8 py-6 space-y-5">
      <!-- 标题 -->
      <div class="flex items-center gap-2">
        <span class="text-2xl">🎙️</span>
        <h1 class="text-2xl font-bold text-gray-800">智能朗读</h1>
      </div>

      <!-- ========== 模块一：朗读音色 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">朗读音色</h2>
            <p class="text-xs text-gray-400 mt-0.5">设音色、调语速音调</p>
          </div>
          <div class="flex items-center gap-2">
            <el-button :icon="VideoPlay" @click="onTrialTts" :disabled="ttsText.trim().length === 0">
              试听朗读
            </el-button>
            <el-button type="primary" :icon="Check" @click="speech.saveTts"> 保存音色 </el-button>
          </div>
        </div>

        <!-- 音色选择 + 预设 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-600 mb-1.5">TTS 声音</label>
            <el-select v-model="speech.selectedVoiceURI" class="w-full" placeholder="选择系统声音" filterable>
              <el-option v-for="v in speech.voices" :key="v.voiceURI" :label="`${v.name}（${v.lang}）`"
                :value="v.voiceURI" />
            </el-select>
            <p class="text-xs text-gray-400 mt-1">
              微软中文神经声音（edge-tts，免费需联网；离线时自动回退系统声音）
            </p>
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1.5">一键预设</label>
            <el-select v-model="presetKey" class="w-full" placeholder="选择场景预设" @change="onPresetChange">
              <el-option v-for="p in TTS_PRESETS" :key="p.key" :label="p.label" :value="p.key" />
            </el-select>
            <p class="text-xs text-gray-400 mt-1">点击后自动填充最佳音色、语速、音调</p>
          </div>
        </div>

        <!-- 试听文本 -->
        <div class="mb-4">
          <label class="block text-sm text-gray-600 mb-1.5">试听文本</label>
          <el-input v-model="ttsText" type="textarea" :rows="2" placeholder="输入一段文字用于试听..." />
        </div>

        <!-- 语速 + 音调 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-sm text-gray-600">基础语速</label>
              <span class="text-sm font-medium text-blue-600">
                {{ speech.ratePercent > 0 ? `+${speech.ratePercent}` : speech.ratePercent }}%
              </span>
            </div>
            <el-slider v-model="speech.rate" :min="0.3" :max="2.5" :step="0.05" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-sm text-gray-600">音调（调谐=值）</label>
              <span class="text-sm font-medium text-blue-600">
                {{ speech.pitchHz > 0 ? `+${speech.pitchHz}` : speech.pitchHz }}Hz
              </span>
            </div>
            <el-slider v-model="speech.pitchHz" :min="-100" :max="100" :step="1" />
          </div>
        </div>

        <!-- edge-tts 提示 -->
        <div class="mt-6 pt-5 border-t border-gray-100">
          <div class="flex items-center gap-2">
            <el-tag size="small" type="info" effect="plain">在线合成</el-tag>
            <span class="text-sm text-gray-600">
              当前通过
              <span class="text-blue-600 font-medium">edge-tts（微软 Edge 在线 TTS，免费）</span>
              调用微软神经声音，无需配置密钥，需联网使用；离线时自动回退到系统声音朗读。
            </span>
          </div>
        </div>
      </div>

      <!-- ========== 模块二：互动引导 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">互动引导</h2>
            <p class="text-xs text-gray-400 mt-0.5">
              定时轮播（{{ speech.guide.minInterval }}~{{ speech.guide.maxInterval }} 秒随机）
            </p>
          </div>
          <el-switch v-model="guideEnabled" active-text="开启" inline-prompt />
        </div>

        <!-- 选项行 -->
        <div class="flex flex-wrap items-center gap-5 mb-4">
          <el-checkbox v-model="randomMode" @change="onRandomModeChange(true)">随机话术</el-checkbox>
          <el-checkbox v-model="sequentialMode" @change="onRandomModeChange(false)">
            顺序播放
          </el-checkbox>
          <div class="flex items-center gap-2 text-sm text-gray-600">
            <span>间隔</span>
            <el-input-number v-model="speech.guide.minInterval" :min="5" :max="speech.guide.maxInterval" size="small"
              controls-position="right" style="width: 90px" />
            <span>到</span>
            <el-input-number v-model="speech.guide.maxInterval" :min="speech.guide.minInterval" :max="3600" size="small"
              controls-position="right" style="width: 90px" />
            <span>秒随机</span>
          </div>
        </div>

        <!-- 话术编辑 -->
        <div class="mb-4">
          <label class="block text-sm text-gray-600 mb-1.5">引导话术（一行一条）</label>
          <el-input v-model="guideScriptsText" type="textarea" :rows="5" placeholder="喜欢主播的点个关注哦&#10;想玩的家人扣1" />
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center gap-2">
          <el-button :icon="VideoPlay" @click="speech.triggerGuide"> 试听引导 </el-button>
          <el-button type="primary" :icon="Check" @click="onSaveGuide"> 保存引导设置 </el-button>
        </div>
      </div>

      <!-- ========== 模块三：我的语音 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">我的语音</h2>
            <p class="text-xs text-gray-400 mt-0.5">不用 AI，请自己录一段</p>
          </div>
          <el-switch v-model="voiceLoopOn" active-text="开启" inline-prompt />
        </div>

        <!-- 选项行 -->
        <div class="flex flex-wrap items-center gap-5 mb-3">
          <!-- <el-checkbox v-model="useVoiceRead">用我的语音朗读</el-checkbox> -->
          <div class="flex items-center gap-2 text-sm text-gray-600">
            <span>播报方式</span>
            <el-select :model-value="speech.voicePlayMode" size="small" style="width: 120px"
              @change="onVoicePlayModeChange">
              <el-option label="顺序播放" value="sequential" />
              <el-option label="随机播放" value="random" />
              <el-option label="固定播放" value="fixed" />
            </el-select>
          </div>
          <div v-if="speech.voicePlayMode === 'fixed'" class="flex items-center gap-2 text-sm text-gray-600">
            <span>固定条</span>
            <el-select v-model="speech.voiceFixedIndex" size="small" style="width: 160px" placeholder="选择一条语音">
              <el-option v-for="(t, i) in speech.voiceTracks" :key="t.id" :label="`${i + 1}. ${t.name}`" :value="i" />
            </el-select>
          </div>
          <div class="flex items-center gap-2 text-sm text-gray-600">
            <span>间隔</span>
            <el-input-number v-model="speech.voiceIntervalMin" :min="0" :max="600" :disabled="speech.voiceContinuous"
              size="small" controls-position="right" style="width: 100px" @change="onVoiceLoopSettingChange" />
            <span>到</span>
            <el-input-number v-model="speech.voiceIntervalMax" :min="0" :max="600" :disabled="speech.voiceContinuous"
              size="small" controls-position="right" style="width: 100px" @change="onVoiceLoopSettingChange" />
            <span>秒</span>
          </div>
          <el-checkbox v-model="speech.voiceContinuous" @change="onVoiceLoopSettingChange">
            持续播放（无间隔）
          </el-checkbox>
        </div>
        <p class="text-xs text-gray-400 mb-4">
          开启总开关后按播报方式循环播报；「持续播放」适合一直循环某一条话术（配合「固定播放」使用）；「我的语音」与「互动引导」互斥，开启一方会自动关闭另一方；勾选「用我的语音朗读」后，互动引导播报会用这里的语音替代
          TTS
        </p>

        <!-- 操作按钮 -->
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <el-button type="success" :icon="Upload" @click="speech.addUserVoice">
            导入语音
          </el-button>
          <el-button :type="isRecording ? 'danger' : 'warning'" :icon="isRecording ? VideoPause : Mic"
            @click="toggleRecording">
            {{ isRecording ? "停止录音" : "现场录音" }}
          </el-button>
          <el-button :icon="VideoPlay" @click="speech.toggleVoicePlay"> 试听一条 </el-button>
          <el-button type="danger" :icon="Delete" :disabled="speech.voiceTracks.length === 0" @click="onClearAllVoices">
            全部删除
          </el-button>
          <span v-if="isRecording" class="inline-flex items-center gap-1.5 text-xs text-red-500 animate-pulse">
            <span class="w-2 h-2 rounded-full bg-red-500" />
            录音中... {{ recordingSeconds }}s
          </span>
        </div>

        <!-- 文字生成语音 -->
        <div class="mb-4 p-4 bg-gray-50 border border-gray-100 rounded-lg">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-sm font-semibold text-gray-700">文字生成语音</span>
            <el-tag size="small" type="info" effect="plain">使用上方音色</el-tag>
          </div>
          <el-input v-model="genText" type="textarea" :rows="2" placeholder="输入一段文字，用上方选择的音色合成为语音..." />
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <el-button :icon="VideoPlay" :disabled="genText.trim().length === 0" @click="onPreviewGenerated">
              试听
            </el-button>
            <el-button type="primary" :icon="Plus" :disabled="genText.trim().length === 0" @click="onSaveGenerated">
              添加到我的语音
            </el-button>
            <span class="text-xs text-gray-400">在线合成（edge-tts），需联网</span>
          </div>
        </div>

        <!-- 语音列表 -->
        <div v-if="speech.voiceTracks.length" class="border border-gray-100 rounded-lg overflow-hidden">
          <div class="divide-y divide-gray-100">
            <div v-for="(track, index) in speech.voiceTracks" :key="track.id"
              class="flex items-center gap-3 px-4 py-3 transition-colors"
              :class="index === speech.voiceCurrentIndex ? 'bg-blue-50' : 'hover:bg-gray-50'">
              <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0" :class="index === speech.voiceCurrentIndex && speech.voiceIsPlaying
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-500'
                ">
                {{ index === speech.voiceCurrentIndex && speech.voiceIsPlaying ? "♪" : index + 1 }}
              </span>
              <span class="flex-1 truncate text-sm" :class="index === speech.voiceCurrentIndex ? 'text-blue-600 font-medium' : 'text-gray-700'
                ">
                {{ track.name }}
                <el-tag v-if="track.recorded" size="small" type="warning" class="ml-2">录音</el-tag>
              </span>
              <!-- <el-button size="small" text type="primary" @click="speech.playVoice(index)">
                播放
              </el-button> -->
              <el-button size="small" text type="primary" @click="onRenameVoice(index)">
                重命名
              </el-button>
              <el-button size="small" text type="danger" @click="onRemoveVoice(index)">
                删除
              </el-button>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="px-8 py-12 text-center text-gray-400 border border-dashed border-gray-200 rounded-lg">
          <svg class="w-14 h-14 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          <p>还没有语音，点击「导入语音」或「现场录音」</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from "vue";
import { ElMessageBox } from "element-plus";
import { VideoPlay, VideoPause, Check, Upload, Mic, Delete, Plus } from "@element-plus/icons-vue";
import { useSpeechStore, TTS_PRESETS } from "@renderer/store/modules/speech";

const speech = useSpeechStore();

// ---------- TTS ----------
const ttsText = ref("大家好，欢迎来到直播间，喜欢的点个关注哦！");
const presetKey = ref("");

function onPresetChange(key: string): void {
  const preset = TTS_PRESETS.find((p) => p.key === key);
  if (preset) speech.applyPreset(preset);
  // 重置选择，方便再次选择同一预设
  setTimeout(() => {
    presetKey.value = "";
  }, 0);
}

function onTrialTts(): void {
  speech.speak(ttsText.value);
}

// ---------- 互动引导 ----------
const guideEnabled = computed({
  get: () => speech.guide.enabled,
  set: (v: boolean) => speech.toggleGuide(v),
});

// 用换行拼接/拆分话术，绑定到 textarea
const guideScriptsText = computed({
  get: () => speech.guide.scripts.join("\n"),
  set: (val: string) => {
    speech.guide.scripts = val.split("\n").filter((s) => s.trim().length > 0);
  },
});

function onSaveGuide(): void {
  speech.saveGuide();
}

// 随机话术 / 顺序播放 互斥
const randomMode = computed({
  get: () => speech.guide.random,
  set: (v: boolean) => {
    speech.guide.random = v;
  },
});
const sequentialMode = computed({
  get: () => !speech.guide.random,
  set: (v: boolean) => {
    if (v) speech.guide.random = false;
  },
});
function onRandomModeChange(toRandom: boolean): void {
  speech.guide.random = toRandom;
}

// ---------- 我的语音 ----------
// 总开关：控制「我的语音」独立循环播放
const voiceLoopOn = computed({
  get: () => speech.voiceEnabled,
  set: (v: boolean) => speech.setVoiceEnabled(v),
});
// 「用我的语音朗读」：互动引导播报时用语音替代 TTS（独立开关，与循环播放互不影响）
const useVoiceRead = computed({
  get: () => speech.voiceForGuide,
  set: (v: boolean) => speech.setVoiceForGuide(v),
});

// ---------- 现场录音 ----------
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordTimer: number | null = null;
const isRecording = ref(false);
const recordingSeconds = ref(0);

async function toggleRecording(): Promise<void> {
  if (isRecording.value) {
    stopRecording();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/ogg")
        ? "audio/ogg"
        : "";
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      const blobType = mimeType || "audio/webm";
      const blob = new Blob(recordedChunks, { type: blobType });
      const name = `录音 ${new Date().toLocaleString()}`;
      await speech.saveRecording(blob, name);
      stream.getTracks().forEach((t) => t.stop());
      mediaRecorder = null;
    };
    mediaRecorder.start();
    isRecording.value = true;
    recordingSeconds.value = 0;
    recordTimer = window.setInterval(() => {
      recordingSeconds.value += 1;
    }, 1000);
  } catch (err) {
    console.error("[speech] 录音启动失败:", err);
    ElMessageBox.alert("无法访问麦克风，请检查系统麦克风权限设置。", "录音失败", {
      type: "error",
      offset: 40,
    });
  }
}

function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (recordTimer !== null) {
    window.clearInterval(recordTimer);
    recordTimer = null;
  }
  isRecording.value = false;
}

// ---------- 播报方式 ----------
function onVoicePlayModeChange(mode: "sequential" | "random" | "fixed"): void {
  speech.setVoicePlayMode(mode);
}

// 持续播放/间隔设置变化后，若正在等待下一条则按新设置立即重新调度
function onVoiceLoopSettingChange(): void {
  speech.refreshVoiceSchedule();
}

// ---------- 文字生成语音 ----------
const genText = ref("喜欢主播的点个关注哦！");

async function onPreviewGenerated(): Promise<void> {
  await speech.previewGeneratedVoice(genText.value);
}

async function onSaveGenerated(): Promise<void> {
  await speech.saveGeneratedVoice(genText.value);
}

// ---------- 重命名单条语音 ----------
async function onRenameVoice(index: number): Promise<void> {
  const track = speech.voiceTracks[index];
  if (!track) return;
  try {
    const { value } = await ElMessageBox.prompt("请输入新的名称", "重命名", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputValue: track.name,
      inputValidator: (val: string) => (val && val.trim().length > 0 ? true : "名称不能为空"),
      offset: 40,
    });
    await speech.renameVoice(index, value);
  } catch {
    /* 用户取消 */
  }
}

// ---------- 删除单条语音 ----------
async function onRemoveVoice(index: number): Promise<void> {
  const track = speech.voiceTracks[index];
  if (!track) return;
  try {
    await ElMessageBox.confirm(`确定要删除「${track.name}」吗？此操作不可恢复。`, "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
      offset: 40,
    });
    await speech.removeVoice(index);
  } catch {
    /* 用户取消 */
  }
}

// ---------- 清空语音 ----------
async function onClearAllVoices(): Promise<void> {
  try {
    await ElMessageBox.confirm("确定要删除全部语音吗？此操作不可恢复。", "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
      offset: 40,
    });
    await speech.clearAllVoices();
  } catch {
    /* 用户取消 */
  }
}

// ---------- 清理 ----------
onBeforeUnmount(() => {
  if (recordTimer !== null) window.clearInterval(recordTimer);
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
});
</script>

<style lang="scss" scoped>
.speech-page {
  min-height: 100%;
}
</style>
