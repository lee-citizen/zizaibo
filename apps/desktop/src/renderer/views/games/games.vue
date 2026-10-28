<template>
    <div class="h-full overflow-y-auto bg-gray-50">
        <!-- 顶部标题 + 搜索 + 设置 -->
        <div class="px-8 pt-8 pb-4 space-y-4">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">游戏大厅</h1>
                <p class="text-sm text-gray-500 mt-1">共 {{ filteredGames.length }} / {{ games.length }} 款小游戏</p>
            </div>

            <div class="flex items-center gap-4 flex-wrap">
                <!-- 搜索框 -->
                <el-input v-model="keyword" placeholder="搜索游戏名称..." clearable class="w-72" prefix-icon="Search"
                    size="default" />
            </div>

            <!-- 🔊 播放设备（直接展示） -->
            <div class="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <p class="text-xs text-gray-400 mb-3">🔊 播放设备 · 系统默认已高亮</p>
                <div v-if="audioDevices.length" class="flex flex-wrap gap-2">
                    <el-tag v-for="device in audioDevices" :key="device.deviceId"
                        :type="device.isDefault ? 'warning' : 'info'" :effect="device.isDefault ? 'dark' : 'plain'"
                        size="large" round :closable="false">
                        <span class="flex items-center gap-1">
                            <span v-if="device.isDefault">🔊</span>
                            <span v-else>🔈</span>
                            {{ device.label || '未知设备' }}
                            <span v-if="device.isDefault" class="ml-1 opacity-80">· 默认</span>
                        </span>
                    </el-tag>
                </div>
                <div v-else class="text-center py-4 text-gray-400 text-sm">
                    <div v-if="audioLoading">🔄 加载播放设备...</div>
                    <div v-else>未检测到音频输出设备</div>
                </div>
            </div>

            <div class="flex items-center gap-4 flex-wrap">
                <!-- 静音开关 -->
                <el-checkbox v-model="settings.mute">
                    <span class="text-sm text-gray-500">🔇 游戏静音</span>
                </el-checkbox>

                <!-- 音量滑块 -->
                <div class="flex items-center gap-2 flex-1 max-w-xs">
                    <span class="text-sm text-gray-500 whitespace-nowrap">游戏音量</span>
                    <el-slider v-model="settings.volume" :min="0" :max="100" :step="1" :disabled="settings.mute"
                        show-input class="flex-1" />
                </div>
            </div>
        </div>

        <!-- 游戏网格 -->
        <div v-if="filteredGames.length" class="px-8 pb-8 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            <div v-for="game in filteredGames" :key="game.id"
                class="game-card group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer border border-gray-100 hover:border-blue-200 hover:-translate-y-1"
                @click="showTips(game)">
                <!-- 封面 -->
                <div class="relative aspect-[4/3] overflow-hidden">
                    <img v-if="game.cover && !errorIds.has(game.id)" :src="game.cover" :alt="game.name"
                        class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        loading="lazy" @error="errorIds.add(game.id)" />
                    <div v-else
                        class="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 text-gray-400">
                        <svg class="w-10 h-10 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span class="text-xs">{{ game.name }}</span>
                    </div>

                    <!-- hover 遮罩：开始游戏按钮 -->
                    <button
                        class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-3"
                        @click.stop="openGame(game)">
                        <span
                            class="px-5 py-2 bg-white/90 hover:bg-white text-gray-800 text-xs font-medium rounded-full backdrop-blur-sm shadow-md transition-colors">
                            🎮 开始游戏
                        </span>
                    </button>

                    <!-- 教程问号按钮 -->
                    <button v-if="game.tips_images?.length || game.tips"
                        class="tips-btn absolute top-2 right-2 w-6 h-6 rounded-full bg-amber-400 hover:bg-amber-500 text-white text-xs font-bold flex items-center justify-center shadow-sm transition-colors z-10"
                        title="查看玩法" @click.stop="showTips(game)">
                        ?
                    </button>
                </div>

                <!-- 信息 -->
                <div class="p-3">
                    <h3
                        class="font-semibold text-gray-800 text-sm truncate group-hover:text-blue-600 transition-colors">
                        {{ game.name }}
                    </h3>
                    <p v-if="game.tips" class="text-xs text-gray-400 mt-1 line-clamp-1">
                        {{ game.tips }}
                    </p>
                </div>
            </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="px-8 py-20 text-center text-gray-400">
            <svg class="w-16 h-16 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>没有找到匹配的游戏</p>
        </div>

        <!-- 玩法教程弹窗 -->
        <el-dialog v-model="tipsVisible" width="520px" :close-on-click-modal="true" center>
            <template #header>
                <div class="flex items-center gap-2">
                    <span class="text-lg font-bold text-gray-800">{{ currentGame?.name }} · 游戏玩法</span>
                </div>
            </template>

            <div v-if="currentGame" class="space-y-4">
                <!-- tips 文字 -->
                <p v-if="currentGame.tips"
                    class="text-gray-700 leading-relaxed text-sm bg-amber-50 rounded-lg p-3 border border-amber-100">
                    <span class="text-amber-600 font-medium mr-1">💡</span>
                    {{ currentGame.tips }}
                </p>

                <!-- tips_images 图片（横向） -->
                <div v-if="tipsImageList.length" class="space-y-2">
                    <div class="text-sm font-medium text-gray-600">
                        图示 ({{ tipsImageList.length }} 张) · 点图可放大
                    </div>
                    <div class="flex flex-wrap gap-3">
                        <el-image v-for="(src, idx) in tipsImageList" :key="idx" :src="src" :initial-index="idx"
                            :preview-src-list="tipsImageList" fit="contain"
                            class="h-60 rounded-lg border border-gray-200 cursor-zoom-in hover:shadow-md hover:border-blue-200 transition-all"
                            preview-teleported />
                    </div>
                </div>
            </div>
            <template #footer>
                <div class="flex justify-between">
                    <el-button color="#0f172b" round plain @click="tipsVisible = false">取消</el-button>
                    <el-button type="primary" round @click="startGameFromDialog">🎮 开始游戏</el-button>
                </div>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'

