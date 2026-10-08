<template>
  <section>
    <div class="page-head">
      <div>
        <h1>运维概览</h1>
      </div>
      <div class="page-head-actions">
        <el-button type="primary" plain @click="setView('wizard')">
          系统配置向导
        </el-button>
      </div>
    </div>
    <el-alert
      v-if="!isSystemConfigured && !state.wizardDismissed"
      title="系统尚未完成初始化分发配置"
      type="warning"
      description="检测到系统尚未纳管 OLT 设备或一二期网管尚未配置/同步。推荐使用【系统配置向导】进行全流程初始化引导。"
      show-icon
      closable
      @close="dismissWizardBanner"
      style="margin-bottom: 16px;"
    >
      <template #default>
        <div style="margin-top: 8px;">
          <el-button type="primary" size="small" @click="setView('wizard')">进入系统配置向导</el-button>
        </div>
      </template>
    </el-alert>
    <!-- 1. 属地机房概况横幅（根据二期网管选定机房动态联动） -->
    <div class="room-summary-banner">
      <div class="room-banner-left">
        <div class="room-badge-box">
          <span class="room-badge-icon">📍</span>
          <div>
            <span class="room-title-heading">属地机房：{{ state.dashboardWorkdesk.roomName || state.oss.config.roomName || '厚街机房' }}</span>
            <span class="room-org-label">({{ state.dashboardWorkdesk.organizationName || state.oss.config.organizationName || '东莞分公司' }})</span>
          </div>
        </div>
        <div class="room-assets-chips">
          <span class="room-chip room-chip-success">
            <span>纳管 OLT:</span>
            <strong>{{ state.dashboardWorkdesk.summary.totalOlts || state.olts.length || 0 }} 台在线</strong>
          </span>
          <span class="room-chip">
            <span>纳管用户总数:</span>
            <strong>{{ state.dashboardWorkdesk.summary.totalOnus || 0 }} 户</strong>
          </span>
          <span class="room-chip">
            <span>大网在线率:</span>
            <strong style="color: #16a34a;">{{ state.dashboardWorkdesk.summary.onlineRate || '100%' }}</strong>
          </span>
          <span class="room-chip">
            <span>已配 PON 口:</span>
            <strong>{{ state.dashboardWorkdesk.summary.totalPonPorts || 0 }} 个</strong>
          </span>
        </div>
      </div>
      <div class="room-banner-right">
        <el-button size="small" :loading="state.dashboardWorkdesk.loading" @click="loadRemediationWorkdesk()">
          🔄 刷新设备状态
        </el-button>
        <el-button size="small" type="primary" plain @click="setView('wizard')">
          ⚙️ 切换机房/向导
        </el-button>
      </div>
    </div>

    <!-- 2. 三大直观圆饼状态图（Donut Charts：设备在线、大网在线率、光衰质量） -->
    <div class="donut-charts-grid" v-if="state.dashboardWorkdesk.donutCharts && state.dashboardWorkdesk.donutCharts.deviceStatus">
      <!-- 饼图 1：OLT 设备通信态势 -->
      <div class="donut-card">
        <div class="donut-card-title">
          <span>🖥️ OLT 设备连通态势</span>
          <el-tag size="small" type="success" effect="plain">全部可达</el-tag>
        </div>
        <div class="donut-card-body">
          <div class="donut-chart-view">
            <svg viewBox="0 0 36 36" style="width: 100%; height: 100%;">
              <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" stroke-width="3.5" />
              <circle
                cx="18" cy="18" r="15.915"
                fill="transparent"
                stroke="#16a34a"
                stroke-width="3.5"
                stroke-dasharray="100 0"
                stroke-dashoffset="0"
                transform="rotate(-90 18 18)"
              />
            </svg>
            <div class="donut-center-overlay">
              <div class="donut-center-val" style="color: #16a34a;">{{ state.dashboardWorkdesk.donutCharts.deviceStatus.centerText }}</div>
              <div class="donut-center-sub">{{ state.dashboardWorkdesk.donutCharts.deviceStatus.subText }}</div>
            </div>
          </div>
          <div class="donut-legend-list">
            <div class="donut-legend-item">
              <span class="donut-legend-label">
                <span class="donut-legend-dot" style="background: #16a34a;"></span>
                <span>正常在线</span>
              </span>
              <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.deviceStatus.onlineCount }} 台 (100%)</span>
            </div>
            <div class="donut-legend-item">
              <span class="donut-legend-label">
                <span class="donut-legend-dot" style="background: #ef4444;"></span>
                <span>通信异常</span>
              </span>
              <span class="donut-legend-val">0 台 (0%)</span>
            </div>
            <div class="donut-legend-item" style="border-top: 1px dashed #e2e8f0; padding-top: 4px; margin-top: 2px;">
              <span class="donut-legend-label" style="font-size: 11px; color: #64748b;">
                <span>中兴 {{ state.dashboardWorkdesk.donutCharts.deviceStatus.vendorDistribution[0]?.count || 6 }} 台 · 华为 {{ state.dashboardWorkdesk.donutCharts.deviceStatus.vendorDistribution[1]?.count || 2 }} 台</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 饼图 2：机房大网实时在线率 -->
      <div class="donut-card">
        <div class="donut-card-title">
          <span>👥 机房大网实时在线率</span>
          <el-tag size="small" type="primary" effect="plain">{{ state.dashboardWorkdesk.donutCharts.userOnline.total }} 户纳管</el-tag>
        </div>
        <div class="donut-card-body">
          <div class="donut-chart-view">
            <svg viewBox="0 0 36 36" style="width: 100%; height: 100%;">
              <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" stroke-width="3.5" />
              <!-- 在线弧段 (绿) -->
              <circle
                cx="18" cy="18" r="15.915"
                fill="transparent"
                stroke="#16a34a"
                stroke-width="3.5"
                :stroke-dasharray="userOnlineDash"
                stroke-dashoffset="0"
                transform="rotate(-90 18 18)"
              />
              <!-- 离线弧段 (灰) -->
              <circle
                cx="18" cy="18" r="15.915"
                fill="transparent"
                stroke="#94a3b8"
                stroke-width="3.5"
                :stroke-dasharray="userOfflineDash"
                :stroke-dashoffset="userOfflineOffset"
                transform="rotate(-90 18 18)"
              />
            </svg>
            <div class="donut-center-overlay">
              <div class="donut-center-val" style="color: #0f172a;">{{ state.dashboardWorkdesk.donutCharts.userOnline.centerText }}</div>
              <div class="donut-center-sub">{{ state.dashboardWorkdesk.donutCharts.userOnline.subText }}</div>
            </div>
          </div>
          <div class="donut-legend-list">
            <div class="donut-legend-item">
              <span class="donut-legend-label">
                <span class="donut-legend-dot" style="background: #16a34a;"></span>
                <span>正常在线</span>
              </span>
              <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.userOnline.onlineCount }} 户 ({{ state.dashboardWorkdesk.donutCharts.userOnline.percent }}%)</span>
            </div>
            <div class="donut-legend-item">
              <span class="donut-legend-label">
                <span class="donut-legend-dot" style="background: #94a3b8;"></span>
                <span>离线停机</span>
              </span>
              <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.userOnline.offlineCount }} 户 ({{ (100 - state.dashboardWorkdesk.donutCharts.userOnline.percent).toFixed(1) }}%)</span>
            </div>
            <div class="donut-legend-item" style="border-top: 1px dashed #e2e8f0; padding-top: 4px; margin-top: 2px;">
              <span class="donut-legend-label" style="font-size: 11px; color: #64748b;">
                <span>活跃业务口: {{ state.dashboardWorkdesk.summary.activePonPorts }} 个</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 饼图 3：全网光衰质量梯度 -->
      <div class="donut-card">
        <div class="donut-card-title">
          <span>💡 全网光衰质量健康梯度</span>
          <el-tag size="small" :type="state.dashboardWorkdesk.donutCharts.opticalHealth.percent > 80 ? 'success' : 'warning'" effect="plain">
            达标率 {{ state.dashboardWorkdesk.donutCharts.opticalHealth.percent }}%
          </el-tag>
        </div>
        <div class="donut-card-body">
          <div class="donut-chart-view">
            <svg viewBox="0 0 36 36" style="width: 100%; height: 100%;">
              <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" stroke-width="3.5" />
              <!-- 优良段 (绿) -->
              <circle
                cx="18" cy="18" r="15.915"
                fill="transparent"
                stroke="#16a34a"
                stroke-width="3.5"
                :stroke-dasharray="opticalExcellentDash"
                stroke-dashoffset="0"
                transform="rotate(-90 18 18)"
              />
              <!-- 轻度弱光段 (黄) -->
              <circle
                cx="18" cy="18" r="15.915"
                fill="transparent"
                stroke="#f59e0b"
                stroke-width="3.5"
                :stroke-dasharray="opticalMildDash"
                :stroke-dashoffset="opticalMildOffset"
                transform="rotate(-90 18 18)"
              />
              <!-- 严重弱光段 (红) -->
              <circle
                cx="18" cy="18" r="15.915"
                fill="transparent"
                stroke="#dc2626"
                stroke-width="3.5"
                :stroke-dasharray="opticalSevereDash"
                :stroke-dashoffset="opticalSevereOffset"
                transform="rotate(-90 18 18)"
              />
            </svg>
            <div class="donut-center-overlay">
              <div class="donut-center-val" style="color: #16a34a;">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.centerText }}</div>
              <div class="donut-center-sub">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.subText }}</div>
            </div>
          </div>
          <div class="donut-legend-list">
            <div class="donut-legend-item">
              <span class="donut-legend-label">
                <span class="donut-legend-dot" style="background: #16a34a;"></span>
                <span>优良达标</span>
              </span>
              <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.excellentCount }} 户</span>
            </div>
            <div class="donut-legend-item">
              <span class="donut-legend-label">
                <span class="donut-legend-dot" style="background: #f59e0b;"></span>
                <span>轻度关注</span>
              </span>
              <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.mildWeakCount }} 户</span>
            </div>
            <div class="donut-legend-item">
              <span class="donut-legend-label">
                <span class="donut-legend-dot" style="background: #dc2626;"></span>
                <span>严重弱光</span>
              </span>
              <span class="donut-legend-val" style="color: #dc2626;">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.severeWeakCount }} 户</span>
            </div>
            <div class="donut-card-footnote">
              * 优良 ≥ -24 dBm · 轻度 -27~-24 dBm · 严重 &lt; -27 dBm
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 【核心主角】机房 OLT 设备运行矩阵与健康卡片 -->
    <div class="olt-matrix-section">
      <div class="section-subhead">
        <div class="section-subhead-title">
          <span>🖥️ 机房 OLT 设备运行矩阵与健康卡片</span>
          <el-tag size="small" type="info" effect="plain">{{ state.dashboardWorkdesk.oltMatrix.length || state.olts.length }} 台设备已纳管</el-tag>
        </div>
        <div style="font-size: 12px; color: #64748b;">
          点击各设备卡片可一键打开内置 Telnet 终端进入配置，或选定切换该设备
        </div>
      </div>

      <div class="olt-cards-grid">
        <div
          v-for="olt in state.dashboardWorkdesk.oltMatrix"
          :key="olt.id"
          class="olt-device-card"
        >
          <div>
            <div class="olt-card-header">
              <div class="olt-card-brand-col">
                <div v-if="olt.vendor === 'zte'" class="brand-logo-badge zte" title="中兴通讯 ZTE">
                  <svg viewBox="0 0 54 20" width="54" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <text x="2" y="16" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-weight="900" font-style="italic" font-size="18" fill="#005bac" letter-spacing="1">ZTE</text>
                  </svg>
                </div>
                <div v-else class="brand-logo-badge huawei" title="华为技术 HUAWEI">
                  <svg viewBox="0 0 94 20" width="94" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g transform="translate(1, 1)" fill="#cf0a2c">
                      <path d="M9 1 C8.6 3.8 8 6 6.8 8 C7.8 7.5 8.8 6.5 9 1Z"/>
                      <path d="M10.5 1 C10.9 3.8 11.5 6 12.7 8 C11.7 7.5 10.7 6.5 10.5 1Z"/>
                      <path d="M5.5 2.5 C5.5 5 5 7 3.5 9 C4.8 8.2 6 7 5.5 2.5Z"/>
                      <path d="M14 2.5 C14 5 14.5 7 16 9 C14.7 8.2 13.5 7 14 2.5Z"/>
                      <path d="M2.5 5 C3 7.5 3 9.2 1.8 11.2 C2.8 10.2 3.8 8.8 2.5 5Z"/>
                      <path d="M17 5 C16.5 7.5 16.5 9.2 17.7 11.2 C16.7 10.2 15.7 8.8 17 5Z"/>
                      <path d="M0.8 8.5 C2 10.5 2.5 12 1.8 14 C2.5 12.8 3.2 11 0.8 8.5Z"/>
                      <path d="M18.7 8.5 C17.5 10.5 17 12 17.7 14 C17 12.8 16.3 11 18.7 8.5Z"/>
                    </g>
                    <text x="24" y="15" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-weight="800" font-size="12" fill="#cf0a2c" letter-spacing="0.5">HUAWEI</text>
                  </svg>
                </div>
                <span class="olt-card-status-badge">
                  <span class="pulse-dot"></span>
                  <span>在线 {{ olt.responseTime }}ms</span>
                </span>
              </div>

              <div class="olt-card-info-col">
                <div class="olt-card-name">{{ olt.host }}</div>
                <div class="olt-card-ip">{{ olt.model }}</div>
              </div>
            </div>

            <div class="olt-card-metrics-grid">
              <div class="olt-metric-item">
                <span class="olt-metric-label">纳管总用户</span>
                <span class="olt-metric-val">{{ olt.totalOnus }} 户</span>
              </div>
              <div class="olt-metric-item">
                <span class="olt-metric-label">实时在线率</span>
                <span class="olt-metric-val rate">{{ olt.onlineRate }}</span>
              </div>
              <div class="olt-metric-item">
                <span class="olt-metric-label">已配 PON 口</span>
                <span class="olt-metric-val">{{ olt.ponPortCount }} 个</span>
              </div>
              <div class="olt-metric-item">
                <span class="olt-metric-label">弱光用户占比</span>
                <span class="olt-metric-val weak">{{ olt.weakRate }} ({{ olt.weakOnuCount }}户)</span>
              </div>
            </div>

            <!-- 进度 1：在线进度条 -->
            <div class="olt-card-progress">
              <div class="olt-progress-meta">
                <span>在线进度 (在线 {{ olt.onlineOnus }} / 离线 {{ olt.offlineOnus }})</span>
                <span>{{ olt.onlineRate }}</span>
              </div>
              <div class="olt-progress-bar-bg">
                <div class="olt-progress-bar-fill" :style="{ width: olt.onlinePercent + '%' }"></div>
              </div>
            </div>

            <!-- 进度 2：弱光占比进度条 -->
            <div class="olt-card-progress" style="margin-top: 8px;">
              <div class="olt-progress-meta">
                <span>弱光进度 (超标 {{ olt.weakOnuCount }} 户 / 达标 {{ Math.max(0, olt.totalOnus - olt.weakOnuCount) }} 户)</span>
                <span style="color: #ea580c; font-weight: 700;">{{ olt.weakRate }}</span>
              </div>
              <div class="olt-progress-bar-bg">
                <div
                  class="olt-progress-bar-fill"
                  :style="{
                    width: olt.weakPercent + '%',
                    background: olt.weakPercent > 10 ? '#ef4444' : (olt.weakPercent > 5 ? '#f59e0b' : '#10b981')
                  }"
                ></div>
              </div>
            </div>

            <!-- PON 业务端口预警状态条 (点击弹出详细排障建议窗口) -->
            <div
              v-if="olt.alertPorts && olt.alertPorts.length > 0"
              class="olt-ports-status-bar alert"
              @click="openOltAlertsDialog(olt)"
              title="点击弹出预警端口详情与排障建议"
            >
              <div class="status-alert-left">
                <span class="status-indicator-dot alert"></span>
                <span style="font-weight: 600;">
                  {{ olt.alertPorts.length }} 个 PON 端口需关注
                </span>
              </div>
              <span class="status-toggle-btn">
                查看详情 🔍
              </span>
            </div>
            <div v-else class="olt-ports-status-bar normal">
              <div class="status-alert-left">
                <span class="status-indicator-dot normal"></span>
                <span>PON 端口指标全优</span>
              </div>
              <el-tag size="small" type="success" effect="plain" style="height: 20px; font-size: 11px;">正常</el-tag>
            </div>
          </div>

          <div class="olt-card-actions">
            <el-button
              size="small"
              type="primary"
              plain
              style="width: 100%;"
              @click="openOltTerminalFromMatrix(olt)"
            >
              🤖 AI 终端
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 首页运维概览。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "DashboardView",
  setup() {
    return useAppContext();
  }
};
</script>
