<template>
    <div class="h-full  w-52 relative">
        <aside class="h-[calc(100%-30px)] w-52 bg-slate-900  text-slate-300 flex flex-col fixed ">
            <!-- Logo 区域 -->
            <div class="px-5 py-5 border-b border-slate-700/60">
                <div class="flex items-center gap-2">
                    <div
                        class="w-8 h-8 ml-4  rounded-lg overflow-hidden bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                        <img src="@renderer/assets/logo.png" alt="" srcset="">
                    </div>
                    <span class="text-white font-semibold text-base ml-2">自在播</span>
                </div>
            </div>

            <!-- 导航列表 -->
            <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                <div v-for="item in mainList" :key="item.path"
                    class="nav-item group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200"
                    :class="route.path === item.path
                        ? 'bg-blue-500/15 text-white'
                        : 'hover:bg-slate-800 hover:text-white'" @click="router.push(item.path)">
                    <span class="w-1.5 h-5 rounded-full transition-colors"
                        :class="route.path === item.path ? 'bg-blue-400' : 'bg-transparent'" />
                    <span class="text-sm flex-1">{{ item.name }}</span>
                </div>
            </nav>

            <!-- 底部导航 -->
            <nav class="px-3 py-3 border-t border-slate-700/60 space-y-1">
                <div v-for="item in bottomList" :key="item.path"
                    class="nav-item group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200"
                    :class="route.path === item.path
                        ? 'bg-blue-500/15 text-white'
                        : 'hover:bg-slate-800 hover:text-white'" @click="router.push(item.path)">
                    <span class="w-1.5 h-5 rounded-full transition-colors"
                        :class="route.path === item.path ? 'bg-blue-400' : 'bg-transparent'" />
                    <span class="text-sm flex-1">{{ item.name }}</span>
                </div>
            </nav>
        </aside>
    </div>

</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const navList = ref([
    { name: '直播主页', path: '/' },
    { name: '连接直播', path: '/connect' },
    { name: '游戏大厅', path: '/games' },
    { name: '背景音乐', path: '/music' },
    { name: '自动报时', path: '/clock' },
    { name: '智能朗读', path: '/speech' },
    { name: '卡密激活', path: '/key' },
    { name: '系统设置', path: '/settings' },
])

const mainList = computed(() => navList.value.slice(0, navList.value.length - 1))
const bottomList = computed(() => navList.value.slice(-1))
</script>