interface Game {
    id: string
    name: string
    url: string
    cover?: string
    tips?: string
    tips_images?: string[]
    [key: string]: any
}

interface GameSettings {
    mute: boolean
    volume: number // 0~100
}

interface AudioDeviceInfo {
    deviceId: string
    label: string
    isDefault: boolean
}

const STORAGE_KEY = 'game-settings'

// 从 localStorage 读设置，默认 静音=false, 音量=100
function loadSettings(): GameSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return JSON.parse(raw)
    } catch { }
    return { mute: false, volume: 100 }
}

const games = ref<Game[]>([])
const errorIds = ref(new Set<string>())
const keyword = ref('')
const settings = ref<GameSettings>(loadSettings())

// 自动保存设置
watch(settings, (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
}, { deep: true })

// 搜索过滤
const filteredGames = computed(() => {
    if (!keyword.value.trim()) return games.value
    const kw = keyword.value.trim().toLowerCase()
    return games.value.filter(g => g.name.toLowerCase().includes(kw))
})

// 弹窗相关
const tipsVisible = ref(false)
const currentGame = ref<Game | null>(null)

const tipsImageList = computed(() => {
    if (!currentGame.value?.tips_images?.length) return []
    return currentGame.value.tips_images.map((p: string) => '/' + p)
})

function showTips(game: Game) {
    currentGame.value = game
    tipsVisible.value = true
}

function openGame(game: Game) {
    window.ipcBridge.invoke('app:openGameWindow', {
        url: game.url,
        title: game.name,
        mute: settings.value.mute,
        volume: settings.value.volume / 100,
    })
}

function startGameFromDialog() {
    if (!currentGame.value) return
    openGame(currentGame.value)
    tipsVisible.value = false
}

async function loadGames() {
    try {
        const res = await fetch('/games.json')
        games.value = await res.json()
    } catch (e) {
        console.error('加载游戏列表失败:', e)
    }
}

// ============ 🔊 播放设备相关 ============
const audioDevices = ref<AudioDeviceInfo[]>([])
const audioLoading = ref(false)


function openSystemMixer() {
    window.ipcBridge.invoke('app:openSystemMixer')
}

async function loadAudioDevices() {
    audioLoading.value = true
    try {
        // 1. 主进程：拿系统默认输出设备名
        const defaultName: string | null = await window.ipcBridge.invoke('app:getDefaultAudioDevice')
        console.log('[audio] 系统默认设备名:', defaultName)

        // 2. 先触发一次 getUserMedia，让 enumerateDevices 能拿到 label
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach(t => t.stop())
        } catch { }

        const devices = await navigator.mediaDevices.enumerateDevices()

        // 3. 过滤 + 去重
        const seen = new Set<string>()  // ← 补上这个！
        const outputs = devices
            .filter(d => d.kind === 'audiooutput')
            .filter(d => {
                // 过滤 Web API 自动生成的 "Default - xxx" 虚拟节点
                if (/^default\s*[-—]/i.test(d.label || '')) return false
                // 去重
                const key = (d.label || d.deviceId).toLowerCase()
                if (seen.has(key)) return false
                seen.add(key)
                return true
            })

        console.log('[audio] Web 枚举到的输出设备:', outputs.map(d => d.label))

        // 4. 智能匹配：去掉括号后缀 + 去空格
        const normalize = (s: string) =>
            s.toLowerCase()
                .replace(/\s*$[^)]*$/g, '')  // ← 修正正则！
                .replace(/\s+/g, '')

        const normalizedDefault = defaultName ? normalize(defaultName) : ''

        audioDevices.value = outputs.map(d => {
            const label = d.label || d.deviceId
            const normalizedLabel = normalize(label)
            const isDefault = !!defaultName && (
                label.toLowerCase() === defaultName.toLowerCase() ||
                normalizedLabel === normalizedDefault ||
                normalizedLabel.includes(normalizedDefault) ||
                normalizedDefault.includes(normalizedLabel)
            )
            return { deviceId: d.deviceId, label, isDefault }
        })

        console.log('[audio] 最终设备列表:', audioDevices.value)
    } catch (e) {
        console.error('加载音频设备失败:', e)
    } finally {
        audioLoading.value = false
    }
}



onMounted(() => {
    loadGames()
    loadAudioDevices()  // 加这行，页面打开就加载
})
</script>

<style lang="scss" scoped>
.line-clamp-1 {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
</style>