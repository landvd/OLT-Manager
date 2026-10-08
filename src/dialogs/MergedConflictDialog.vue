<template>
  <el-dialog
    v-model="state.mergedConflictDialog.visible"
    title="双端冲突自主智能裁决与对齐明细"
    width="920px"
    top="5vh"
    destroy-on-close
    class="conflict-guide-dialog"
  >
    <div v-loading="state.mergedConflictDialog.loading" class="conflict-dialog-container">
      <!-- 顶部横幅：自主裁决说明 -->
      <div class="conflict-auto-resolved-banner">
        <span class="banner-icon">✨</span>
        <div class="banner-text">
          <strong>全自动智能裁决机制已生效</strong>
          <span>双端数据中的重复 LOID、历史工单与坐标歧义已由系统依据物理在线基准、有效手机号及实名交叉验证自主裁决，并择优绑定在网机主。全流程零人工介入，无需人工修改或解绑。</span>
        </div>
      </div>

      <!-- 顶部：分类统计胶囊导航 -->
      <div class="conflict-categories-bar">
        <button
          type="button"
          class="conflict-category-pill"
          :class="{ active: state.mergedConflictDialog.selectedReason === 'all' }"
          @click="selectConflictCategory('all')"
        >
          <span>全部记录</span>
          <span class="pill-count">{{ state.mergedConflictDialog.rows.length }}</span>
        </button>
        <button
          v-for="cat in conflictSummary.categories"
          :key="cat.key"
          type="button"
          class="conflict-category-pill"
          :class="[
            cat.guide.tagType ? 'pill-' + cat.guide.tagType : '',
            { active: state.mergedConflictDialog.selectedReason === cat.key }
          ]"
          @click="selectConflictCategory(cat.key)"
        >
          <span>{{ cat.guide.label }}</span>
          <span class="pill-count">{{ cat.count }}</span>
        </button>
      </div>

      <!-- 核心：修改建议与修改方法指南卡片 -->
      <div v-if="currentConflictGuide" class="conflict-guide-card">
        <div class="guide-card-header">
          <div class="guide-header-left">
            <el-tag :type="currentConflictGuide.tagType" size="default" effect="dark">
              {{ currentConflictGuide.label }}
            </el-tag>
            <span class="guide-severity">状态：{{ currentConflictGuide.severity }}</span>
            <span class="guide-summary-text">{{ currentConflictGuide.summary }}</span>
          </div>
        </div>

        <div class="guide-sections-grid">
          <!-- 模块 1：成因剖析 -->
          <div class="guide-section-box section-cause">
            <div class="section-title">
              <span class="section-icon">🔍</span>
              <strong>成因剖析</strong>
            </div>
            <p class="section-desc">{{ currentConflictGuide.cause }}</p>
          </div>

          <!-- 模块 2：系统当前容错策略 -->
          <div class="guide-section-box section-tolerance">
            <div class="section-title">
              <span class="section-icon">🛡️</span>
              <strong>系统容错与保护</strong>
            </div>
            <p class="section-desc">{{ currentConflictGuide.tolerance }}</p>
          </div>
        </div>

        <!-- 模块 3：处理结论 -->
        <div class="guide-section-box section-suggestion" style="margin-top: 10px;">
          <div class="section-title">
            <span class="section-icon">✅</span>
            <strong>处理结论（零人工介入）</strong>
          </div>
          <p class="section-desc">{{ currentConflictGuide.suggestion }}</p>
        </div>

        <!-- 模块 4：系统自主裁决流程 -->
        <div class="guide-section-box section-actions" style="margin-top: 10px;">
          <div class="section-title">
            <span class="section-icon">⚙️</span>
            <strong>系统自主裁决流程</strong>
          </div>
          <div class="guide-steps-list">
            <div v-for="step in currentConflictGuide.actionMethods" :key="step.step" class="guide-step-item">
              <div class="step-badge">{{ step.step }}</div>
              <div class="step-content">
                <strong class="step-title">{{ step.title }}：</strong>
                <span class="step-detail">{{ step.content }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 下方：明细筛选与冲突数据列表 -->
      <div class="conflict-table-panel" style="margin-top: 18px;">
        <div class="conflict-filter-bar">
          <div class="filter-left">
            <span class="filter-heading">双端差异自主裁决清单</span>
            <span class="filter-total">（共 {{ filteredConflictRows.length }} 条记录）</span>
          </div>
          <div class="filter-right">
            <el-select
              v-model="state.mergedConflictDialog.selectedOltIp"
              placeholder="筛选 OLT IP"
              clearable
              size="small"
              style="width: 160px;"
            >
              <el-option label="全部 OLT" value="" />
              <el-option v-for="ip in conflictOltIpList" :key="ip" :label="ip" :value="ip" />
            </el-select>
            <el-input
              v-model="state.mergedConflictDialog.searchKeyword"
              placeholder="搜索 LOID / 端口 / 详情..."
              clearable
              size="small"
              style="width: 220px;"
            />
          </div>
        </div>

        <el-table
          :data="pagedConflictRows"
          border
          stripe
          size="small"
          max-height="320"
          class="conflict-data-table"
        >
          <el-table-column label="冲突类型" width="160">
            <template #default="{ row }">
              <el-tag :type="getConflictGuide(row.reason).tagType" size="small">
                {{ getConflictGuide(row.reason).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="oltIp" label="OLT 设备 IP" width="140" />
          <el-table-column prop="onuIndexDisplay" label="物理端口/坐标" width="130">
            <template #default="{ row }">
              <code>{{ row.onuIndexDisplay || '未解析' }}</code>
            </template>
          </el-table-column>
          <el-table-column prop="loid" label="LOID" min-width="150">
            <template #default="{ row }">
              <div class="cell-copy-row">
                <span>{{ row.loid || '无' }}</span>
                <el-button v-if="row.loid" type="primary" link size="small" @click="copyText(row.loid)">
                  复制
                </el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="detail" label="冲突成因与明细" min-width="260" show-overflow-tooltip />
          <el-table-column label="快捷操作" width="90" align="center">
            <template #default="{ row }">
              <el-button
                type="primary"
                link
                size="small"
                @click="copyConflictRowInfo(row)"
                title="复制该条设备诊断信息"
              >
                复制信息
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分页栏 -->
        <div class="conflict-pagination-bar">
          <el-pagination
            v-model:current-page="state.mergedConflictDialog.page"
            v-model:page-size="state.mergedConflictDialog.pageSize"
            :page-sizes="[10, 15, 30, 50]"
            :total="filteredConflictRows.length"
            layout="total, sizes, prev, pager, next"
            size="small"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="conflict-dialog-footer">
        <div class="footer-left">
          <el-button type="success" plain size="small" @click="exportConflictsExcel">
            📥 导出冲突清单 (Excel)
          </el-button>
        </div>
        <div class="footer-right">
          <el-button @click="state.mergedConflictDialog.visible = false">关闭</el-button>
          <el-button type="primary" @click="handleRerunMergeSync">
            🔄 重新执行全量融合
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { computed } from "vue";
import { downloadBlob } from "../renderer-services.js";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { loadXlsx } from "../xlsx-runtime.mjs";
import { getConflictGuide, summarizeConflicts, filterConflictRows } from "../merged-conflict-guide.mjs";
import { useAppContext } from "../app-context.js";

// 双端冲突裁决明细。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "MergedConflictDialog",
  setup() {
    const ctx = useAppContext();
    const { copyText, state, syncMergedOnuOperation } = ctx;

    function selectConflictCategory(reason) {
      state.mergedConflictDialog.selectedReason = reason;
      if (reason !== "all") {
        state.mergedConflictDialog.activeGuideKey = reason;
      }
      state.mergedConflictDialog.page = 1;
    }

    const conflictSummary = computed(() => {
      return summarizeConflicts(state.mergedConflictDialog.rows);
    });

    const currentConflictGuide = computed(() => {
      const key = state.mergedConflictDialog.selectedReason !== "all"
        ? state.mergedConflictDialog.selectedReason
        : (state.mergedConflictDialog.activeGuideKey || "network_coordinate_duplicate");
      return getConflictGuide(key);
    });

    const conflictOltIpList = computed(() => {
      const ips = new Set((state.mergedConflictDialog.rows || []).map((r) => r.oltIp).filter(Boolean));
      return Array.from(ips).sort();
    });

    const filteredConflictRows = computed(() => {
      return filterConflictRows(state.mergedConflictDialog.rows, {
        reason: state.mergedConflictDialog.selectedReason,
        keyword: state.mergedConflictDialog.searchKeyword,
        oltIp: state.mergedConflictDialog.selectedOltIp
      });
    });

    const pagedConflictRows = computed(() => {
      const list = filteredConflictRows.value;
      const page = state.mergedConflictDialog.page || 1;
      const size = state.mergedConflictDialog.pageSize || 15;
      return list.slice((page - 1) * size, page * size);
    });

    async function copyConflictRowInfo(row) {
      const guide = getConflictGuide(row.reason);
      const text = `【双端冲突自主裁决审计信息】
冲突类型：${guide.label} (${guide.severity})
OLT 设备 IP：${row.oltIp || '未指定'}
物理端口/坐标：${row.onuIndexDisplay || '未解析'}
LOID：${row.loid || '无'}
裁决详情：${row.detail || '无'}
系统容错：${guide.tolerance}
处理结论：${guide.suggestion}`;
      const ok = await copyText(text);
      if (ok) {
        ElMessage.success("已复制该条自主裁决审计信息至剪贴板");
      }
    }

    async function exportConflictsExcel() {
      try {
        const XLSX = await loadXlsx();
        const rows = filteredConflictRows.value;
        if (!rows.length) {
          ElMessage.warning("当前没有可导出的冲突记录");
          return;
        }
        const exportData = rows.map((r, i) => {
          const guide = getConflictGuide(r.reason);
          return {
            "序号": i + 1,
            "冲突类型": guide.label,
            "优先级": guide.severity,
            "OLT 设备 IP": r.oltIp || "",
            "物理端口/坐标": r.onuIndexDisplay || "",
            "LOID": r.loid || "",
            "冲突成因明细": r.detail || "",
            "成因剖析": guide.cause,
            "系统容错策略": guide.tolerance,
            "权威修改建议": guide.suggestion,
            "分步修改方法": guide.actionMethods.map((m) => `${m.step}.${m.title}:${m.content}`).join(" ")
          };
        });
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "属性比对冲突与修改建议");
        const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const fileName = `属性比对冲突与修改建议-${new Date().toISOString().slice(0, 10)}.xlsx`;
        downloadBlob(blob, fileName);
        ElMessage.success(`已成功导出 ${rows.length} 条冲突排查与处置清单！`);
      } catch (err) {
        ElMessage.error("导出 Excel 失败：" + (err.message || String(err)));
      }
    }

    async function handleRerunMergeSync() {
      state.mergedConflictDialog.visible = false;
      await syncMergedOnuOperation("full");
    }

    return { ...ctx, selectConflictCategory, conflictSummary, currentConflictGuide, conflictOltIpList, filteredConflictRows, pagedConflictRows, copyConflictRowInfo, exportConflictsExcel, handleRerunMergeSync };
  }
};
</script>
