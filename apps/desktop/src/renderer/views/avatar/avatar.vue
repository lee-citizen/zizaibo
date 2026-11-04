<template>
  <div class="avatar-page h-full overflow-y-auto bg-gray-50">
    <div class="px-8 py-6 space-y-5">
      <!-- 标题 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-2xl">🖨️</span>
          <h1 class="text-2xl font-bold text-gray-800">头像打印</h1>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-400">今日已打印：{{ avatar.printedCount }}</span>
          <el-button
            :type="avatar.printing ? 'danger' : 'primary'"
            :loading="printLoading"
            @click="onTogglePrint"
          >
            {{ avatar.printing ? '停止打印' : '开始打印' }}
          </el-button>
        </div>
      </div>

      <!-- ========== 打印模式选择 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div class="flex items-center gap-8">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-700">打印模式：</span>
            <el-radio-group v-model="avatar.mode" size="large">
              <el-radio-button value="2d">2D 打印</el-radio-button>
              <el-radio-button value="3d">3D 打印</el-radio-button>
            </el-radio-group>
          </div>
          <p class="text-xs text-gray-400">
            点击「开始打印」会弹出打印窗口，直播弹幕按下方规则自动触发打印
          </p>
        </div>
      </div>

      <!-- ========== 规则表单 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <h2 class="text-base font-semibold text-gray-800 mb-4">
          {{ editingId ? '编辑规则' : '新增规则' }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <!-- 事件类型 -->
          <div>
            <label class="block text-xs text-gray-500 mb-1.5">事件类型</label>
            <el-select v-model="form.event" placeholder="请选择" class="w-full">
              <el-option
                v-for="(label, value) in EVENT_LABELS"
                :key="value"
                :label="label"
                :value="value"
              />
            </el-select>
          </div>

          <!-- 匹配条件 -->
          <div>
            <label class="block text-xs text-gray-500 mb-1.5">
              匹配条件
              <span class="text-gray-300">
                （{{ form.event === 'gift' ? '礼物名' : form.event === 'comment' ? '评论内容' : '留空全匹配' }}）
              </span>
            </label>
            <el-input
              v-model="form.match"
              :placeholder="form.event === 'gift' ? '如：小心心' : form.event === 'comment' ? '如：666' : '该事件无需匹配条件'"
              :disabled="form.event !== 'gift' && form.event !== 'comment'"
              class="w-full"
            />
          </div>

          <!-- 头像大小 -->
          <div>
            <label class="block text-xs text-gray-500 mb-1.5">头像大小</label>
            <el-select v-model="form.size" placeholder="请选择" class="w-full">
              <el-option label="大头像" :value="2" />
              <el-option label="小头像" :value="1" />
            </el-select>
          </div>

          <!-- 打印数量 -->
          <div>
            <label class="block text-xs text-gray-500 mb-1.5">打印数量</label>
            <el-input-number
              v-model="form.count"
              :min="1"
              :max="100"
              class="w-full"
            />
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-end gap-2">
            <el-button type="primary" @click="onSaveRule">
              {{ editingId ? '更新' : '新增' }}
            </el-button>
            <el-button v-if="editingId" @click="onCancelEdit">取消</el-button>
          </div>
        </div>
      </div>

      <!-- ========== 规则表格 ========== -->
      <div class="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div class="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <span class="text-sm font-medium text-gray-700">打印规则（{{ avatar.rules.length }}）</span>
          <div class="flex items-center gap-2">
            <el-button
              size="small"
              type="danger"
              plain
              :disabled="!selectedIds.length"
              @click="onDeleteSelected"
            >
              删除选中（{{ selectedIds.length }}）
            </el-button>
          </div>
        </div>

        <el-table
          :data="avatar.rules"
          v-model:selected-row-keys="selectedIds"
          row-key="id"
          border
          stripe
          style="width: 100%"
          empty-text="暂无规则，在上方添加一条规则"
        >
          <el-table-column type="selection" width="48" />
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="row.enabled"
                size="small"
                @change="avatar.toggleEnabled(row.id)"
              />
            </template>
          </el-table-column>
          <el-table-column label="事件类型" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="eventTagType(row.event)" effect="plain">
                {{ EVENT_LABELS[row.event] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="匹配条件" min-width="160">
            <template #default="{ row }">
              <span v-if="row.match" class="text-gray-700">{{ row.match }}</span>
              <span v-else class="text-gray-300">— 全匹配 —</span>
            </template>
          </el-table-column>
          <el-table-column label="头像大小" width="100">
            <template #default="{ row }">
              {{ SIZE_LABELS[row.size] }}
            </template>
          </el-table-column>
          <el-table-column label="打印数量" width="100">
            <template #default="{ row }">
              {{ row.count }} 张
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="onEdit(row)">编辑</el-button>
              <el-button size="small" text type="danger" @click="onDelete(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 提示 -->
      <div class="text-xs text-gray-400 leading-relaxed px-1">
        <p>· 事件类型：进场 / 礼物 / 评论 / 关注 / 点赞，对应直播间观众行为</p>
        <p>· 匹配条件：礼物事件填礼物名（支持子串），评论事件填评论关键词，其余事件留空即全部匹配</p>
        <p>· 头像大小：大头像独占一行，小头像每行 3 张；礼物事件建议大头像</p>
        <p>· 一条弹幕只命中第一条匹配的规则；需先「开始打印」打开打印窗口，规则才会生效</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  useAvatarStore,
  EVENT_LABELS,
  SIZE_LABELS,
  type AvatarRule,
} from "@renderer/store/modules/avatar";

const avatar = useAvatarStore();

const printLoading = ref(false);
const selectedIds = ref<string[]>([]);
const editingId = ref<string | null>(null);

const form = reactive<Omit<AvatarRule, "id" | "enabled">>({
  event: "entry",
  match: "",
  size: 2,
  count: 1,
});

// 事件类型变化时清空不适用的匹配条件
watch(
  () => form.event,
  (e) => {
    if (e !== "gift" && e !== "comment") form.match = "";
  },
);

function resetForm(): void {
  form.event = "entry";
  form.match = "";
  form.size = 2;
  form.count = 1;
  editingId.value = null;
}

function onSaveRule(): void {
  if (!form.event) {
    ElMessage.warning("请选择事件类型");
    return;
  }
  if (form.count < 1 || form.count > 100) {
    ElMessage.warning("打印数量需在 1~100 之间");
    return;
  }
  if (editingId.value) {
    avatar.updateRule(editingId.value, {
      event: form.event,
      match: form.match,
      size: form.size,
      count: form.count,
    });
    ElMessage.success("规则已更新");
  } else {
    avatar.addRule({
      enabled: true,
      event: form.event,
      match: form.match,
      size: form.size,
      count: form.count,
    });
    ElMessage.success("规则已添加");
  }
  resetForm();
}

function onEdit(row: AvatarRule): void {
  editingId.value = row.id;
  form.event = row.event;
  form.match = row.match;
  form.size = row.size;
  form.count = row.count;
}

function onCancelEdit(): void {
  resetForm();
}

function onDelete(id: string): void {
  ElMessageBox.confirm("确定删除该规则？", "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消",
  })
    .then(() => {
      avatar.deleteRule(id);
      if (editingId.value === id) resetForm();
      ElMessage.success("已删除");
    })
    .catch(() => {});
}

function onDeleteSelected(): void {
  if (!selectedIds.value.length) return;
  ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 条规则？`, "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消",
  })
    .then(() => {
      avatar.deleteSelected(selectedIds.value);
      selectedIds.value = [];
      ElMessage.success("已删除");
    })
    .catch(() => {});
}

function eventTagType(event: AvatarRule["event"]): "" | "success" | "warning" | "danger" | "info" {
  switch (event) {
    case "gift":
      return "danger";
    case "entry":
      return "success";
    case "follow":
      return "warning";
    case "like":
      return "";
    default:
      return "info";
  }
}

async function onTogglePrint(): Promise<void> {
  printLoading.value = true;
  try {
    if (avatar.printing) {
      await avatar.stopPrint();
      ElMessage.success("打印窗口已关闭");
    } else {
      await avatar.startPrint();
      ElMessage.success("打印窗口已打开，等待直播弹幕触发打印");
    }
  } catch {
    ElMessage.error("操作失败，请重试");
  } finally {
    printLoading.value = false;
  }
}
</script>
