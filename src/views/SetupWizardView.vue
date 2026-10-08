<template>
  <section class="wizard-container">
    <div class="page-head wizard-header">
      <div>
        <h1>系统配置向导</h1>
        <p class="section-lead">分发部署一站式引导：配置一二期网管认证、勾选 OLT 资产纳管、导入台账、全量数据同步与智能配置。</p>
      </div>
      <div class="wizard-header-actions">
        <el-tag v-if="isSystemConfigured" type="success" effect="plain">系统已初始化就绪</el-tag>
        <el-tag v-else type="warning" effect="plain">待完成初始化</el-tag>
        <el-button size="small" @click="setView('dashboard')">返回首页</el-button>
      </div>
    </div>

    <!-- 顶部步骤指示条 -->
    <el-card shadow="never" class="wizard-steps-card">
      <el-steps :active="state.wizard.currentStep - 1" finish-status="success" align-center class="wizard-interactive-steps">
        <el-step title="网管登录" description="一二期网管认证" @click="wizardGoToStep(1)" style="cursor: pointer;" />
        <el-step title="选择 OLT" description="勾选二期网管资产" @click="wizardGoToStep(2)" style="cursor: pointer;" />
        <el-step title="凭据与网络" description="管理IP与访问凭据" @click="wizardGoToStep(3)" style="cursor: pointer;" />
        <el-step title="ONU 台账" description="台账导入与导出" @click="wizardGoToStep(4)" style="cursor: pointer;" />
        <el-step title="数据同步" description="一二期全量融合同步" @click="wizardGoToStep(5)" style="cursor: pointer;" />
        <el-step title="同步 VLAN" description="外层 SVLAN 台账" @click="wizardGoToStep(6)" style="cursor: pointer;" />
        <el-step title="智能能力" description="飞书/AI/搜索配置" @click="wizardGoToStep(7)" style="cursor: pointer;" />
      </el-steps>
    </el-card>

    <!-- 步骤内容区域 -->
    <div class="wizard-step-body">
      <!-- ================= 步骤 1: 网管登录 ================= -->
      <div v-if="state.wizard.currentStep === 1" class="wizard-step-pane">
        <div class="wizard-step-intro">
          <h3>第 1 步：配置一期和二期网管登录数据</h3>
          <p>网管服务器生产地址已预设锁定不可变；请填写一线访问凭据并测试联通性。二期网管测试成功后，即可在下一步自动读取当前局点的 OLT 资产。</p>
        </div>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-card shadow="never" class="wizard-card">
              <template #header>
                <div class="wizard-card-title">
                  <span>一期 NMSE BOSS 网管</span>
                  <el-tag :type="state.resource.loggedIn ? 'success' : 'info'" size="small">
                    {{ state.resource.loggedIn ? '已登录一期' : '未登录' }}
                  </el-tag>
                </div>
              </template>
              <el-form label-position="top">
                <el-form-item label="服务器地址（生产环境固定）">
                  <el-input :model-value="state.resource.config.serverUrl || 'http://172.18.254.7:9000'" disabled placeholder="http://172.18.254.7:9000" />
                  <small class="field-hint">预设固定网管地址，已锁定不可变</small>
                </el-form-item>
                <el-form-item label="网管用户名">
                  <el-input v-model="state.resource.config.username" placeholder="请输入一期网管用户名" />
                </el-form-item>
                <el-form-item label="网管密码">
                  <el-input v-model="state.resource.config.password" type="password" show-password placeholder="请输入一期网管密码" />
                </el-form-item>
                <div class="wizard-card-action">
                  <el-button type="primary" :loading="state.wizard.resourceTestStatus === 'testing'" @click="testWizardResourceLogin">
                    保存并测试一期网管
                  </el-button>
                  <span v-if="state.wizard.resourceTestMessage" :class="state.wizard.resourceTestStatus === 'success' ? 'text-success' : 'text-danger'" class="action-feedback">
                    {{ state.wizard.resourceTestMessage }}
                  </span>
                </div>
              </el-form>
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card shadow="never" class="wizard-card">
              <template #header>
                <div class="wizard-card-title">
                  <span>二期 OSS 资源网管</span>
                  <el-tag :type="state.oss.loggedIn ? 'success' : 'info'" size="small">
                    {{ state.oss.loggedIn ? '已登录二期' : '未登录' }}
                  </el-tag>
                </div>
              </template>
              <el-form label-position="top">
                <el-form-item label="认证服务地址（生产环境固定）">
                  <el-input :model-value="state.oss.config.authBaseUrl || 'http://10.205.136.199:18140'" disabled />
                </el-form-item>
                <el-form-item label="支撑系统地址（生产环境固定）">
                  <el-input :model-value="state.oss.config.ngbBaseUrl || 'http://10.205.137.22:8080'" disabled />
                  <small class="field-hint">预设固定网管地址，已锁定不可变</small>
                </el-form-item>
                <el-row :gutter="12">
                  <el-col :span="12">
                    <el-form-item label="登录账号">
                      <el-input v-model="state.oss.config.username" placeholder="OSS 用户名" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="登录密码">
                      <el-input v-model="state.oss.password" type="password" show-password placeholder="OSS 密码" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <div class="oss-fetch-rooms-toolbar" style="margin: 2px 0 14px; display: flex; align-items: center; justify-content: space-between; background: var(--el-fill-color-light); padding: 8px 12px; border-radius: 6px;">
                  <span style="font-size: 13px; color: var(--el-text-color-regular);">输入账号密码后，可点击自动读取片区与机房：</span>
                  <el-button
                    type="success"
                    plain
                    size="small"
                    :loading="state.oss.roomsLoading"
                    @click="fetchOssRoomInfo"
                  >
                    读取机房信息
                  </el-button>
                </div>
                <el-row :gutter="12">
                  <el-col :span="12">
                    <el-form-item label="所属机构">
                      <el-select
                        v-model="state.oss.config.organizationName"
                        filterable
                        allow-create
                        default-first-option
                        placeholder="例如：某市分公司（可下拉选择）"
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
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="所属机房">
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
                  </el-col>
                </el-row>
                <div class="wizard-card-action">
                  <el-button type="primary" :loading="state.wizard.ossTestStatus === 'testing'" @click="testWizardOssLogin">
                    保存并测试二期网管
                  </el-button>
                  <span v-if="state.wizard.ossTestMessage" :class="state.wizard.ossTestStatus === 'success' ? 'text-success' : 'text-danger'" class="action-feedback">
                    {{ state.wizard.ossTestMessage }}
                  </span>
                </div>
              </el-form>
            </el-card>
          </el-col>
        </el-row>
      </div>

      <!-- ================= 步骤 2: 勾选与配置纳管 OLT ================= -->
      <div v-else-if="state.wizard.currentStep === 2" class="wizard-step-pane">
        <div class="wizard-step-intro">
          <h3>第 2 步：选择与配置纳管 OLT 设备（本地 IP 与名称自由填写）</h3>
          <p>二期网管读取的支撑网 IP 仅作为资产与机房参考；请在此直接填写本地局域网可连通的实际管理 IP 与设备名称。您也可点击【从系统已有 OLT 载入】或【+ 添加自定义 OLT】自由调整。</p>
        </div>
        <el-card shadow="never" class="wizard-card">
          <div class="wizard-table-toolbar">
            <div class="toolbar-stats">
              已选中 <el-tag size="small" type="primary">{{ state.wizard.selectedOssOlts.length }}</el-tag> 台 OLT / 共 {{ (state.oss.olts || []).length }} 台
            </div>
            <div class="toolbar-actions">
              <el-button size="small" type="primary" plain @click="addCustomWizardOlt">+ 手动添加 OLT 设备</el-button>
              <el-button size="small" @click="loadExistingOltsIntoWizard">从系统已有 OLT 载入</el-button>
              <el-button size="small" @click="selectAllWizardOssOlts">全选</el-button>
              <el-button size="small" @click="clearAllWizardOssOlts">取消全选</el-button>
              <el-button size="small" :loading="state.oss.loginLoading" @click="testWizardOssLogin">重新读取二期</el-button>
            </div>
          </div>
          <el-table
            v-if="(state.oss.olts || []).length > 0"
            :data="state.oss.olts"
            border
            stripe
            style="width: 100%"
            max-height="460"
          >
            <el-table-column width="55" align="center">
              <template #header>选择</template>
              <template #default="{ row }">
                <el-checkbox
                  :model-value="isWizardOssOltSelected(row)"
                  @change="toggleWizardOssOlt(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="OLT 设备名称（可自定）" min-width="190">
              <template #default="{ row }">
                <el-input v-model="row.name" size="small" placeholder="如 ZTE C300 172.19.104.98" />
              </template>
            </el-table-column>
            <el-table-column label="本地属地 IP（网管二期直接读取）" min-width="170">
              <template #default="{ row }">
                <el-input v-model="row.host" size="small" placeholder="本地真实IP，如 172.19.104.98" />
              </template>
            </el-table-column>
            <el-table-column label="厂商" width="120">
              <template #default="{ row }">
                <el-select v-model="row.vendor" size="small" @change="handleWizardRowVendorChange(row)">
                  <el-option label="中兴 ZTE" value="zte" />
                  <el-option label="华为 Huawei" value="huawei" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="型号/方案" min-width="150">
              <template #default="{ row }">
                <el-select v-model="row.deviceProfile" size="small">
                  <el-option
                    v-for="profile in profilesForVendor(row.vendor)"
                    :key="profile.id"
                    :label="profile.label"
                    :value="profile.id"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="所属机房" width="120">
              <template #default="{ row }">
                <el-input v-model="row.roomName" size="small" placeholder="机房名称" />
              </template>
            </el-table-column>
            <el-table-column label="二期支撑网 IP (参考)" width="140">
              <template #default="{ row }">
                <code>{{ row.resourceIp || row.ip || '-' }}</code>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="70" align="center">
              <template #default="{ $index }">
                <el-button type="danger" link size="small" @click="removeWizardOssOltRow($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无 OLT 资产，您可点击上方【从系统已有 OLT 载入】或【+ 手动添加 OLT 设备】直接填报。" />
        </el-card>
      </div>

      <!-- ================= 步骤 3: 凭据与网络配置 ================= -->
      <div v-else-if="state.wizard.currentStep === 3" class="wizard-step-pane">
        <div class="wizard-step-intro">
          <h3>第 3 步：配置纳管 OLT 管理 IP 与访问凭据</h3>
          <p>系统已依据二期网管支撑网 IP 自动映射为管理 IP（如 22.0.6.x → 10.22.6.x）。您可以在上方快速填写统一的 SNMP Community 与 Telnet 凭据并一键应用，也可在下方针对特定设备单独微调。</p>
        </div>
        <!-- 批量填充栏 -->
        <el-card shadow="never" class="wizard-batch-card">
          <div class="batch-title">批量快速填充（快速应用至所有待纳管设备）：</div>
          <el-row :gutter="14" align="middle">
            <el-col :span="6">
              <el-input v-model="state.wizard.batchCredentials.community" placeholder="SNMP Community（如 public）">
                <template #prepend>Community</template>
              </el-input>
            </el-col>
            <el-col :span="6">
              <el-input v-model="state.wizard.batchCredentials.telnetUser" placeholder="Telnet 用户名（如 admin）">
                <template #prepend>用户名</template>
              </el-input>
            </el-col>
            <el-col :span="6">
              <el-input v-model="state.wizard.batchCredentials.telnetPassword" type="password" show-password placeholder="Telnet 密码">
                <template #prepend>密码</template>
              </el-input>
            </el-col>
            <el-col :span="6">
              <el-button type="primary" plain @click="applyWizardBatchCredentials">一键批量应用凭据</el-button>
            </el-col>
          </el-row>
        </el-card>

        <!-- 待纳管设备列表 -->
        <el-card shadow="never" class="wizard-card" style="margin-top: 14px;">
          <div class="wizard-table-toolbar">
            <div class="toolbar-stats">
              待纳管 OLT 清单（共 <strong>{{ state.wizard.oltDrafts.length }}</strong> 台）
            </div>
            <div class="toolbar-actions">
              <el-button type="success" :loading="state.wizard.savingOlts" @click="saveWizardOlts">
                保存纳管配置到系统
              </el-button>
            </div>
          </div>
          <el-table :data="state.wizard.oltDrafts" border stripe style="width: 100%" max-height="420">
            <el-table-column type="index" label="序号" width="55" align="center" />
            <el-table-column label="设备名称" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.name" size="small" placeholder="OLT 名称" />
              </template>
            </el-table-column>
            <el-table-column label="管理 IP" width="140">
              <template #default="{ row }">
                <el-input v-model="row.host" size="small" placeholder="如 10.22.6.2" />
              </template>
            </el-table-column>
            <el-table-column label="厂商" width="110">
              <template #default="{ row }">
                <el-select v-model="row.vendor" size="small" @change="handleWizardOltVendorChange(row)">
                  <el-option label="中兴 ZTE" value="zte" />
                  <el-option label="华为 Huawei" value="huawei" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="设备型号/方案" min-width="150">
              <template #default="{ row }">
                <el-select v-model="row.deviceProfile" size="small" @change="handleWizardOltProfileChange(row)">
                  <el-option
                    v-for="profile in profilesForVendor(row.vendor)"
                    :key="profile.id"
                    :label="profile.label"
                    :value="profile.id"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="Community" width="120">
              <template #default="{ row }">
                <el-input v-model="row.snmpCommunity" size="small" placeholder="public" />
              </template>
            </el-table-column>
            <el-table-column label="Telnet 账号" width="110">
              <template #default="{ row }">
                <el-input v-model="row.telnetUser" size="small" placeholder="admin" />
              </template>
            </el-table-column>
            <el-table-column label="Telnet 密码" width="120">
              <template #default="{ row }">
                <el-input v-model="row.telnetPassword" size="small" type="password" show-password placeholder="密码" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="70" align="center">
              <template #default="{ $index }">
                <el-button type="danger" link size="small" @click="removeWizardOltDraft($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>

      <!-- ================= 步骤 4: ONU 数据管理 ================= -->
      <div v-else-if="state.wizard.currentStep === 4" class="wizard-step-pane">
        <div class="wizard-step-intro">
          <h3>第 4 步：ONU 台账管理（用户数据导入导出）</h3>
          <p>系统支持通过标准 Excel 模板快速录入现场 PON 口与用户安装地址台账。若现场已有历史台账，可在此一键上传；若暂无 Excel，可点击【跳过此步】，后续通过网管数据同步自动填充。</p>
        </div>
        <!-- 隐藏的文件选择器 -->
        <input ref="wizardFileInputRef" type="file" accept=".xlsx,.xls" style="display:none;" @change="importPonPortsExcel" />

        <el-row :gutter="20">
          <el-col :span="10">
            <el-card shadow="never" class="wizard-card">
              <template #header>
                <div class="wizard-card-title">本地 ONU 台账概况</div>
              </template>
              <div class="wizard-summary-metrics">
                <div class="summary-metric-item">
                  <span>已录入 PON 口台账</span>
                  <strong>{{ (state.ponPorts || []).length }}</strong>
                  <small>条</small>
                </div>
                <div class="summary-metric-item">
                  <span>涵盖 OLT 节点</span>
                  <strong>{{ distinctOltCountInPonPorts }}</strong>
                  <small>台</small>
                </div>
              </div>
              <div style="margin-top: 16px; font-size: 13px; color: var(--muted); line-height: 1.6;">
                <p>标准字段说明：<strong>OLT IP</strong>、<strong>槽</strong>、<strong>板卡</strong>、<strong>PON</strong>、<strong>板槽端口</strong>、<strong>外层 VLAN</strong>、<strong>地址</strong>。</p>
                <p>导入时系统将对板槽端口格式进行智能预检，并支持覆盖更新已有记录。</p>
              </div>
            </el-card>
          </el-col>
          <el-col :span="14">
            <el-card shadow="never" class="wizard-card">
              <template #header>
                <div class="wizard-card-title">台账操作与数据交换</div>
              </template>
              <div class="wizard-action-grid">
                <div class="action-box">
                  <h4>1. 下载标准 Excel 模板</h4>
                  <p>获取包含规范表头与示例数据的空模板，按格式整理后导入。</p>
                  <el-button @click="downloadPonTemplateExcel">下载标准模板 (.xlsx)</el-button>
                </div>
                <div class="action-box">
                  <h4>2. 导入已有台账 Excel</h4>
                  <p>选择包含 PON 与用户地址的 Excel 文件，进行校验并合并入库。</p>
                  <el-button type="primary" @click="triggerWizardPonImport">选择文件并导入</el-button>
                </div>
                <div class="action-box">
                  <h4>3. 导出当前本地台账</h4>
                  <p>将当前系统中的全部 PON 口台账导出为 Excel 文件备份。</p>
                  <el-button @click="exportPonPortsExcel">导出当前台账 (.xlsx)</el-button>
                </div>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </div>

      <!-- ================= 步骤 5: 一二期网管数据同步 ================= -->
      <div v-else-if="state.wizard.currentStep === 5" class="wizard-step-pane">
        <div class="wizard-step-intro">
          <h3>第 5 步：一期和二期网管全量数据同步</h3>
          <p>系统将自动联动一期 BOSS 与二期 OSS：抓取历史光功率、设备投影、用户账号与历史姓名，并完成多维融合匹配。此步骤奠定全网 ONU 智能排障与数字孪生底座。</p>
        </div>
        <el-card shadow="never" class="wizard-card">
          <div class="sync-action-hero">
            <div class="hero-left">
              <h4>全量融合数据同步</h4>
              <p>同步涵盖：二期 OSS 历史光衰快照 + 一期 BOSS 存量用户资料 + 跨系统账号/LOID/SN 融合</p>
              <div v-if="state.mergedOnu.dataset.synced" class="hero-status-pill text-success">
                上次完成时间：{{ formatDate(state.mergedOnu.dataset.lastCompletedAt) || '暂无记录' }} · 共融合 {{ state.mergedOnu.dataset.snapshotCount || 0 }} 条
              </div>
            </div>
            <div class="hero-right">
              <el-button
                type="primary"
                size="large"
                :loading="state.mergedOnu.syncing || state.mergedOnu.progress.running"
                @click="syncWizardMergedOnu"
              >
                {{ state.mergedOnu.syncing || state.mergedOnu.progress.running ? '正在同步融合中...' : '开始全量融合同步' }}
              </el-button>
            </div>
          </div>

          <!-- 实时同步进度展示 -->
          <div v-if="state.mergedOnu.progress.running || state.mergedOnu.syncing" class="sync-progress-area" style="margin-top: 20px;">
            <div class="progress-header">
              <span>当前阶段：<strong>{{ mergedOnuSyncPhaseText(state.mergedOnu.progress.phase) }}</strong></span>
              <span>{{ mergedOnuSyncPercent(state.mergedOnu.progress) }}%</span>
            </div>
            <el-progress
              :percentage="mergedOnuSyncPercent(state.mergedOnu.progress)"
              :status="state.mergedOnu.progress.status === 'error' ? 'exception' : 'success'"
              :stroke-width="14"
            />
            <el-row :gutter="14" style="margin-top: 14px;">
              <el-col :span="6">
                <div class="progress-sub-stat">
                  <small>二期 OSS 条数</small>
                  <strong>{{ state.mergedOnu.progress.networkRows || 0 }}</strong>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="progress-sub-stat">
                  <small>一期 BOSS 分页</small>
                  <strong>{{ state.mergedOnu.progress.nmseCompletedPages || 0 }} / {{ state.mergedOnu.progress.nmsePages || 0 }}</strong>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="progress-sub-stat">
                  <small>已融合条数</small>
                  <strong>{{ state.mergedOnu.progress.mergedRows || 0 }}</strong>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="progress-sub-stat">
                  <small>冲突条数</small>
                  <strong>{{ state.mergedOnu.progress.conflicts || 0 }}</strong>
                </div>
              </el-col>
            </el-row>
          </div>
          <div v-else-if="state.mergedOnu.dataset.synced" style="margin-top: 16px;">
            <el-alert type="success" :closable="false" show-icon title="网管数据已就绪，可直接进入下一步同步外层 VLAN。">
              <template #default>
                融合数据共收录 {{ state.mergedOnu.dataset.snapshotCount || 0 }} 条记录，版本修订号：{{ state.mergedOnu.dataset.revision }}。
              </template>
            </el-alert>
          </div>
        </el-card>
      </div>

      <!-- ================= 步骤 6: 同步外层 VLAN ================= -->
      <div v-else-if="state.wizard.currentStep === 6" class="wizard-step-pane">
        <div class="wizard-step-intro">
          <h3>第 6 步：同步外层 VLAN (SVLAN)</h3>
          <p>一二期网管数据就绪后，系统可自动向各台纳管 OLT 拉取下属所有 PON 口的外层业务 SVLAN，并更新写入本地台账数据库。</p>
        </div>
        <el-card shadow="never" class="wizard-card">
          <div class="wizard-table-toolbar">
            <div class="toolbar-stats">
              <span>已纳管 <strong>{{ state.olts.length }}</strong> 台 OLT 设备</span>
              <span v-if="state.wizard.vlanSummary" class="text-success" style="margin-left: 12px;">{{ state.wizard.vlanSummary }}</span>
            </div>
            <div class="toolbar-actions">
              <el-button type="primary" :loading="state.wizard.vlanSyncing" @click="syncWizardAllVlans">
                一键同步所有 OLT 外层 VLAN
              </el-button>
            </div>
          </div>

          <el-table
            v-if="state.wizard.vlanResults.length > 0"
            :data="state.wizard.vlanResults"
            border
            stripe
            style="width: 100%"
          >
            <el-table-column prop="oltName" label="OLT 名称" min-width="160" />
            <el-table-column prop="host" label="管理 IP" width="140" />
            <el-table-column label="同步结果" width="110" align="center">
              <template #default="{ row }">
                <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                  {{ row.success ? '同步成功' : '失败' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="count" label="PON 口数" width="100" align="center" />
            <el-table-column prop="message" label="明细状态" min-width="200" />
            <el-table-column label="操作" width="100" align="center">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="syncWizardSingleOltVlan(row.oltId)">重新同步</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="vlan-empty-guide" style="padding: 28px 0; text-align: center; color: var(--muted);">
            <p>点击上方【一键同步所有 OLT 外层 VLAN】按钮，系统将自动依次遍历各台 OLT 并完成落库。</p>
          </div>
        </el-card>
      </div>

      <!-- ================= 步骤 7: 智能能力集中配置 ================= -->
      <div v-else-if="state.wizard.currentStep === 7" class="wizard-step-pane">
        <div class="wizard-step-intro">
          <h3>第 7 步：智能能力集中配置（飞书/AI/AnySearch）</h3>
          <p>配置飞书运维机器人、Pi Agent 大模型、JEV 意图路由引擎以及 AnySearch 智能外网搜索。配置完成后，一线工程师可通过群聊和桌面端直接使用智能问答与自主排障。</p>
        </div>
        <el-row :gutter="14">
          <!-- 飞书机器人 -->
          <el-col :span="12">
            <el-card shadow="never" class="wizard-card">
              <template #header>
                <div class="wizard-card-title">
                  <span>1. 飞书智能运维机器人</span>
                  <el-tag :type="state.feishu.connection.state === 'connected' ? 'success' : 'info'" size="small">
                    {{ state.feishu.connection.state === 'connected' ? '长连接已通' : '未连接' }}
                  </el-tag>
                </div>
              </template>
              <el-form label-position="top">
                <el-form-item label="飞书 App ID">
                  <el-input v-model="state.feishu.appId" placeholder="cli_..." />
                </el-form-item>
                <el-form-item label="飞书 App Secret">
                  <el-input v-model="state.feishu.appSecret" type="password" show-password placeholder="请输入 App Secret" />
                </el-form-item>
              </el-form>
            </el-card>
          </el-col>

          <!-- AnySearch 智能外网搜索 -->
          <el-col :span="12">
            <el-card shadow="never" class="wizard-card">
              <template #header>
                <div class="wizard-card-title">
                  <span>2. AnySearch 智能外网搜索</span>
                  <el-tag :type="state.anysearch.apiKey ? 'success' : 'info'" size="small">
                    {{ state.anysearch.apiKey ? 'Key 已填' : '未配置' }}
                  </el-tag>
                </div>
              </template>
              <el-form label-position="top">
                <el-form-item label="AnySearch API Key">
                  <el-input v-model="state.anysearch.apiKey" show-password placeholder="as_sk_..." />
                  <small class="field-hint">用于全网故障知识、外网协议与技术文档智能检索增强</small>
                </el-form-item>
              </el-form>
            </el-card>
          </el-col>
        </el-row>

        <el-row :gutter="14" style="margin-top: 14px;">
          <!-- Pi Agent 大模型 -->
          <el-col :span="12">
            <el-card shadow="never" class="wizard-card">
              <template #header>
                <div class="wizard-card-title">
                  <span>3. Pi Agent 自主决策模型</span>
                </div>
              </template>
              <el-form label-position="top">
                <el-form-item label="模型服务商 / Provider">
                  <el-input v-model="state.feishu.piAgentLanguageProviderName" placeholder="如 OpenAI / DeepSeek / 本地 Ollama" />
                </el-form-item>
                <el-form-item label="API Endpoint">
                  <el-input v-model="state.feishu.piAgentLanguageEndpoint" placeholder="https://api.openai.com/v1" />
                </el-form-item>
                <el-row :gutter="12">
                  <el-col :span="12">
                    <el-form-item label="模型名称 (Model)">
                      <el-input v-model="state.feishu.piAgentLanguageModel" placeholder="gpt-4o / deepseek-chat" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="API Key">
                      <el-input v-model="state.feishu.piAgentLanguageApiKey" type="password" show-password placeholder="sk-..." />
                    </el-form-item>
                  </el-col>
                </el-row>
              </el-form>
            </el-card>
          </el-col>

          <!-- JEV 意图路由引擎 -->
          <el-col :span="12">
            <el-card shadow="never" class="wizard-card">
              <template #header>
                <div class="wizard-card-title">
                  <span>4. JEV 意图识别与路由模型</span>
                </div>
              </template>
              <el-form label-position="top">
                <el-form-item label="模型服务商 / Provider">
                  <el-input v-model="state.feishu.languageProviderName" placeholder="如 OpenAI / SiliconFlow" />
                </el-form-item>
                <el-form-item label="API Endpoint">
                  <el-input v-model="state.feishu.languageEndpoint" placeholder="https://api.openai.com/v1" />
                </el-form-item>
                <el-row :gutter="12">
                  <el-col :span="12">
                    <el-form-item label="模型名称 (Model)">
                      <el-input v-model="state.feishu.languageModel" placeholder="gpt-4o-mini / deepseek-v3" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="API Key">
                      <el-input v-model="state.feishu.languageApiKey" type="password" show-password placeholder="sk-..." />
                    </el-form-item>
                  </el-col>
                </el-row>
              </el-form>
            </el-card>
          </el-col>
        </el-row>

        <div class="ai-save-panel" style="margin-top: 16px; text-align: center;">
          <el-button type="primary" size="large" :loading="state.wizard.savingAiConfig" @click="saveWizardAllAiConfig">
            一键保存并生效所有智能能力配置
          </el-button>
          <p v-if="state.wizard.aiTestMessage" :class="state.wizard.aiTestStatus === 'success' ? 'text-success' : 'text-danger'" style="margin-top: 8px;">
            {{ state.wizard.aiTestMessage }}
          </p>
        </div>

        <!-- 完成总览卡片 -->
        <el-card v-if="isSystemConfigured" shadow="never" class="wizard-success-card" style="margin-top: 20px;">
          <div class="success-card-content">
            <div class="success-icon">🎉</div>
            <div class="success-text">
              <h3>系统全流程初始化配置已完成！</h3>
              <p>OLT Manager 现已具备纳管 OLT 只读监控、双网管数据融合、光功率排障、飞书机器人与 AI 智能决策全部能力。</p>
              <el-button type="success" size="large" @click="setView('dashboard')">
                完成配置并进入系统运维概览
              </el-button>
            </div>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 向导底部常驻操作栏 -->
    <div class="wizard-footer-bar">
      <div class="footer-left">
        <el-button v-if="state.wizard.currentStep > 1" @click="wizardPrevStep">
          上一步
        </el-button>
      </div>
      <div class="footer-right">
        <el-button
          v-if="state.wizard.currentStep < 7"
          plain
          @click="wizardSkipStep"
        >
          跳过此步
        </el-button>
        <el-button
          v-if="state.wizard.currentStep < 7"
          type="primary"
          @click="wizardNextStep"
        >
          下一步
        </el-button>
        <el-button
          v-else
          type="success"
          @click="completeWizard"
        >
          完成向导
        </el-button>
      </div>
    </div>
  </section>
</template>

<script>
import { computed, ref } from "vue";
import { downloadBlob } from "../renderer-services.js";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { buildOltsFromOssSelection, validateOltListCredentials } from "../setup-wizard.mjs";
import { loadXlsx } from "../xlsx-runtime.mjs";
import { useAppContext } from "../app-context.js";

// 系统配置向导。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "SetupWizardView",
  setup() {
    const ctx = useAppContext();
    const { enrichOssOltsWithExisting, fetchPonPorts, getOssOltRowKey, handleAdminProfileChange, handleAdminVendorChange, loginOssResource, normalizeAdminOltRow, oltAdminApi, ponPortFilterState, resourceManagementApi, saveAnySearchConfig, saveFeishuCredentials, saveLanguageProvider, savePiAgentLanguage, saveResourceManagementConfig, setView, state, syncMergedOnuOperation } = ctx;

    const wizardFileInputRef = ref(null);

    const distinctOltCountInPonPorts = computed(() => {
      const hosts = new Set((state.ponPorts || []).map((p) => p.host || p.oltIp).filter(Boolean));
      return hosts.size;
    });

    function addCustomWizardOlt() {
      const nextIndex = (state.oss.olts?.length || 0) + 1;
      const newOlt = {
        id: `custom-olt-${Date.now().toString(36)}`,
        name: `新 OLT 设备 ${nextIndex}`,
        host: "172.19.104.",
        vendor: "zte",
        deviceProfile: "zte-c300",
        roomName: state.oss.config.roomName || "本地机房",
        resourceIp: ""
      };
      if (!Array.isArray(state.oss.olts)) state.oss.olts = [];
      state.oss.olts.push(newOlt);
      state.wizard.selectedOssOlts.push(getOssOltRowKey(newOlt));
      ElMessage.success("已添加一行自定义 OLT，请在表格中填写本地管理 IP 和名称");
    }

    function removeWizardOssOltRow(index) {
      if (!Array.isArray(state.oss.olts)) return;
      const removed = state.oss.olts.splice(index, 1)[0];
      if (removed) {
        const key = getOssOltRowKey(removed);
        const idx = state.wizard.selectedOssOlts.indexOf(key);
        if (idx >= 0) state.wizard.selectedOssOlts.splice(idx, 1);
      }
    }

    function handleWizardRowVendorChange(row) {
      handleAdminVendorChange(row);
    }

    function wizardNextStep() {
      try {
        if (state.wizard.currentStep === 1) {
          const resourceLoggedIn = Boolean(state.resource?.loggedIn);
          const ossLoggedIn = Boolean(state.oss?.loggedIn);
          if (!resourceLoggedIn && !ossLoggedIn) {
            const hasExisting = (state.adminOlts && state.adminOlts.length > 0) || (state.olts && state.olts.length > 0);
            if (hasExisting) {
              ElMessage.info("网管尚未登录，已为您转至设备选择步骤（可使用系统已有设备或手动录入）");
            } else {
              ElMessage.info("网管尚未登录，已为您转至设备选择步骤（支持手动录入待纳管设备）");
            }
          }
        } else if (state.wizard.currentStep === 2) {
          syncWizardOltDraftsFromSelection();
          const selected = state.wizard?.selectedOssOlts || [];
          const drafts = state.wizard?.oltDrafts || [];
          const adminOlts = state.adminOlts || [];
          if (selected.length === 0 && drafts.length === 0 && adminOlts.length === 0) {
            ElMessage.warning("请至少选择或添加 1 台待纳管 OLT 设备");
            return;
          }
        } else if (state.wizard.currentStep === 5) {
          const datasetSynced = Boolean(state.mergedOnu?.dataset?.synced);
          const networkSynced = Boolean(state.mergedOnu?.sources?.network?.synced);
          const nmseSynced = Boolean(state.mergedOnu?.sources?.nmse?.synced);
          if (!datasetSynced && !networkSynced && !nmseSynced) {
            ElMessage.info("网管数据尚未同步，您可以稍后在控制台同步，已为您进入下一步");
          }
        }
        if (state.wizard.currentStep < 7) {
          state.wizard.currentStep += 1;
        }
      } catch (err) {
        console.error("[wizard] 切换至下一步异常:", err);
        ElMessage.error(err.message || "切换步骤失败");
      }
    }

    function wizardPrevStep() {
      if (state.wizard.currentStep > 1) {
        state.wizard.currentStep -= 1;
      }
    }

    function wizardSkipStep() {
      if (state.wizard.currentStep < 7) {
        state.wizard.currentStep += 1;
      }
    }

    function completeWizard() {
      state.wizard.completed = true;
      try {
        localStorage.setItem("olt_wizard_completed", "true");
      } catch (_) {}
      ElMessage.success("恭喜！系统配置向导已顺利完成。");
      setView("dashboard");
    }

    function wizardGoToStep(step) {
      if (step >= 1 && step <= 7) {
        if (state.wizard.currentStep === 2 && step === 3) {
          syncWizardOltDraftsFromSelection();
        }
        state.wizard.currentStep = step;
      }
    }

    async function testWizardResourceLogin() {
      state.wizard.resourceTestStatus = "testing";
      state.wizard.resourceTestMessage = "正在保存并测试登录一期网管...";
      try {
        await saveResourceManagementConfig();
        const data = await resourceManagementApi.login({ password: state.resource.config.password });
        state.resource.loggedIn = true;
        state.wizard.resourceTestStatus = "success";
        state.wizard.resourceTestMessage = `一期网管连接成功，发现 ${data.oltCount || 0} 台 OLT`;
        ElMessage.success(state.wizard.resourceTestMessage);
      } catch (error) {
        state.resource.loggedIn = false;
        state.wizard.resourceTestStatus = "error";
        state.wizard.resourceTestMessage = error.message || "一期网管登录失败";
        ElMessage.error(state.wizard.resourceTestMessage);
      }
    }

    async function testWizardOssLogin() {
      state.wizard.ossTestStatus = "testing";
      state.wizard.ossTestMessage = "正在保存并测试登录二期网管...";
      try {
        await loginOssResource({ autoLogin: false, quiet: true });
        if (state.oss.loggedIn) {
          state.wizard.ossTestStatus = "success";
          state.wizard.ossTestMessage = `二期网管登录成功，发现 ${state.oss.olts?.length || 0} 台 OLT`;
          state.oss.olts = enrichOssOltsWithExisting(state.oss.olts);
          state.wizard.selectedOssOlts = state.oss.olts.map(getOssOltRowKey);
          ElMessage.success(state.wizard.ossTestMessage);
        } else {
          throw new Error("二期网管登录未完成");
        }
      } catch (error) {
        state.wizard.ossTestStatus = "error";
        state.wizard.ossTestMessage = error.message || "二期网管登录失败";
        ElMessage.error(state.wizard.ossTestMessage);
      }
    }

    function isWizardOssOltSelected(olt) {
      const key = getOssOltRowKey(olt);
      return state.wizard.selectedOssOlts.includes(key);
    }

    function toggleWizardOssOlt(olt) {
      const key = getOssOltRowKey(olt);
      const idx = state.wizard.selectedOssOlts.indexOf(key);
      if (idx >= 0) {
        state.wizard.selectedOssOlts.splice(idx, 1);
      } else {
        state.wizard.selectedOssOlts.push(key);
      }
    }

    function selectAllWizardOssOlts() {
      state.wizard.selectedOssOlts = (state.oss.olts || []).map(getOssOltRowKey);
    }

    function clearAllWizardOssOlts() {
      state.wizard.selectedOssOlts = [];
    }

    function syncWizardOltDraftsFromSelection() {
      const merged = buildOltsFromOssSelection({
        selectedOssOlts: state.wizard.selectedOssOlts,
        ossOlts: state.oss.olts || [],
        existingOlts: state.adminOlts.length > 0 ? state.adminOlts : state.olts,
        batchCredentials: state.wizard.batchCredentials
      });
      state.wizard.oltDrafts = merged.map(normalizeAdminOltRow);
    }

    function applyWizardBatchCredentials() {
      const { community, telnetUser, telnetPassword } = state.wizard.batchCredentials;
      for (const draft of state.wizard.oltDrafts) {
        if (community) draft.snmpCommunity = community;
        if (telnetUser) draft.telnetUser = telnetUser;
        if (telnetPassword) draft.telnetPassword = telnetPassword;
      }
      ElMessage.success(`已批量应用凭据到 ${state.wizard.oltDrafts.length} 台设备`);
    }

    function handleWizardOltVendorChange(row) {
      handleAdminVendorChange(row);
    }

    function handleWizardOltProfileChange(row) {
      handleAdminProfileChange(row);
    }

    function removeWizardOltDraft(index) {
      state.wizard.oltDrafts.splice(index, 1);
    }

    async function saveWizardOlts() {
      const validation = validateOltListCredentials(state.wizard.oltDrafts);
      if (!validation.valid) {
        ElMessage.warning(validation.errors?.[0] || validation.error || "请补全 OLT 必填信息");
        return false;
      }
      state.wizard.savingOlts = true;
      try {
        const data = await oltAdminApi.save(state.wizard.oltDrafts.map(normalizeAdminOltRow));
        state.olts = data.olts;
        state.adminOlts = (data.adminOlts || data.olts).map(normalizeAdminOltRow);
        if (!state.olts.some((olt) => olt.id === state.selectedOltId)) {
          state.selectedOltId = state.olts[0]?.id || "";
        }
        ElMessage.success(`已成功纳管 ${state.olts.length} 台 OLT 设备！`);
        return true;
      } catch (error) {
        ElMessage.error(error.message || "保存 OLT 纳管失败");
        return false;
      } finally {
        state.wizard.savingOlts = false;
      }
    }

    function triggerWizardPonImport() {
      if (wizardFileInputRef.value) {
        wizardFileInputRef.value.click();
      }
    }

    async function downloadPonTemplateExcel() {
      try {
        const XLSX = await loadXlsx();
        const sampleRows = [
          {
            "OLT IP": state.olts[0]?.host || "10.22.4.2",
            "槽": "1",
            "板卡": "1",
            "PON": "1",
            "板槽端口": "1/1/1",
            "外层 VLAN": "1001",
            "地址": "示例某小区1号楼1单元"
          }
        ];
        const worksheet = XLSX.utils.json_to_sheet(sampleRows, {
          header: ["OLT IP", "槽", "板卡", "PON", "板槽端口", "外层 VLAN", "地址"]
        });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "PON台账导入模板");
        const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
        downloadBlob(blob, "onu-ledger-template.xlsx");
        ElMessage.success("已下载标准台账模板");
      } catch (error) {
        ElMessage.error(error.message || "下载模板失败");
      }
    }

    async function syncWizardMergedOnu() {
      try {
        await syncMergedOnuOperation("full");
      } catch (error) {
        ElMessage.error(error.message || "触发数据同步失败");
      }
    }

    async function syncWizardAllVlans() {
      if (state.olts.length === 0) {
        ElMessage.warning("尚未纳管任何 OLT，请先在步骤 3 中保存纳管设备");
        return;
      }
      state.wizard.vlanSyncing = true;
      state.wizard.vlanResults = [];
      const results = [];
      try {
        for (const olt of state.olts) {
          try {
            const data = await resourceManagementApi.syncVlans(olt.id);
            results.push({
              oltId: olt.id,
              oltName: olt.name,
              host: olt.host,
              success: true,
              count: data.count || 0,
              message: `已同步 ${data.count || 0} 个 PON 口外层 VLAN`
            });
          } catch (err) {
            results.push({
              oltId: olt.id,
              oltName: olt.name,
              host: olt.host,
              success: false,
              count: 0,
              message: err.message || "同步失败"
            });
          }
        }
        state.wizard.vlanResults = results;
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        const totalCount = results.reduce((sum, r) => sum + (r.count || 0), 0);
        state.wizard.vlanSummary = `完成 ${results.length} 台 OLT 的外层 VLAN 同步，累计更新 ${totalCount} 个 PON 口`;
        ElMessage.success(state.wizard.vlanSummary);
      } catch (error) {
        ElMessage.error(error.message || "批量同步 VLAN 失败");
      } finally {
        state.wizard.vlanSyncing = false;
      }
    }

    async function syncWizardSingleOltVlan(oltId) {
      try {
        const data = await resourceManagementApi.syncVlans(oltId);
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        const target = state.wizard.vlanResults.find((r) => r.oltId === oltId);
        if (target) {
          target.success = true;
          target.count = data.count || 0;
          target.message = `已重新同步 ${data.count || 0} 个 PON 口外层 VLAN`;
        }
        ElMessage.success(`OLT 外层 VLAN 同步成功，共 ${data.count || 0} 个 PON 口`);
      } catch (error) {
        ElMessage.error(error.message || "单台 OLT VLAN 同步失败");
      }
    }

    async function saveWizardAllAiConfig() {
      state.wizard.savingAiConfig = true;
      state.wizard.aiTestStatus = "testing";
      state.wizard.aiTestMessage = "正在保存并生效智能能力配置...";
      try {
        if (!window.oltManagerDesktop?.feishu) {
          const payload = {
            feishuAppId: state.feishu.appId,
            feishuAppSecret: state.feishu.appSecret,
            anysearchApiKey: state.anysearch.apiKey,
            piProviderName: state.feishu.piAgentLanguageProviderName,
            piEndpoint: state.feishu.piAgentLanguageEndpoint,
            piModel: state.feishu.piAgentLanguageModel,
            piApiKey: state.feishu.piAgentLanguageApiKey,
            jevProviderName: state.feishu.languageProviderName,
            jevEndpoint: state.feishu.languageEndpoint,
            jevModel: state.feishu.languageModel,
            jevApiKey: state.feishu.languageApiKey
          };
          const res = await fetch("/api/admin/bot-ai/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!data || !data.ok) throw new Error(data?.error || "保存失败");
        } else {
          if (state.feishu.appId && state.feishu.appSecret) {
            await saveFeishuCredentials();
          }
          if (state.feishu.languageApiKey || state.feishu.languageEndpoint) {
            await saveLanguageProvider();
          }
          if (state.feishu.piAgentLanguageApiKey || state.feishu.piAgentLanguageEndpoint) {
            await savePiAgentLanguage();
          }
          if (state.anysearch.apiKey) {
            await saveAnySearchConfig();
          }
        }
        state.wizard.aiTestStatus = "success";
        state.wizard.aiTestMessage = "所有智能能力配置已成功保存并立即生效！";
        ElMessage.success(state.wizard.aiTestMessage);
      } catch (error) {
        state.wizard.aiTestStatus = "error";
        state.wizard.aiTestMessage = error.message || "智能能力配置保存失败";
        ElMessage.error(state.wizard.aiTestMessage);
      } finally {
        state.wizard.savingAiConfig = false;
      }
    }

    return { ...ctx, wizardFileInputRef, distinctOltCountInPonPorts, addCustomWizardOlt, removeWizardOssOltRow, handleWizardRowVendorChange, wizardNextStep, wizardPrevStep, wizardSkipStep, completeWizard, wizardGoToStep, testWizardResourceLogin, testWizardOssLogin, isWizardOssOltSelected, toggleWizardOssOlt, selectAllWizardOssOlts, clearAllWizardOssOlts, applyWizardBatchCredentials, handleWizardOltVendorChange, handleWizardOltProfileChange, removeWizardOltDraft, saveWizardOlts, triggerWizardPonImport, downloadPonTemplateExcel, syncWizardMergedOnu, syncWizardAllVlans, syncWizardSingleOltVlan, saveWizardAllAiConfig };
  }
};
</script>
