<template>
  <el-dialog
    v-model="state.onuDetail.visible"
    title="ONU 详情"
    width="min(960px, 94vw)"
    class="onu-detail-dialog"
    destroy-on-close
  >
    <div v-loading="state.onuDetail.loading">
      <el-empty v-if="!state.onuDetail.data" description="请选择 LOID 查看详情" />
      <div v-else class="onu-detail">
          <el-descriptions title="基础信息" :column="2" border class="detail-block onu-detail-desc" label-class-name="onu-detail-label">
            <el-descriptions-item label="OLT">{{ state.onuDetail.data.olt.name }}</el-descriptions-item>
            <el-descriptions-item label="厂商型号">{{ state.onuDetail.data.olt.vendor }} {{ state.onuDetail.data.olt.model }}</el-descriptions-item>
          <el-descriptions-item label="槽/板卡/PON/ID">
            {{ onuCoordinateLabel(state.onuDetail.data.onu) }}
          </el-descriptions-item>
            <el-descriptions-item label="ONU 序列号">{{ state.onuDetail.data.onu.serial }}</el-descriptions-item>
            <el-descriptions-item label="LOID">{{ state.onuDetail.data.onu.loid || "未登记" }}</el-descriptions-item>
            <el-descriptions-item label="ONU 名称/备注">{{ state.onuDetail.data.onu.name || "未登记" }}</el-descriptions-item>
            <el-descriptions-item label="状态">{{ phaseInfo(state.onuDetail.data.onu.phase).text }}</el-descriptions-item>
            <el-descriptions-item label="电话">{{ state.onuDetail.data.onu.userPhone || "未登记" }}</el-descriptions-item>
            <el-descriptions-item label="装机地址">{{ state.onuDetail.data.onu.installationAddress || "未登记" }}</el-descriptions-item>
            <el-descriptions-item label="ONU MAC 地址">{{ state.onuDetail.data.onu.mac || "未登记" }}</el-descriptions-item>
            <el-descriptions-item label="姓名">{{ state.onuDetail.data.onu.username || "未登记" }}</el-descriptions-item>
            <el-descriptions-item label="RX 光功率">{{ state.onuDetail.data.onu.rxPower || "N/A" }}</el-descriptions-item>
            <el-descriptions-item label="ONU 距离">{{ state.onuDetail.data.onu.distance || "N/A" }}</el-descriptions-item>
            <el-descriptions-item label="最近上线时间">{{ state.onuDetail.data.onu.lastOnlineTime || "暂无" }}</el-descriptions-item>
            <el-descriptions-item label="最后离线时间">{{ state.onuDetail.data.onu.lastOfflineTime || "暂无" }}</el-descriptions-item>
            <el-descriptions-item label="离线研判" :span="2">
              <div class="offline-diagnosis">
                <el-tag :type="diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).type" effect="dark">
                  {{ diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).label }}
                </el-tag>
                <span v-if="diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).advice" class="offline-advice">
                  {{ diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).advice }}
                </span>
              </div>
            </el-descriptions-item>
            <el-descriptions-item label="一级地址">{{ state.onuDetail.data.onu.address || "未登记" }}</el-descriptions-item>
            <el-descriptions-item label="外层 VLAN">{{ state.onuDetail.data.onu.outerVlan || "待补充" }}</el-descriptions-item>
            <el-descriptions-item label="用户资源同步时间">{{ formatDate(state.onuDetail.data.onu.userSyncedAt) || "暂无" }}</el-descriptions-item>
            <el-descriptions-item label="所属项目">{{ state.onuDetail.data.onu.project?.name || "未归属" }}</el-descriptions-item>
            <el-descriptions-item label="项目 VLAN">{{ state.onuDetail.data.onu.project?.vlan || "未设置" }}</el-descriptions-item>
          </el-descriptions>

          <el-card shadow="never" class="detail-block history-card">
            <template #header>历史状态</template>
            <div class="history-kpis">
              <div class="history-kpi"><span>采样次数</span><strong>{{ state.onuDetail.data.history?.sampleCount || 0 }}</strong></div>
              <div class="history-kpi"><span>离线次数</span><strong :class="{ 'is-bad': state.onuDetail.data.history?.offlineCount > 0 }">{{ state.onuDetail.data.history?.offlineCount || 0 }}</strong></div>
              <template v-if="rxChart">
                <div class="history-kpi"><span>最新光功率</span><strong :class="`is-${rxChart.stats.tone}`">{{ rxChart.stats.latest.toFixed(2) }} dBm</strong></div>
                <div class="history-kpi"><span>最低 / 最高</span><strong>{{ rxChart.stats.min.toFixed(2) }} / {{ rxChart.stats.max.toFixed(2) }}</strong></div>
                <div class="history-kpi"><span>波动幅度</span><strong :class="{ 'is-bad': rxChart.stats.delta >= 2 }">{{ rxChart.stats.delta.toFixed(2) }} dB</strong></div>
              </template>
            </div>
            <div v-if="rxChart" class="rx-trend-block">
              <div class="detail-subtitle">光功率历史趋势（最近 {{ rxChart.stats.count }} 次采样，单位 dBm）</div>
              <svg :viewBox="`0 0 ${rxChart.width} ${rxChart.height}`" class="rx-trend-chart" role="img" aria-label="光功率历史趋势">
                <rect v-for="band in rxChart.bands" :key="band.tone" :class="`rx-band rx-band-${band.tone}`" :x="band.x" :y="band.y" :width="band.width" :height="band.height" />
                <g v-for="tick in rxChart.yTicks" :key="tick.label">
                  <line class="rx-grid" :x1="rxChart.plot.left" :x2="rxChart.plot.right" :y1="tick.y" :y2="tick.y" />
                  <text class="rx-axis-label" :x="rxChart.plot.left - 8" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <polyline class="rx-line" :points="rxChart.line" />
                <circle v-for="(point, index) in rxChart.points" :key="index" class="rx-point" :cx="point.x" :cy="point.y" r="3">
                  <title>{{ point.time }}  {{ point.value.toFixed(2) }} dBm</title>
                </circle>
                <circle class="rx-latest" :cx="rxChart.latest.x" :cy="rxChart.latest.y" r="5" />
                <text class="rx-latest-label" :x="rxChart.latest.x - 8" :y="rxChart.latestLabelY" text-anchor="end">{{ rxChart.latest.value.toFixed(2) }}</text>
                <text v-for="label in rxChart.xLabels" :key="label.label + label.anchor" class="rx-axis-label" :x="label.x" :y="rxChart.height - 8" :text-anchor="label.anchor">{{ label.label }}</text>
              </svg>
              <div class="rx-legend">
                <span><i class="rx-swatch rx-band-good"></i>优良 ≥ -24</span>
                <span><i class="rx-swatch rx-band-warn"></i>轻度关注 -27 ~ -24</span>
                <span><i class="rx-swatch rx-band-bad"></i>严重弱光 &lt; -27</span>
                <span class="muted">鼠标悬停圆点可查看采样时间与数值</span>
              </div>
            </div>
            <el-empty v-else :image-size="60" description="光功率历史采样不足 2 次，暂无法绘制趋势" />
            <div class="detail-subtitle">最近离线记录</div>
            <el-table
              v-if="state.onuDetail.data.history?.recentOfflineReasons?.length"
              :data="state.onuDetail.data.history.recentOfflineReasons"
              border
              stripe
              size="small"
            >
              <el-table-column label="离线时间" width="200">
                <template #default="{ row }">{{ formatDate(row.time) || row.time || "未知" }}</template>
              </el-table-column>
              <el-table-column label="研判" min-width="200">
                <template #default="{ row }">
                  <el-tag size="small" :type="diagnoseOfflineCause(row.reason).type">{{ diagnoseOfflineCause(row.reason).label }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="设备上报原因" min-width="160">
                <template #default="{ row }">{{ row.reason }}<span v-if="row.code" class="muted">（原因码 {{ row.code }}）</span></template>
              </el-table-column>
            </el-table>
            <el-empty v-else :image-size="60" description="暂无离线记录" />
          </el-card>

          <el-card shadow="never" class="detail-block oss-history-card">
            <template #header>
              <div class="oss-card-heading">
                <div>
                  <strong>网管二期历史光功率</strong>
                </div>
                <el-tag :type="state.oss.loggedIn ? 'success' : 'info'">{{ state.oss.loggedIn ? '会话可用' : '未登录' }}</el-tag>
              </div>
            </template>
            <div class="oss-history-toolbar">
              <el-date-picker
                v-model="state.oss.dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                :clearable="false"
              />
              <el-button
                type="primary"
                :disabled="!state.oss.loggedIn"
                :loading="state.oss.historyLoading"
                title="只读取已保存的历史记录，不触发光功率刷新"
                @click="loadOssOpticalHistory"
              >读取历史光功率</el-button>
            </div>
            <el-alert v-if="!state.oss.loggedIn" title="请先到“用户资源管理”保存网管二期配置并登录。" type="warning" :closable="false" show-icon />
            <el-alert v-else-if="state.oss.historyError" :title="state.oss.historyError" type="warning" :closable="false" show-icon />
            <div v-if="state.oss.historyRows.length && analyzeHistoricalOpticalSeries(state.oss.historyRows).hasData" class="oss-history-analysis-banner" style="margin-bottom: 12px; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-weight: 600; font-size: 13px;"><el-icon class="inline-icon"><TrendCharts /></el-icon>7 天光衰波动分析 (采样 {{ analyzeHistoricalOpticalSeries(state.oss.historyRows).sampleCount }} 次)</span>
                <el-tag :type="analyzeHistoricalOpticalSeries(state.oss.historyRows).degraded ? 'danger' : 'success'" effect="plain">
                  {{ analyzeHistoricalOpticalSeries(state.oss.historyRows).verdict }}
                </el-tag>
              </div>
              <div style="display: flex; gap: 20px; font-size: 12px; color: #475569;">
                <span>最高光衰: <strong>{{ analyzeHistoricalOpticalSeries(state.oss.historyRows).maxRx }}</strong></span>
                <span>最低光衰: <strong>{{ analyzeHistoricalOpticalSeries(state.oss.historyRows).minRx }}</strong></span>
                <span>波动极差: <strong :style="{ color: analyzeHistoricalOpticalSeries(state.oss.historyRows).degraded ? '#dc2626' : '#16a34a' }">{{ analyzeHistoricalOpticalSeries(state.oss.historyRows).delta }}</strong></span>
                <span>平均光衰: <strong>{{ analyzeHistoricalOpticalSeries(state.oss.historyRows).avgRx }}</strong></span>
              </div>
            </div>
            <el-table v-if="state.oss.historyRows.length" :data="state.oss.historyRows" border stripe size="small" max-height="320" class="oss-history-table">
              <el-table-column prop="reportTime" label="采集时间" min-width="180"><template #default="{ row }">{{ formatDate(row.reportTime) }}</template></el-table-column>
              <el-table-column prop="rxOptical" label="ONU RX" width="110"><template #default="{ row }">{{ opticalValue(row.rxOptical) }}</template></el-table-column>
              <el-table-column prop="txOptical" label="ONU TX" width="110"><template #default="{ row }">{{ opticalValue(row.txOptical) }}</template></el-table-column>
              <el-table-column prop="oltRxOptical" label="OLT RX" width="110"><template #default="{ row }">{{ opticalValue(row.oltRxOptical) }}</template></el-table-column>
              <el-table-column prop="lightDecay" label="光衰" width="110"><template #default="{ row }">{{ opticalValue(row.lightDecay) }}</template></el-table-column>
            </el-table>
            <el-empty v-else-if="state.oss.loggedIn && !state.oss.historyLoading && !state.oss.historyError" description="选择日期后读取网管二期历史光功率" />
          </el-card>

      </div>
    </div>
  </el-dialog>
</template>

<script>
import { computed } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { rxHistoryChart } from "../onu-detail-view-state.mjs";
import { ossHistoricalOpticalRequestFor, ossHistoryRowsFromResponse } from "../oss-history-view-state.mjs";
import { useAppContext } from "../app-context.js";

// ONU 详情。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "OnuDetailDialog",
  setup() {
    const ctx = useAppContext();
    const { ossResourceApi, state } = ctx;
    const rxChart = computed(() => rxHistoryChart(state.onuDetail.data));

    async function loadOssOpticalHistory() {
      const detail = state.onuDetail.data;
      const request = ossHistoricalOpticalRequestFor({ detail, dateRange: state.oss.dateRange });
      if (!request.ok) {
        ElMessage.warning(request.error);
        return;
      }
      state.oss.historyLoading = true;
      state.oss.historyError = "";
      state.oss.historyRows = [];
      try {
        const result = await ossResourceApi.historicalOptical(request.payload);
        state.oss.historyRows = ossHistoryRowsFromResponse(result);
        ElMessage.success(`读取到 ${state.oss.historyRows.length} 条历史光功率记录`);
      } catch (error) {
        state.oss.historyError = error.message || "历史光功率读取失败";
        if (/未登录|会话已失效/.test(state.oss.historyError)) state.oss.loggedIn = false;
        ElMessage.error(state.oss.historyError);
      } finally {
        state.oss.historyLoading = false;
      }
    }

    return { ...ctx, rxChart, loadOssOpticalHistory };
  }
};
</script>
