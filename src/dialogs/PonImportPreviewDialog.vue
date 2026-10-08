<template>
  <el-dialog
    v-model="state.ponImportPreview.visible"
    title="PON 台账 Excel 导入预检"
    width="780px"
    destroy-on-close
  >
    <div class="pon-import-preview-box">
      <div class="feishu-metrics-bar" style="margin-bottom: 16px;">
        <div class="feishu-metric-item">
          <span class="feishu-metric-label">读取行数</span>
          <span class="feishu-metric-value">{{ state.ponImportPreview.totalRaw }} 行</span>
        </div>
        <div class="feishu-metric-divider"></div>
        <div class="feishu-metric-item">
          <span class="feishu-metric-label">有效数据</span>
          <span class="feishu-metric-value text-success">🟢 {{ state.ponImportPreview.validCount }} 条</span>
        </div>
        <div class="feishu-metric-divider"></div>
        <div class="feishu-metric-item">
          <span class="feishu-metric-label">覆盖已有</span>
          <span class="feishu-metric-value text-warning">{{ state.ponImportPreview.overrideCount }} 条</span>
        </div>
        <div class="feishu-metric-divider"></div>
        <div class="feishu-metric-item">
          <span class="feishu-metric-label">新增端口</span>
          <span class="feishu-metric-value text-success">+{{ state.ponImportPreview.newCount }} 条</span>
        </div>
        <div class="feishu-metric-divider"></div>
        <div class="feishu-metric-item">
          <span class="feishu-metric-label">跳过空行</span>
          <span class="feishu-metric-value text-muted">{{ state.ponImportPreview.emptyCount }} 行</span>
        </div>
        <div class="feishu-metric-divider"></div>
        <div class="feishu-metric-item">
          <span class="feishu-metric-label">格式异常</span>
          <span class="feishu-metric-value" :class="state.ponImportPreview.invalidRows.length ? 'text-danger' : 'text-muted'">
            {{ state.ponImportPreview.invalidRows.length ? '⚠️ ' + state.ponImportPreview.invalidRows.length + ' 行' : '0' }}
          </span>
        </div>
      </div>

      <el-alert
        v-if="state.ponImportPreview.invalidRows.length"
        :title="'检测到 ' + state.ponImportPreview.invalidRows.length + ' 处格式异常，这些行在导入时将被自动跳过：'"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px;"
      />

      <el-table
        v-if="state.ponImportPreview.invalidRows.length"
        :data="state.ponImportPreview.invalidRows.slice(0, 10)"
        border
        stripe
        size="small"
        max-height="200"
        style="margin-bottom: 16px;"
      >
        <el-table-column prop="line" label="Excel行号" width="100" />
        <el-table-column prop="reason" label="异常原因" min-width="200" />
        <el-table-column label="原始数据摘要" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">
            {{ JSON.stringify(row.raw) }}
          </template>
        </el-table-column>
      </el-table>

      <div class="gateway-actions" style="margin-top: 20px; justify-content: flex-end; display: flex; gap: 12px;">
        <el-button @click="state.ponImportPreview.visible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!state.ponImportPreview.validCount"
          :loading="state.ponImportPreview.loading"
          @click="confirmImportPonRows"
        >
          确认导入并覆盖应用 (共 {{ state.ponImportPreview.validCount }} 条)
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { useAppContext } from "../app-context.js";

// PON 台账 Excel 导入预检。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "PonImportPreviewDialog",
  setup() {
    const ctx = useAppContext();
    const { fetchPonPorts, ponAdminApi, ponPortFilterState, state } = ctx;

    async function saveImportedPonRows(rows, successLabel = "导入") {
      if (!rows.length) throw new Error("没有识别到可导入的台账行");
      const data = await ponAdminApi.save(rows, `${successLabel}失败`);
      state.ponPorts = await fetchPonPorts();
      ponPortFilterState.reset(state.ponPorts);
      ElMessage.success(`已${successLabel} ${data.count} 条`);
    }

    async function confirmImportPonRows() {
      const validRows = state.ponImportPreview.validRows || [];
      if (!validRows.length) return;
      state.ponImportPreview.loading = true;
      try {
        await saveImportedPonRows(validRows, "导入 Excel");
        state.ponImportPreview.visible = false;
      } catch (error) {
        ElMessage.error(error.message || "应用台账导入失败");
      } finally {
        state.ponImportPreview.loading = false;
      }
    }

    return { ...ctx, confirmImportPonRows };
  }
};
</script>
