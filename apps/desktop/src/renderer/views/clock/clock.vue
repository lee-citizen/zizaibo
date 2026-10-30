<template>
  <div class="clock-page h-full overflow-y-auto bg-gray-50">
    <div class="px-8 py-6 space-y-5">
      <!-- 标题 -->
      <div class="flex items-center gap-2">
        <span class="text-2xl">🕰️</span>
        <h1 class="text-2xl font-bold text-gray-800">自动报时</h1>
      </div>

      <!-- ========== 整点报时 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">整点报时</h2>
            <p class="text-xs text-gray-400 mt-0.5">整点准点或随机时间播报，不做时间表</p>
          </div>
          <el-switch v-model="clockOn" active-text="开启" inline-prompt />
        </div>

        <!-- 状态 + 时段 -->
        <div class="flex flex-wrap items-center gap-5 mb-4">
          <div class="flex items-center gap-2 text-sm text-gray-600">
            <span>下次报时</span>
            <el-tag :type="clock.enabled ? 'success' : 'info'" effect="plain">
              {{ clock.nextChimeText }}
            </el-tag>
          </div>
          <div class="flex items-center gap-2 text-sm text-gray-600">
            <span>报时模式</span>
            <el-radio-group :model-value="clock.mode" size="small" @change="onModeChange">
              <el-radio-button value="all">全天整点</el-radio-button>
              <el-radio-button value="daytime">白天整点</el-radio-button>
              <el-radio-button value="random">随机报时</el-radio-button>
            </el-radio-group>
          </div>
        </div>

        <!-- 报时文案 -->
        <div class="mb-4">
          <label class="block text-sm text-gray-600 mb-1.5">报时文案</label>
          <el-input
            v-model="clock.template"
            placeholder="现在是北京时间{hour}点{minute}"
            clearable
          />
          <p class="text-xs text-gray-400 mt-1">
            {hour} 按时段自动替换为：凌晨X / 早上X / 中午12 / 下午X / 晚上X / 0；{minute}
            准点自动说「整」，非整点自动说「N分」（随机模式生效）
          </p>
        </div>

        <!-- 欢迎语 -->
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <el-checkbox v-model="clock.appendWelcome">报完时补一句欢迎语</el-checkbox>
          <el-input
            v-model="clock.welcomeText"
            :disabled="!clock.appendWelcome"
            class="flex-1 min-w-[260px]"
            placeholder="欢迎来到直播间，喜欢主播的点个关注哦"
          />
        </div>

        <!-- 操作 -->
        <div class="flex flex-wrap items-center gap-2">
          <el-button :icon="VideoPlay" @click="clock.preview"> 试听报时 </el-button>
          <el-button type="primary" :icon="Check" @click="onSave"> 保存报时设置 </el-button>
        </div>

        <p class="text-xs text-gray-400 mt-4">
          全天整点：0~23 每个整点准点播报；白天整点：8~23 每个整点准点播报；随机报时：整点后 2~25
          分钟随机播报，相邻两次至少间隔约半小时，自然不机械。报时使用「智能朗读」里配置的音色、语速与音调，需先试听确认声音正常
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import { VideoPlay, Check } from "@element-plus/icons-vue";
import { useClockStore, type ClockMode } from "@renderer/store/modules/clock";

const clock = useClockStore();

// 总开关（开启/关闭会立即持久化并重新排程）
const clockOn = computed({
  get: () => clock.enabled,
  set: (v: boolean) => clock.setEnabled(v),
});

function onModeChange(m: ClockMode): void {
  clock.setMode(m);
}

function onSave(): void {
  clock.save();
  ElMessage.success({ message: "报时设置已保存", offset: 40 });
}
</script>

<style lang="scss" scoped></style>
