<template>
    <div class="key-page  flex gap-5 p-5 overflow-hidden">
        <!-- 左侧：产品信息面板 -->
        <aside class="info-panel flex-1 rounded-2xl p-7 flex flex-col justify-between overflow-hidden">
            <div class="relative z-10">
                <div class="brand flex items-center gap-2">
                    <div class="logo-dot" />
                    <span class="brand-name">LiveTools 会员中心</span>
                </div>
                <h1 class="headline mt-6">激活授权，解锁全部能力</h1>
                <p class="headline-sub mt-2">一卡一机绑定，激活后本机永久享有会员权益</p>

                <div class="feature-grid mt-8">
                    <div class="feature-item" v-for="f in features" :key="f.title">
                        <div class="feature-icon-wrap" :style="{ background: f.color }">
                            <el-icon class="feature-icon">
                                <component :is="f.icon" />
                            </el-icon>
                        </div>
                        <div class="feature-text">
                            <div class="feature-title">{{ f.title }}</div>
                            <div class="feature-desc">{{ f.desc }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="relative z-10 tip-box">
                <el-icon class="tip-icon">
                    <Warning />
                </el-icon>
                <span>机器码是本机唯一标识，换电脑需联系客服重新绑定</span>
            </div>
        </aside>

        <!-- 右侧：激活操作区 -->
        <section
            class="action-panel w-[440px] flex-shrink-0 bg-white rounded-2xl shadow-sm border border-slate-100 p-7 flex flex-col">
            <!-- 状态条 -->
            <div class="status-bar" :class="activated ? 'on' : 'off'">
                <span class="status-dot" />
                <span>{{ activated ? `已激活 · ${planName} · 至 ${expireDate}` : '未激活 · 功能受限' }}</span>
            </div>

            <h2 class="panel-title mt-6">卡密激活</h2>
            <p class="panel-desc mt-1">
                {{ activated ? '本机已激活，到期后功能自动锁定，续费请联系客服。' : '请输入卡密完成激活，卡密与本机机器码绑定。' }}
            </p>

            <!-- 机器码 -->
            <div class="machine-row mt-6">
                <span class="machine-label">本机机器码</span>
                <div class="machine-display">
                    <code class="machine-code" :title="machineId">{{ machineId || '获取中...' }}</code>
                    <button class="copy-btn" @click="copyMachineId" :disabled="!machineId">
                        <el-icon>
                            <CopyDocument />
                        </el-icon>
                        复制
                    </button>
                </div>
            </div>

            <!-- 未激活：输入卡密 -->
            <div v-if="!activated" class="mt-7">
                <label class="field-label">卡密</label>
                <el-input v-model="cardKey" placeholder="请输入卡密" size="large" clearable class="card-input"
                    @keyup.enter="activate">
                    <template #prefix>
                        <el-icon class="text-slate-400">
                            <Key />
                        </el-icon>
                    </template>
                </el-input>

                <div class="options-row mt-4">
                    <el-checkbox v-model="rememberKey">记住卡密</el-checkbox>
                    <el-checkbox v-model="autoLogin">自动登录</el-checkbox>
                </div>

                <el-button type="primary" size="large" class="activate-btn mt-6" :loading="activating"
                    @click="activate">
                    立即激活
                </el-button>
            </div>

            <!-- 已激活 -->
            <div v-else class="active-box mt-7">
                <el-icon class="active-check" color="#10b981" :size="32">
                    <CircleCheckFilled />
                </el-icon>
                <div class="active-info">
                    <div class="active-title">本机已激活，全部功能可用</div>
                    <div class="active-sub">套餐：{{ planName }} · 有效期至 {{ expireDate }}</div>
                    <div class="active-tip">卡密与机器码绑定，请勿外泄</div>
                </div>
                <el-button plain size="large" class="logout-btn" @click="logout">退出登录</el-button>
            </div>

            <div class="footer-note mt-auto pt-6 text-xs text-slate-400 leading-relaxed">
                购买即表示已阅读并同意《免责声明》，请遵守直播平台规则合规使用。
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Key, CircleCheckFilled, Warning, Film, ChatDotRound, Clock, Headset } from '@element-plus/icons-vue'
import { ipc } from '@renderer/utils/ipcRenderer'

const machineId = ref('')
const cardKey = ref('')
const rememberKey = ref(true)
const autoLogin = ref(false)
const activated = ref(false)
const activating = ref(false)
const planName = ref('付费')
const expireDate = ref('')

const features = [
    {
        title: '游戏自动直播',
        desc: '内置百余款小游戏，无人值守自动开播',
        color: '#3b82f6',
        icon: Film,
    },
    {
        title: '智能语音朗读',
        desc: '真人语音，自动播报弹幕与互动',
        color: '#8b5cf6',
        icon: ChatDotRound,
    },
    {
        title: '整点自动报时',
        desc: '可自定义语音内容，准时提醒观众',
        color: '#f59e0b',
        icon: Clock,
    },
    {
        title: '虚拟声卡直推',
        desc: '音频分流，直播音质清晰稳定',
        color: '#10b981',
        icon: Headset,
    },
]

