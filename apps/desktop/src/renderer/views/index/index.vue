<template>
  <div class="home-page h-full overflow-y-auto bg-gray-50">
    <div class="px-8 py-6 space-y-5">
      <!-- ========== 欢迎横幅 ========== -->
      <section
        class="relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-sm"
      >
        <!-- 装饰光斑 -->
        <div
          class="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-white/10 blur-2xl pointer-events-none"
        />
        <div
          class="absolute -bottom-20 left-1/3 w-64 h-64 rounded-full bg-purple-400/20 blur-3xl pointer-events-none"
        />

        <div class="relative z-10 px-8 py-8 flex items-center justify-between gap-6">
          <div class="min-w-0">
            <p class="text-sm text-white/75">{{ dateText }} · {{ timeText }}</p>
            <h1 class="text-2xl font-bold mt-1.5">{{ greeting }}，祝你直播顺利 🎬</h1>
            <p class="text-sm text-white/80 mt-2 truncate">
              连接直播间，开启背景音乐、自动报时与智能朗读，一站式搞定直播互动
            </p>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 text-xs text-white/90"
            >
              <span
                class="w-2 h-2 rounded-full"
                :class="connect.connected ? 'bg-green-400' : 'bg-gray-300'"
              />
              {{ connect.connected ? '已连接直播' : '未连接直播' }}
            </span>
            <button
              class="px-4 py-2 rounded-lg bg-white text-blue-600 text-sm font-medium shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
              @click="router.push('/connect')"
            >
              {{ connect.connected ? '直播间' : '连接直播' }}
            </button>
          </div>
        </div>
      </section>

      <!-- ========== 功能入口 ========== -->
      <section>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-semibold text-gray-800">功能入口</h2>
          <span class="text-xs text-gray-400">点击卡片直达对应功能</span>
        </div>
        <div class="grid grid-cols-3 gap-4">
          <div
            v-for="item in features"
            :key="item.path"
            class="group bg-white rounded-lg border border-gray-200 p-5 shadow-sm cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            :class="item.hoverBorder"
            @click="router.push(item.path)"
          >
            <div class="flex items-start gap-3">
              <div
                class="w-11 h-11 rounded-lg flex items-center justify-center text-xl shrink-0 transition-transform duration-200 group-hover:scale-110"
                :class="item.tint"
              >
                {{ item.icon }}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-[15px] font-semibold text-gray-800">{{ item.title }}</span>
                  <span
                    v-if="item.hot"
                    class="px-1.5 py-0.5 rounded text-[10px] leading-none bg-rose-50 text-rose-500 border border-rose-100"
                  >
                    HOT
                  </span>
                </div>
                <p class="text-xs text-gray-400 mt-1.5 leading-relaxed">{{ item.desc }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ========== 上手指引 ========== -->
      <section class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <h2 class="text-lg font-semibold text-gray-800 mb-4">三步上手</h2>
        <div class="grid grid-cols-3 gap-4">
          <div
            v-for="(step, i) in steps"
            :key="i"
            class="flex items-start gap-3 p-4 rounded-lg bg-gray-50 border border-gray-100"
          >
            <div
              class="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-white text-xs font-bold flex items-center justify-center shrink-0"
            >
              {{ i + 1 }}
            </div>
            <div>
              <p class="text-sm font-medium text-gray-700">{{ step.title }}</p>
              <p class="text-xs text-gray-400 mt-1 leading-relaxed">{{ step.desc }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 页脚 -->
      <p class="text-center text-xs text-gray-300 pb-2">LiveTools · 让直播更轻松</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useConnectStore } from "@renderer/store/modules/connect";

const router = useRouter();
const connect = useConnectStore();

// ---------- 时间问候 ----------
const now = ref(new Date());
const timeTimer = window.setInterval(() => (now.value = new Date()), 1000);
onUnmounted(() => window.clearInterval(timeTimer));

const greeting = computed(() => {
  const h = now.value.getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
});

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const dateText = computed(() => {
  const d = now.value;
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`;
});
const timeText = computed(() => {
  const d = now.value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

// ---------- 功能入口（Tailwind 类需完整写出，便于 JIT 生成） ----------
const features = [
  {
    path: "/connect",
    icon: "🔗",
    title: "连接直播",
    desc: "接入直播间，打通弹幕互动与场景联动能力",
    tint: "bg-blue-50 text-blue-500",
    hoverBorder: "hover:border-blue-300",
    hot: true,
  },
  {
    path: "/games",
    icon: "🎮",
    title: "游戏大厅",
    desc: "弹幕互动小游戏，活跃直播间气氛神器",
    tint: "bg-emerald-50 text-emerald-500",
    hoverBorder: "hover:border-emerald-300",
    hot: false,
  },
  {
    path: "/music",
    icon: "🎵",
    title: "背景音乐",
    desc: "全局背景音乐，内置歌单，支持自由上传",
    tint: "bg-violet-50 text-violet-500",
    hoverBorder: "hover:border-violet-300",
    hot: true,
  },
  {
    path: "/clock",
    icon: "🕰️",
    title: "自动报时",
    desc: "整点/随机报时，文案自定义，自然不打扰",
    tint: "bg-amber-50 text-amber-500",
    hoverBorder: "hover:border-amber-300",
    hot: false,
  },
  {
    path: "/speech",
    icon: "🗣️",
    title: "智能朗读",
    desc: "TTS 音色调节、互动引导话术、我的语音库",
    tint: "bg-rose-50 text-rose-500",
    hoverBorder: "hover:border-rose-300",
    hot: true,
  },
  {
    path: "/settings",
    icon: "⚙️",
    title: "系统设置",
    desc: "应用偏好与通用选项配置",
    tint: "bg-slate-100 text-slate-500",
    hoverBorder: "hover:border-slate-300",
    hot: false,
  },
];

// ---------- 上手指引 ----------
const steps = [
  { title: "连接直播间", desc: "进入「连接直播」，完成直播间授权与连接" },
  { title: "挑选功能", desc: "按需开启背景音乐、自动报时、智能朗读等能力" },
  { title: "开播嗨皮", desc: "剩下的交给 LiveTools，专心表演就好" },
];
</script>

<style lang="scss" scoped></style>
