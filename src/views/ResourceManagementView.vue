<template>
  <section>
    <div class="page-head">
      <div>
        <h1>用户资源管理</h1>
      </div>
    </div>
    <el-card shadow="never" class="content-card resource-card merged-onu-snapshot-card">
      <template #header>
        <div class="card-header-line merged-onu-snapshot-header">
          <span>合并 ONU 数据快照</span>
          <div class="merged-onu-search">
            <el-input
              v-model="state.resource.search"
              clearable
              placeholder="搜索 OLT、ONU、设备号、LOID、用户、电话、地址"
              @keyup.enter="loadResourceUsers"
              @clear="loadResourceUsers"
            >
              <template #append><el-button @click="loadResourceUsers">搜索</el-button></template>
            </el-input>
          </div>
        </div>
      </template>
      <el-table :data="resourceUserPageRows" border stripe size="small" class="resource-table">
        <el-table-column prop="oltIp" label="OLT IP地址" min-width="140" />
        <el-table-column prop="onuIndex" label="ONU 索引" min-width="130" />
        <el-table-column prop="deviceNumber" label="网管二期设备号" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="cell-copy-row">
              <span>{{ row.deviceNumber || "未同步" }}</span>
              <button v-if="row.deviceNumber" type="button" class="quick-copy-btn" title="复制设备号" @click.stop="quickCopy(row.deviceNumber, '设备号')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              </button>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="loid" label="LOID" min-width="140">
          <template #default="{ row }">
            <div class="cell-copy-row">
              <span>{{ row.loid || "-" }}</span>
              <button v-if="row.loid" type="button" class="quick-copy-btn" title="复制 LOID" @click.stop="quickCopy(row.loid, 'LOID')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              </button>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="userPhone" label="电话" min-width="140">
          <template #default="{ row }">
            <div class="cell-copy-row">
              <span>{{ row.userPhone || "-" }}</span>
              <button v-if="row.userPhone" type="button" class="quick-copy-btn" title="复制电话" @click.stop="quickCopy(row.userPhone, '电话')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              </button>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="installationAddress" label="装机地址" min-width="220" show-overflow-tooltip />
        <el-table-column prop="syncedAt" label="同步时间" min-width="180" />
      </el-table>
      <el-pagination
        v-if="state.resource.users.length"
        v-model:current-page="state.resource.userPage"
        :page-size="state.resource.pageSize"
        :total="state.resource.users.length"
        layout="total, prev, pager, next"
        small
        background
        class="resource-pagination"
      />
    </el-card>
    <el-card shadow="never" class="content-card resource-card merged-onu-sync-card">
      <template #header>
        <div class="merged-header-wrapper">
          <div class="merged-title-group">
            <span class="merged-header-title">合并 ONU 数据同步</span>
            <span class="merged-header-desc">聚合网管二期源与一期 BOSS 资源，提供全网统一的 ONU 资产与用户视图</span>
          </div>
          <div class="merged-header-right">
            <el-tag :type="state.mergedOnu.dataset.synced ? 'success' : 'warning'" effect="light" round>
              {{ state.mergedOnu.dataset.synced ? '● 数据集已就绪' : '○ 尚未同步' }}
            </el-tag>
            <el-button size="small" :loading="state.mergedOnu.syncing" @click="loadMergedOnuSyncState">
              刷新状态
            </el-button>
          </div>
        </div>
      </template>

      <!-- 核心 KPI 看板网格 -->
      <div class="merged-kpi-grid">
        <!-- 指标 1：已合并总量 -->
        <div class="merged-kpi-card kpi-card-highlight">
          <div class="kpi-card-head">
            <span class="kpi-title">已合并 ONU 总量</span>
            <span class="kpi-badge kpi-badge-teal">统一快照</span>
          </div>
          <div class="kpi-number-row">
            <span class="kpi-number">{{ Number(state.mergedOnu.dataset.snapshotCount || 0).toLocaleString() }}</span>
            <span class="kpi-unit">条</span>
          </div>
          <div class="kpi-footnote">
            <span>最近完成：{{ formatDate(state.mergedOnu.dataset.lastCompletedAt || state.mergedOnu.dataset.updatedAt) || '暂无记录' }}</span>
          </div>
        </div>

        <!-- 指标 2：二期设备源 -->
        <div class="merged-kpi-card">
          <div class="kpi-card-head">
            <span class="kpi-title">网管二期设备源</span>
            <span class="kpi-badge" :class="state.mergedOnu.sources.network.synced ? 'kpi-badge-blue' : 'kpi-badge-gray'">
              {{ state.mergedOnu.sources.network.synced ? '二期已就绪' : '未同步' }}
            </span>
          </div>
          <div class="kpi-number-row">
            <span class="kpi-number">{{ Number(state.mergedOnu.sources.network.count || 0).toLocaleString() }}</span>
            <span class="kpi-unit">条</span>
          </div>
          <div class="kpi-footnote">
            <span>快照时间：{{ formatDate(state.mergedOnu.sources.network.snapshotAt) || '暂无快照' }}</span>
          </div>
        </div>

        <!-- 指标 3：双端冲突自主裁决与对齐 -->
        <div
          class="merged-kpi-card merged-kpi-card-clickable"
          :class="state.mergedOnu.dataset.lastConflictCount > 0 ? 'kpi-card-warning' : 'kpi-card-teal'"
          @click="openMergedConflictDialog"
          title="点击查看双端冲突自主智能裁决与对齐审计明细"
        >
          <div class="kpi-card-head">
            <span class="kpi-title">双端冲突自主裁决</span>
            <span class="kpi-badge" :class="state.mergedOnu.dataset.lastConflictCount > 0 ? 'kpi-badge-amber' : 'kpi-badge-teal'">
              {{ state.mergedOnu.dataset.lastConflictCount > 0 ? '需关注差异' : '已全部自主裁决' }}
            </span>
          </div>
          <div class="kpi-number-row">
            <span class="kpi-number" :class="state.mergedOnu.dataset.lastConflictCount > 0 ? 'text-amber' : 'text-teal'">
              {{ Number(state.mergedOnu.dataset.lastArbitratedCount || state.mergedOnu.dataset.lastConflictCount || 0).toLocaleString() }}
            </span>
            <span class="kpi-unit">项</span>
          </div>
          <div class="kpi-footnote">
            <span>{{ state.mergedOnu.dataset.lastConflictCount > 0 ? '双端字段存在冲突，已按策略容错' : '双端差异已由系统自动仲裁对齐，无须人工介入' }}</span>
            <span class="kpi-click-hint">点击查看自主裁决明细 →</span>
          </div>
        </div>

        <!-- 指标 4：一期 BOSS 历史 -->
        <div class="merged-kpi-card">
          <div class="kpi-card-head">
            <span class="kpi-title">一期 BOSS 历史姓名</span>
            <span class="kpi-badge" :class="state.mergedOnu.bossSync.nameHistoryCompletedAt ? 'kpi-badge-teal' : 'kpi-badge-amber'">
              {{ state.mergedOnu.bossSync.nameHistoryCompletedAt ? '已初始化' : '待初始化' }}
            </span>
          </div>
          <div class="kpi-number-row">
            <span v-if="state.mergedOnu.bossSync.nameHistoryCompletedAt" class="kpi-number">
              {{ Number(state.mergedOnu.bossSync.nameHistoryCount || 0).toLocaleString() }}
            </span>
            <span v-else class="kpi-text-pending">待初始化</span>
            <span v-if="state.mergedOnu.bossSync.nameHistoryCompletedAt" class="kpi-unit">个 LOID</span>
          </div>
          <div class="kpi-footnote">
            <span>{{ state.mergedOnu.bossSync.nameHistoryCompletedAt ? '历史姓名已持久化至台账' : '覆盖至：' + (state.mergedOnu.sources.nmse.coverageThrough || '未确认') }}</span>
          </div>
        </div>
      </div>

      <!-- 精简技术元数据信息行 -->
      <div class="merged-meta-banner">
        <div class="merged-meta-col">
          <span class="meta-field-label">统一合并时间:</span>
          <span class="meta-field-value">{{ formatDate(state.mergedOnu.dataset.mergedAt) || '暂无合并记录' }}</span>
        </div>
        <div class="merged-meta-col">
          <span class="meta-field-label">后台运行状态:</span>
          <span class="meta-field-value">
            <span class="meta-status-pill" :class="'pill-' + (state.mergedOnu.progress.status || 'idle')">
              {{ mergedOnuSyncStatusText(state.mergedOnu.progress) }}
            </span>
          </span>
        </div>
        <div class="merged-meta-col meta-revision-col" v-if="state.mergedOnu.dataset.revision">
          <span class="meta-field-label">Revision:</span>
          <div class="meta-revision-box">
            <code class="meta-revision-code" :title="state.mergedOnu.dataset.revision">
              {{ state.mergedOnu.dataset.revision.length > 28 ? state.mergedOnu.dataset.revision.slice(0, 26) + '...' : state.mergedOnu.dataset.revision }}
            </code>
            <el-button link type="primary" size="small" class="copy-rev-btn" @click="copyRevision(state.mergedOnu.dataset.revision)">
              复制
            </el-button>
          </div>
        </div>
      </div>

      <!-- 规整操作工具栏 -->
      <div class="merged-action-container">
        <div class="merged-action-group">
          <span class="action-group-title">阶段操作：</span>
          <el-button
            :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'network'"
            :disabled="state.mergedOnu.syncing || !state.oss.loggedIn"
            @click="syncMergedOnuOperation('network')"
          >
            二期全量同步
          </el-button>
          <el-button
            :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'nmse'"
            :disabled="state.mergedOnu.syncing || !state.resource.loggedIn"
            @click="syncMergedOnuOperation('nmse')"
          >
            {{ state.mergedOnu.bossSync.nameHistoryCompletedAt ? '一期 BOSS 增量同步' : '一期 BOSS 历史全量初始化' }}
          </el-button>
          <el-button
            :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'merge'"
            :disabled="state.mergedOnu.syncing || !state.mergedOnu.sources.network.synced || !state.mergedOnu.sources.nmse.synced"
            @click="syncMergedOnuOperation('merge')"
          >
            手动合并
          </el-button>
          <el-button
            :loading="state.mergedOnu.cleaningDuplicates"
            :disabled="state.mergedOnu.syncing"
            @click="cleanupMergedOnuDuplicates"
          >
            🧹 清理重复快照
          </el-button>
        </div>
        <div class="merged-action-primary">
          <el-button
            type="primary"
            class="full-sync-btn"
            :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'full'"
            :disabled="state.mergedOnu.syncing || !state.resource.loggedIn || !state.oss.loggedIn"
            @click="syncMergedOnuDataset"
          >
            {{ state.mergedOnu.bossSync.nameHistoryCompletedAt ? '一键全量合并 (二期全量 + 一期增量)' : '一键全流程同步并初始化' }}
          </el-button>
        </div>
      </div>

      <div class="merged-action-tips" title="每次操作前自动备份本机 SQLite 并自动去重">
        <span class="tip-icon">ℹ️</span>
        <span>操作安全保障：每次操作前自动备份本机 SQLite，并在全量合并前自动清理旧快照重复数据，防止 BOSS 增量迁移冲突。</span>
      </div>
      <div v-if="state.mergedOnu.syncing || state.mergedOnu.progress.status === 'running' || state.mergedOnu.progress.error" class="resource-user-progress merged-onu-sync-progress">
        <div class="resource-progress-heading">
          <div>
            <span class="resource-progress-label">{{ mergedOnuSyncPhaseText(state.mergedOnu.progress.phase) }}</span>
            <strong>{{ state.mergedOnu.progress.networkRows || 0 }} 网络 ONU · {{ state.mergedOnu.progress.nmseRows || 0 }} NMSE 用户 · {{ state.mergedOnu.progress.mergedRows || 0 }} 已合并</strong>
          </div>
          <el-tag :type="state.mergedOnu.progress.status === 'failed' ? 'danger' : state.mergedOnu.progress.status === 'success' ? 'success' : 'warning'">{{ mergedOnuSyncStatusText(state.mergedOnu.progress) }}</el-tag>
        </div>
        <el-progress :percentage="mergedOnuSyncPercent(state.mergedOnu.progress)" :indeterminate="state.mergedOnu.progress.status === 'running' && !state.mergedOnu.progress.totalOlts" :stroke-width="14" />
        <div class="resource-progress-meta">
          <span v-if="state.mergedOnu.progress.phase === 'fetching-nmse-history'">历史批次 {{ state.mergedOnu.progress.nmseCompletedChunks || 0 }} / {{ state.mergedOnu.progress.nmseChunkCount || 0 }} · 当前批次 {{ state.mergedOnu.progress.nmseCompletedPages || 0 }} / {{ state.mergedOnu.progress.nmsePages || 0 }} 页</span>
          <span v-else-if="state.mergedOnu.progress.phase === 'fetching-nmse' && state.mergedOnu.progress.nmsePages">NMSE {{ state.mergedOnu.progress.nmseCompletedPages || 0 }} / {{ state.mergedOnu.progress.nmsePages }} 页 · {{ state.mergedOnu.progress.nmseWorkers || 1 }} 路并发</span>
          <span v-else>OLT {{ state.mergedOnu.progress.completedOlts || 0 }} / {{ state.mergedOnu.progress.totalOlts || 0 }}</span>
          <span>冲突 {{ state.mergedOnu.progress.conflicts || 0 }}</span>
        </div>
        <el-alert v-if="state.mergedOnu.progress.error" :title="state.mergedOnu.progress.error" type="error" :closable="false" show-icon />
      </div>
    </el-card>
    <el-card shadow="never" class="content-card resource-card">
      <template #header>
        <div class="oss-card-heading">
          <span>NMSE-PON 服务器配置</span>
          <el-tag :type="state.resource.loggedIn ? 'success' : 'info'">{{ state.resource.loggedIn ? '资源系统已登录' : '未登录' }}</el-tag>
        </div>
      </template>
      <el-form label-position="top">
        <div class="oss-config-grid">
          <el-form-item label="服务器地址"><el-input v-model="state.resource.config.serverUrl" placeholder="http://172.18.254.7:9000" /></el-form-item>
          <el-form-item label="用户名"><el-input v-model="state.resource.config.username" /></el-form-item>
          <el-form-item label="登录密码"><el-input v-model="state.resource.config.password" type="password" show-password placeholder="保存后持久化至数据库，无需每次输入" /></el-form-item>
        </div>
        <div class="toolbar" style="margin-top: 14px">
          <el-button type="primary" :loading="state.resource.configLoading" @click="saveResourceManagementConfig">保存配置</el-button>
          <el-button v-if="state.resource.loggedIn" @click="logoutResourceManagement">退出登录</el-button>
          <el-button v-else type="primary" :loading="state.resource.loginLoading" @click="loginResourceManagement">登录资源系统</el-button>
        </div>
      </el-form>
    </el-card>
    <el-card shadow="never" class="content-card resource-card oss-config-card">
      <template #header>
        <div class="oss-card-heading">
          <span>网管二期历史光功率配置</span>
          <el-tag :type="state.oss.loggedIn ? 'success' : 'info'">{{ state.oss.loggedIn ? '已登录' : '未登录' }}</el-tag>
        </div>
      </template>
      <el-form label-position="top" class="oss-config-form">
        <div class="oss-config-grid">
          <el-form-item label="OSS 认证地址"><el-input v-model="state.oss.config.authBaseUrl" placeholder="http://10.205.136.199:18140" /></el-form-item>
          <el-form-item label="网管二期地址"><el-input v-model="state.oss.config.ngbBaseUrl" placeholder="http://10.205.137.22:8080" /></el-form-item>
          <el-form-item label="用户名"><el-input v-model="state.oss.config.username" autocomplete="off" /></el-form-item>
          <el-form-item label="组织名称">
            <el-select
              v-model="state.oss.config.organizationName"
              filterable
              allow-create
              default-first-option
              placeholder="例如：南区分公司（可下拉选择）"
              style="width: 100%"
              @change="handleWizardOrgChange"
            >
              <el-option
                v-for="org in state.oss.discoveredOrgs"
                :key="org.name"
                :label="org.name"
                :value="org.name"
              >
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span>{{ org.name }}</span>
                  <span style="color: var(--el-text-color-secondary); font-size: 12px;">{{ (org.rooms || []).length }} 个机房</span>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="机房名称">
            <el-select
              v-model="state.oss.config.roomName"
              filterable
              allow-create
              default-first-option
              placeholder="例如：核心机房（可下拉选择）"
              style="width: 100%"
            >
              <el-option
                v-for="room in currentOrgRoomOptions"
                :key="room"
                :label="room"
                :value="room"
              />
            </el-select>
          </el-form-item>
        </div>
        <div class="toolbar">
          <el-button type="success" plain :loading="state.oss.roomsLoading" @click="fetchOssRoomInfo">读取机房信息</el-button>
          <el-button :loading="state.oss.configLoading" @click="saveOssResourceConfig">保存配置</el-button>
          <el-button v-if="state.oss.loggedIn" @click="logoutOssResource">退出网管二期</el-button>
          <el-button v-else type="primary" :loading="state.oss.loginLoading" @click="loginOssResource">{{ (state.oss.credentialConfigured || state.oss.autoLoginConfigured) && !state.oss.password ? '登录网管二期' : '保存并登录' }}</el-button>
        </div>
      </el-form>
      <el-alert v-if="state.oss.loggedIn" :title="'已发现 ' + state.oss.olts.length + ' 台目标机房 OLT'" type="success" :closable="false" show-icon />
      <el-table v-if="state.oss.olts.length" :data="state.oss.olts" border stripe size="small" class="oss-discovered-table">
        <el-table-column prop="resourceIp" label="支撑网 IP" min-width="160" />
        <el-table-column prop="roomName" label="机房" min-width="140" />
      </el-table>
    </el-card>
  </section>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 用户资源管理。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "ResourceManagementView",
  setup() {
    return useAppContext();
  }
};
</script>