const fetchMachineId = async () => {
    try {
        const id = await ipc.app.getMachineId()
        machineId.value = (id || '').slice(0, 32)
    } catch {
        machineId.value = '获取失败'
    }
}

const copyMachineId = async () => {
    if (!machineId.value) return
    try {
        await navigator.clipboard.writeText(machineId.value)
        ElMessage.success('机器码已复制')
    } catch {
        ElMessage.error('复制失败，请手动复制')
    }
}

const activate = async () => {
    if (!cardKey.value.trim()) {
        ElMessage.warning('请输入卡密')
        return
    }
    activating.value = true
    await new Promise((r) => setTimeout(r, 800))
    activated.value = true
    planName.value = '付费'
    expireDate.value = formatDate(new Date(Date.now() + 30 * 24 * 3600 * 1000))
    activating.value = false
    ElMessage.success('激活成功')
}

const logout = () => {
    activated.value = false
    cardKey.value = ''
    ElMessage.info('已退出登录')
}

const formatDate = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => {
    fetchMachineId()
})
</script>

<style lang="scss" scoped>
.key-page {
    background: #f7f9f9;
    height: calc(100% - 50px);
}

/* ============ 左侧信息面板 ============ */
.info-panel {
    background: linear-gradient(160deg, #1e293b 0%, #0f172a 100%);
    position: relative;

    &::before {
        content: '';
        position: absolute;
        right: -120px;
        top: -120px;
        width: 360px;
        height: 360px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(59, 130, 246, 0.3), transparent 70%);
    }

    &::after {
        content: '';
        position: absolute;
        left: -80px;
        bottom: -80px;
        width: 280px;
        height: 280px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(139, 92, 246, 0.25), transparent 70%);
    }
}

.brand {
    color: #cbd5e1;
}

.logo-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
}

.brand-name {
    font-size: 14px;
    letter-spacing: 0.5px;
}

.headline {
    font-size: 30px;
    font-weight: 700;
    color: #f1f5f9;
    line-height: 1.3;
}

.headline-sub {
    font-size: 14px;
    color: #94a3b8;
}

.feature-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}

.feature-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
}

.feature-icon-wrap {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.9;
}

.feature-icon {
    font-size: 18px;
    color: #fff;
}

.feature-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
}

.feature-desc {
    margin-top: 2px;
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.5;
}

.tip-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.25);
    border-radius: 10px;
    color: #93c5fd;
    font-size: 12px;
}

.tip-icon {
    flex-shrink: 0;
    color: #60a5fa;
    font-size: 16px;
}

/* ============ 右侧操作面板 ============ */
.status-bar {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 13px;
    align-self: flex-start;

    &.on {
        background: rgba(16, 185, 129, 0.1);
        color: #059669;

        .status-dot {
            background: #10b981;
        }
    }

    &.off {
        background: rgba(148, 163, 184, 0.15);
        color: #64748b;

        .status-dot {
            background: #94a3b8;
        }
    }
}

.status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
}

.panel-title {
    font-size: 22px;
    font-weight: 700;
    color: #1e293b;
}

.panel-desc {
    font-size: 13px;
    color: #64748b;
    line-height: 1.6;
}

/* 机器码 */
.machine-label {
    display: block;
    font-size: 13px;
    color: #64748b;
    margin-bottom: 8px;
}

.machine-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
}

.machine-code {
    font-family: monospace;
    font-size: 13px;
    color: #334155;
    word-break: break-all;
}

.copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 12px;
    color: #475569;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;

    &:hover:not(:disabled) {
        border-color: #3b82f6;
        color: #3b82f6;
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
}

/* 表单 */
.field-label {
    display: block;
    font-size: 13px;
    color: #475569;
    margin-bottom: 8px;
    font-weight: 500;
}

.card-input :deep(.el-input__wrapper) {
    border-radius: 10px;
}

.options-row {
    display: flex;
    align-items: center;
    gap: 20px;
    font-size: 13px;
}

.activate-btn {
    width: 100%;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    border: none;
    border-radius: 10px;
    font-weight: 600;
    letter-spacing: 1px;

    &:hover {
        opacity: 0.92;
    }
}

/* 已激活 */
.active-box {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 18px;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 12px;
    flex-wrap: wrap;
}

.active-check {
    flex-shrink: 0;
}

.active-info {
    flex: 1;
    min-width: 0;
}

.active-title {
    font-size: 15px;
    font-weight: 600;
    color: #065f46;
}

.active-sub {
    margin-top: 2px;
    font-size: 13px;
    color: #047857;
}

.active-tip {
    margin-top: 2px;
    font-size: 12px;
    color: #6b7280;
}

.logout-btn {
    flex-shrink: 0;
    border-radius: 8px;
}

.footer-note {
    border-top: 1px solid #f1f5f9;
}
</style>