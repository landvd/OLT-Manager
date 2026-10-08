<template>
  <el-dialog
    v-model="state.onuDetail.visible"
    title="ONU 详情"
    width="760px"
    destroy-on-close
  >
    <div v-loading="state.onuDetail.loading">
      <el-empty v-if="!state.onuDetail.data" description="请选择 LOID 查看详情" />
      <div v-else class="onu-detail">
          <el-descriptions title="基础信息" :column="2" border class="detail-block">
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
              <div class="cell-copy-row" style="gap: 8px; align-items: center;">
                <el-tag :type="diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).type" effect="dark">
                  {{ diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).badge }}
                </el-tag>
                <span v-if="diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).advice" class="muted" style="font-size: 13px;">
                  👉 {{ diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).advice }}
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
            <el-descriptions :column="2" border>
              <el-descriptions-item label="历史采样数">{{ state.onuDetail.data.history?.sampleCount || 0 }}</el-descriptions-item>
              <el-descriptions-item label="离线次数">{{ state.onuDetail.data.history?.offlineCount || 0 }}</el-descriptions-item>
            </el-descriptions>
            <div v-if="state.onuDetail.data.history?.rxPower?.length >= 2" class="rx-trend-block">
              <div class="detail-subtitle">光功率历史趋势</div>
              <svg viewBox="0 0 600 180" class="rx-trend-chart" role="img" aria-label="光功率历史趋势">
                <polyline :points="rxHistoryPoints(state.onuDetail.data)" fill="none" stroke="#0f766e" stroke-width="3" />
              </svg>
            </div>
            <el-empty v-else description="暂无足够的光功率历史采样" />
            <div class="detail-subtitle">最近几次离线原因</div>
            <el-table
              v-if="state.onuDetail.data.history?.recentOfflineReasons?.length"
              :data="state.onuDetail.data.history.recentOfflineReasons"
              border
              stripe
              size="small"
            >
              <el-table-column prop="time" label="时间" min-width="180" />
              <el-table-column prop="reason" label="离线原因" min-width="140" />
              <el-table-column prop="code" label="原因码" width="90" />
            </el-table>
            <el-empty v-else description="暂无离线事件采样" />
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
                <span style="font-weight: 600; font-size: 13px;">📊 7 天光衰波动分析 (采样 {{ analyzeHistoricalOpticalSeries(state.oss.historyRows).sampleCount }} 次)</span>
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
import { useAppContext } from "../app-context.js";

// ONU 详情。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "OnuDetailDialog",
  setup() {
    return useAppContext();
  }
};
</script>
