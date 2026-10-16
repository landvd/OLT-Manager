<template>
  <section>
    <div class="page-head">
      <div>
        <h1>定额预算</h1>
        <p>人工按定额库、材料按单价参考表，常用项点一下就能加；生成的预算书按模板格式填数据，可直接交规建部门审核。飞书“定额模式”录入的预算也在这里。</p>
      </div>
      <div class="page-head-actions quota-page-actions">
        <el-button @click="openResources">模板与单价</el-button>
        <el-button type="primary" :disabled="!page.status?.template" @click="openCreate"><el-icon class="inline-icon"><Plus /></el-icon>新建预算</el-button>
      </div>
    </div>

    <el-alert v-if="page.loaded && !page.status?.template" type="warning" :closable="false" show-icon class="quota-alert"
      title="还没有导入预算书模板：请点“模板与单价”，导入用 WPS / Excel 另存为 .xlsx 的预算书编制程序。" />
    <el-alert v-else-if="page.loaded && !page.status?.materials" type="info" :closable="false" show-icon class="quota-alert"
      title="还没有导入材料单价参考表，暂时不能录入材料。" />

    <div class="quota-layout">
      <el-card shadow="never" class="content-card quota-list-card">
        <el-input v-model="page.q" size="small" clearable placeholder="搜索项目名称或地点" @keyup.enter="loadBudgets" @clear="loadBudgets" />
        <el-table v-loading="page.loading" :data="page.budgets" size="small" highlight-current-row class="quota-budget-table"
          empty-text="还没有预算" @row-click="openBudget">
          <el-table-column label="项目" min-width="150">
            <template #default="{ row }">
              <div class="quota-budget-name">{{ row.name }}</div>
              <div class="muted">{{ row.location }} · {{ formatDate(row.updatedAt) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="条数" width="70">
            <template #default="{ row }">{{ row.quotaCount }} / {{ row.materialCount }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <div class="quota-detail">
        <!-- 没选预算：概览 -->
        <template v-if="!view">
          <el-card shadow="never" class="content-card quota-section">
            <div class="quota-section-head">
              <h3>概览</h3>
              <span class="muted">点左边的预算打开；人工 + 监理费 + 安全生产费（含税）超过 {{ money(overview.oaThreshold, 0) }} 要上 OA 系统</span>
            </div>
            <div class="quota-stat-row">
              <div class="quota-stat"><span class="muted">预算</span><strong>{{ overview.budgetCount }}</strong><span class="muted">份</span></div>
              <div class="quota-stat"><span class="muted">本月编制</span><strong>{{ overview.monthCount }}</strong><span class="muted">份</span></div>
              <div class="quota-stat"><span class="muted">飞书录入</span><strong>{{ overview.feishuCount }}</strong><span class="muted">份</span></div>
              <div class="quota-stat" :class="{ danger: overview.oaCount }"><span class="muted">最近要上 OA</span><strong>{{ overview.oaCount }}</strong><span class="muted">份</span></div>
            </div>
          </el-card>

          <el-card v-if="overview.recent.length" shadow="never" class="content-card quota-section">
            <div class="quota-section-head"><h3>最近的预算</h3><el-button type="primary" :disabled="!page.status?.template" @click="openCreate"><el-icon class="inline-icon"><Plus /></el-icon>新建预算</el-button></div>
            <div class="quota-recent-grid">
              <button v-for="budget in overview.recent" :key="budget.id" type="button" class="quota-recent" :class="{ danger: budget.needsOa }" @click="openBudget(budget)">
                <div class="quota-recent-title">
                  <strong>{{ budget.name }}</strong>
                  <el-tag v-if="budget.needsOa" size="small" type="danger">需上 OA</el-tag>
                  <el-tag v-else size="small" :type="budget.createdBy === 'desktop' ? 'info' : 'success'">{{ budget.createdBy === "desktop" ? "桌面" : "飞书" }}</el-tag>
                </div>
                <div class="muted">{{ budget.location }} · {{ budget.regionClass }} · {{ formatDate(budget.updatedAt) }}</div>
                <div class="quota-recent-money">
                  <span>人工 {{ money(budget.table2TaxedAmount) }}</span>
                  <span>材料 {{ money(budget.table4TaxedAmount) }}</span>
                  <span>监理 {{ money(budget.supervisionTaxedAmount) }}</span>
                  <span>安全 {{ money(budget.safetyTaxedAmount) }}</span>
                </div>
                <div class="quota-recent-total">合计（含税）<strong>{{ money(budget.taxedTotal) }}</strong><span class="muted"> · 人工 {{ budget.quotaCount }} 项 · 材料 {{ budget.materialCount }} 项</span></div>
              </button>
            </div>
          </el-card>

          <el-card shadow="never" class="content-card quota-section">
            <div class="quota-section-head"><h3>{{ overview.budgetCount ? "怎么编一份预算" : "还没有预算，从这里开始" }}</h3></div>
            <div class="quota-steps">
              <div><strong>1. 新建预算</strong><span class="muted">选基础信息模板，填项目名称、建设地点、编制人、审核</span></div>
              <div><strong>2. 点常用人工、材料</strong><span class="muted">端开缆、架空 / 管道光缆敷设、光缆接续，光缆、接头盒、分路器……点一下填数量</span></div>
              <div><strong>3. 生成预算书</strong><span class="muted">按模板格式插行填数据，交规建部门审核；人工 + 监理 + 安全生产费超 3000 记得上 OA</span></div>
            </div>
            <div class="quota-resource-line muted">
              <span>模板：{{ page.status?.template ? `${page.status.template.fileName}（定额 ${page.status.template.itemCount} 条）` : "还没有导入" }}</span>
              <span>单价表：{{ page.status?.materials ? `${page.status.materials.fileName}（物料 ${page.status.materials.materialCount} 条）` : "还没有导入" }}</span>
              <el-button link type="primary" @click="openResources">模板与单价</el-button>
            </div>
            <el-button v-if="!overview.budgetCount" type="primary" size="large" :disabled="!page.status?.template" @click="openCreate"><el-icon class="inline-icon"><Plus /></el-icon>新建第一份预算</el-button>
          </el-card>
        </template>
        <template v-else>
          <!-- 预算概况 -->
          <el-card shadow="never" class="content-card quota-section">
            <div class="quota-title-row">
              <div>
                <h2>{{ view.budget.name }}</h2>
                <div class="muted">{{ view.budget.info.location }} · {{ view.budget.info.regionClass }} · 编制 {{ view.budget.info.preparer }} / 审核 {{ view.budget.info.reviewer }} · {{ view.budget.info.preparedDate }} ·
                  {{ view.budget.createdBy === "desktop" ? "桌面新建" : `飞书新建（${view.budget.createdByName || "外勤"}）` }}</div>
              </div>
              <div class="quota-head-actions">
                <el-button type="primary" :loading="page.exporting" @click="exportBudget"><el-icon class="inline-icon"><Download /></el-icon>生成预算书</el-button>
                <el-button @click="page.showInfo = !page.showInfo">{{ page.showInfo ? "收起基础信息" : "基础信息" }}</el-button>
                <el-button @click="saveAsPreset">另存为基础信息模板</el-button>
                <el-button type="danger" plain @click="removeBudget">删除预算</el-button>
                <el-button @click="closeBudget">返回概览</el-button>
              </div>
            </div>
            <div class="quota-totals">
              <div><span class="muted">人工</span><strong>{{ money(view.totals.table2Amount) }}</strong><span class="muted">含税 {{ money(view.totals.table2TaxedAmount) }}</span></div>
              <div><span class="muted">材料</span><strong>{{ money(view.totals.table4Amount) }}</strong><span class="muted">含税 {{ money(view.totals.table4TaxedAmount) }}</span></div>
              <div><span class="muted">监理费</span><strong>{{ money(view.totals.supervisionAmount) }}</strong><span class="muted">含税 {{ money(view.totals.supervisionTaxedAmount) }}</span></div>
              <div><span class="muted">安全生产费</span><strong>{{ money(view.totals.safetyAmount) }}</strong><span class="muted">含税 {{ money(view.totals.safetyTaxedAmount) }}</span></div>
              <div><span class="muted">合计（含税）</span><strong>{{ money(view.totals.taxedTotal) }}</strong>
                <span :class="view.totals.needsOa ? 'quota-oa-over' : 'muted'">人工 + 监理 + 安全 {{ money(view.totals.oaAmount) }} / {{ money(view.totals.oaThreshold, 0) }}</span></div>
            </div>
            <el-alert v-if="view.oaNotice" :title="view.oaNotice" type="error" :closable="false" show-icon class="quota-alert" />
            <el-alert v-for="warning in view.warnings" :key="warning" :title="warning" type="warning" :closable="false" show-icon class="quota-alert">
              <template v-if="view.priceChanges.length && warning.includes('单价')">
                <el-button size="small" @click="refreshPrices">按最新单价刷新</el-button>
              </template>
            </el-alert>
          </el-card>

          <!-- 基础信息（点“基础信息”展开） -->
          <el-card v-if="page.showInfo" shadow="never" class="content-card quota-section">
            <div class="quota-section-head"><h3>基础信息</h3><span class="muted">改地区类别后人工会按新类别重新取单价</span></div>
            <el-form label-width="150px" class="quota-info-grid">
              <el-form-item v-for="field in infoFields" :key="field.key" :label="field.label" :required="field.required">
                <el-select v-if="field.key === 'regionClass'" v-model="infoForm[field.key]">
                  <el-option v-for="region in regionClasses" :key="region" :label="region" :value="region" />
                </el-select>
                <el-select v-else-if="field.key === 'surveyByNational'" v-model="infoForm[field.key]">
                  <el-option label="是" value="是" /><el-option label="否" value="否" />
                </el-select>
                <el-autocomplete v-else-if="field.key === 'constructionUnit'" v-model="infoForm[field.key]" :fetch-suggestions="suggestUnits" class="quota-info-input" />
                <el-autocomplete v-else-if="field.key === 'preparer' || field.key === 'reviewer'" v-model="infoForm[field.key]" :fetch-suggestions="(q, cb) => suggestNames(field.key, q, cb)" class="quota-info-input" />
                <template v-else-if="field.type === 'rate'">
                  <el-input-number v-model="infoForm[field.key]" :min="0" :max="99.99" :precision="2" controls-position="right" /><span class="muted quota-unit">%</span>
                </template>
                <el-date-picker v-else-if="field.type === 'date'" v-model="infoForm[field.key]" type="date" value-format="YYYY-MM-DD" :clearable="false" />
                <el-input v-else v-model="infoForm[field.key]" :disabled="field.readOnly" :placeholder="field.readOnly ? '由规建部门填写' : ''" class="quota-info-input" />
              </el-form-item>
            </el-form>
            <div class="quota-add-row"><el-button type="primary" :loading="page.savingInfo" @click="saveInfo">保存基础信息</el-button></div>
          </el-card>

          <!-- 人工 -->
          <el-card shadow="never" class="content-card quota-section">
            <div class="quota-section-head">
              <h3>人工 <span class="muted quota-subtotal">{{ money(view.totals.table2Amount) }}（含税 {{ money(view.totals.table2TaxedAmount) }}）</span></h3>
              <el-button type="primary" plain @click="openQuotaDialog()"><el-icon class="inline-icon"><Plus /></el-icon>更多人工</el-button>
            </div>
            <div class="quota-pick-row">
              <span class="muted quota-pick-label">常用</span>
              <el-button v-for="group in commonQuotaGroups" :key="group.name" class="quota-pick" @click="openQuotaDialog({ group })">
                <el-icon class="inline-icon"><Plus /></el-icon>{{ group.name }}
              </el-button>
              <el-button text type="primary" @click="page.showPipe = !page.showPipe">{{ page.showPipe ? "收起管道计算器" : "管道开挖 / 顶管 / 做井" }}</el-button>
            </div>
            <el-table :data="view.table2" empty-text="还没有人工，点上面的常用项或“更多人工”添加" class="quota-table">
              <el-table-column type="index" label="#" width="42" />
              <el-table-column label="项目" min-width="200">
                <template #default="{ row }">
                  <div>{{ row.name }}<span v-if="row.detail" class="muted"> {{ row.detail }}</span></div>
                  <div class="muted quota-code">{{ row.code }}</div>
                </template>
              </el-table-column>
              <el-table-column label="数量" width="120" align="right">
                <template #default="{ row }">
                  <div>{{ round(row.quantity, 3) }} {{ row.unit }}</div>
                  <div v-if="row.unit === '千米'" class="muted">{{ round(row.quantity * 1000, 1) }} 米</div>
                </template>
              </el-table-column>
              <el-table-column label="单价 / 含税" width="110" align="right">
                <template #default="{ row }"><div>{{ money(row.unitPrice) }}</div><div class="muted">{{ money(row.taxedUnitPrice) }}</div></template>
              </el-table-column>
              <el-table-column label="小计 / 含税" width="110" align="right">
                <template #default="{ row }"><div>{{ money(row.amount) }}</div><div class="muted">{{ money(row.taxedAmount) }}</div></template>
              </el-table-column>
              <el-table-column label="备注" min-width="90">
                <template #default="{ row }">
                  <el-tag v-if="row.reuse" size="small" type="warning">利旧 7 折</el-tag>
                  <span v-if="row.remark && row.remark !== '利旧'">{{ row.remark }}</span>
                  <el-tag v-if="row.fromPipe" size="small" type="info">{{ row.lineIds.length ? "含管道" : "管道生成" }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="180" align="center">
                <template #default="{ row }">
                  <template v-if="row.lineIds.length === 1">
                    <el-button type="primary" plain @click="editQuota(row)">修改</el-button>
                    <el-button type="danger" plain @click="removeQuota(row)">删除</el-button>
                  </template>
                  <el-button v-else-if="!row.lineIds.length" plain @click="page.showPipe = true">在管道里改</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <!-- 管道（点“管道开挖 / 顶管 / 做井”展开） -->
          <el-card v-if="page.showPipe" shadow="never" class="content-card quota-section">
            <div class="quota-section-head">
              <h3>管道工程量</h3>
              <span class="muted">开挖和敷管一律 1 孔（宽 0.4 米、沟深 0.85 米），顶管按孔数填长度；保存后自动生成人工</span>
            </div>
            <div class="quota-pipe-grid">
              <div class="quota-pipe-card">
                <div class="quota-pipe-title">开挖（米）</div>
                <div v-for="road in pipeRoads" :key="road" class="quota-pipe-row">
                  <span>{{ road }}</span>
                  <el-input-number v-model="pipe.trench[road]" :min="0" :precision="2" size="small" controls-position="right" />
                </div>
              </div>
              <div class="quota-pipe-card">
                <div class="quota-pipe-title">顶管（米）</div>
                <div v-for="holes in 9" :key="holes" class="quota-pipe-row">
                  <span>顶管 {{ holes }} 孔</span>
                  <el-input-number v-model="pipe.jacking[holes]" :min="0" :precision="2" size="small" controls-position="right" />
                </div>
              </div>
              <div class="quota-pipe-card">
                <div class="quota-pipe-title">做井（个）</div>
                <div v-for="well in pipe.wells" :key="well.type" class="quota-pipe-row quota-pipe-well">
                  <span>{{ well.type }}</span>
                  <el-input-number v-model="well.count" :min="0" :precision="0" size="small" controls-position="right" />
                  <el-select v-model="well.road" size="small" placeholder="开挖井的路面">
                    <el-option v-for="road in wellRoads" :key="road" :label="road" :value="road" />
                  </el-select>
                </div>
                <div class="quota-pipe-row quota-pipe-well">
                  <span>直埋子管（米）</span>
                  <el-input-number v-model="pipe.subduct.length" :min="0" :precision="2" size="small" controls-position="right" />
                  <el-select v-model="pipe.subduct.road" size="small" placeholder="路面">
                    <el-option v-for="road in wellRoads" :key="road" :label="road" :value="road" />
                  </el-select>
                </div>
                <div class="quota-soil">
                  <div class="muted">人工开挖土质占比（%，坚石自动补足）</div>
                  <div v-for="soil in pipeSoils" :key="soil" class="quota-pipe-row">
                    <span>{{ soil }}</span>
                    <el-input-number v-model="pipe.soil[soil]" :min="0" :max="100" :precision="0" size="small" controls-position="right" :disabled="soil === '坚石'" />
                  </div>
                </div>
              </div>
            </div>
            <div class="quota-add-row">
              <el-button type="primary" :loading="page.savingPipe" @click="savePipe">保存并生成人工</el-button>
              <span class="muted">已生成 {{ view.pipeLines.length }} 项人工，在上面的人工清单里标“管道生成”</span>
            </div>
          </el-card>

          <!-- 材料 -->
          <el-card shadow="never" class="content-card quota-section">
            <div class="quota-section-head">
              <h3>材料 <span class="muted quota-subtotal">{{ money(view.totals.table4Amount) }}（含税 {{ money(view.totals.table4TaxedAmount) }}）</span></h3>
              <el-button type="primary" plain :disabled="!page.status?.materials" @click="openMaterialDialog()"><el-icon class="inline-icon"><Plus /></el-icon>更多材料</el-button>
            </div>
            <div v-if="!page.status?.materials" class="muted">还没有导入材料单价参考表，请先在“模板与单价”里导入。</div>
            <div v-if="commonMaterialGroups.length" class="quota-pick-row">
              <span class="muted quota-pick-label">常用</span>
              <el-button v-for="group in commonMaterialGroups" :key="group.sheet" class="quota-pick" @click="openMaterialDialog({ sheet: group.sheet })">
                <el-icon class="inline-icon"><Plus /></el-icon>{{ group.label }}
              </el-button>
            </div>
            <el-table :data="view.table4" empty-text="还没有材料，点上面的常用分类或“更多材料”添加" class="quota-table">
              <el-table-column type="index" label="#" width="42" />
              <el-table-column label="材料" min-width="200">
                <template #default="{ row }">
                  <div>{{ row.name }} <span class="muted">{{ row.spec }}</span></div>
                  <div class="muted quota-code">{{ row.code }}</div>
                </template>
              </el-table-column>
              <el-table-column label="数量" width="110" align="right">
                <template #default="{ row }">{{ round(row.quantity, 2) }} {{ row.unit }}</template>
              </el-table-column>
              <el-table-column label="单价 / 含税" width="110" align="right">
                <template #default="{ row }"><div>{{ money(row.unitPrice, 4) }}</div><div class="muted">{{ money(row.taxedUnitPrice, 4) }}</div></template>
              </el-table-column>
              <el-table-column label="小计 / 含税" width="110" align="right">
                <template #default="{ row }"><div>{{ money(row.amount) }}</div><div class="muted">{{ money(row.taxedAmount) }}</div></template>
              </el-table-column>
              <el-table-column prop="remark" label="用途" min-width="80" />
              <el-table-column label="操作" width="180" align="center">
                <template #default="{ row }">
                  <el-button type="primary" plain @click="editMaterial(row)">修改</el-button>
                  <el-button type="danger" plain @click="removeMaterial(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </template>
      </div>
    </div>

    <!-- 添加 / 修改人工 -->
    <el-dialog v-model="qd.visible" :title="qd.mode === 'edit' ? '修改人工' : '添加人工'" width="820px" top="6vh" class="quota-pick-dialog">
      <div class="quota-dialog-filter">
        <el-radio-group v-model="qd.category" size="small" @change="qd.q = ''">
          <el-radio-button value="常用">常用</el-radio-button>
          <el-radio-button v-for="category in catalog.quota.categories" :key="category" :value="category">{{ category }}</el-radio-button>
        </el-radio-group>
        <el-input v-model="qd.q" size="small" clearable placeholder="搜名称或编号" class="quota-dialog-search" />
      </div>
      <div class="quota-choice-grid">
        <button v-for="group in quotaChoices" :key="group.name" type="button" class="quota-choice" :class="{ active: qd.group?.name === group.name }" @click="selectQuotaGroup(group)">
          <span>{{ group.name }}</span>
          <span class="muted">{{ group.tiers.length > 1 ? `${group.tiers.length} 档 · ` : "" }}{{ group.unit }}</span>
        </button>
        <div v-if="!quotaChoices.length" class="muted">没有找到，换个分类或搜一搜</div>
      </div>
      <div v-if="qd.group" class="quota-dialog-form">
        <div class="quota-form-title">
          <strong>{{ qd.group.name }}</strong>
          <el-button link size="small" @click="toggleCommon('quota', qd.group.name, !qd.group.common)">
            <el-icon class="inline-icon"><component :is="qd.group.common ? 'StarFilled' : 'Star'" /></el-icon>{{ qd.group.common ? "取消常用" : "设为常用" }}
          </el-button>
        </div>
        <div v-if="qd.group.tiers.length > 1" class="quota-form-row">
          <span class="quota-form-label">档位</span>
          <el-radio-group v-model="qd.code" size="small" @change="focusLater(qdQty)">
            <el-radio-button v-for="tier in qd.group.tiers" :key="tier.code" :value="tier.code">{{ tier.detail || tier.code }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="quota-form-row">
          <span class="quota-form-label">数量</span>
          <el-input-number ref="qdQty" v-model="qd.quantity" :min="0" :precision="qd.group.unit === '千米' && qd.inputUnit === '千米' ? 3 : 2" controls-position="right" class="quota-qty" />
          <el-radio-group v-if="qd.group.unit === '千米'" v-model="qd.inputUnit" size="small">
            <el-radio-button value="米">米</el-radio-button><el-radio-button value="千米">千米</el-radio-button>
          </el-radio-group>
          <span v-else class="muted">{{ qd.group.unit }}</span>
          <span v-if="qd.group.unit === '千米' && qd.inputUnit === '米' && qd.quantity" class="muted">= {{ round(qd.quantity / 1000, 3) }} 千米</span>
        </div>
        <div v-if="qd.group.reusable" class="quota-form-row">
          <span class="quota-form-label">利旧</span>
          <el-switch v-model="qd.reuse" /><span class="muted">利旧的光缆敷设按 7 折算，单独一行</span>
        </div>
        <div class="quota-form-row">
          <span class="quota-form-label">备注</span>
          <el-input v-model="qd.remark" placeholder="可不填" class="quota-remark-wide" />
        </div>
        <div v-if="quotaPreview" class="quota-form-row muted">
          <span class="quota-form-label"></span>{{ quotaPreview }}
        </div>
      </div>
      <template #footer>
        <el-button v-if="qd.mode === 'edit'" type="danger" plain class="quota-footer-left" @click="removeEditingQuota">删除这条</el-button>
        <el-button @click="qd.visible = false">取消</el-button>
        <template v-if="qd.mode === 'add'">
          <el-button :loading="qd.saving" @click="submitQuota(true)">加入并继续</el-button>
          <el-button type="primary" :loading="qd.saving" @click="submitQuota(false)">加入</el-button>
        </template>
        <el-button v-else type="primary" :loading="qd.saving" @click="submitQuota(false)">保存</el-button>
      </template>
    </el-dialog>

    <!-- 添加 / 修改材料 -->
    <el-dialog v-model="md.visible" :title="md.mode === 'edit' ? '修改材料' : '添加材料'" width="860px" top="6vh" class="quota-pick-dialog">
      <div class="quota-dialog-filter">
        <el-select v-model="md.category" size="small" class="quota-dialog-category" @change="md.q = ''">
          <el-option label="常用材料" value="常用" />
          <el-option v-for="category in catalog.material.categories" :key="category" :label="category" :value="category" />
        </el-select>
        <el-input v-model="md.q" size="small" clearable placeholder="搜名称、规格或编码，例如 24芯 GYTS" class="quota-dialog-search" />
      </div>
      <div class="quota-choice-grid quota-choice-materials">
        <button v-for="item in materialChoices.rows" :key="item.code" type="button" class="quota-choice" :class="{ active: md.item?.code === item.code }" @click="selectMaterial(item)">
          <span>{{ item.name }} {{ materialShort(item) }}</span>
          <span class="muted">{{ money(item.maxPrice, 2) }} 元/{{ item.unit }}<template v-if="item.common"> · 常用</template><template v-if="item.expired"> · 合同已过期</template></span>
        </button>
        <div v-if="!materialChoices.rows.length" class="muted">没有找到，换个分类或搜一搜</div>
        <div v-else-if="materialChoices.more" class="muted">还有 {{ materialChoices.more }} 种，请搜一搜缩小范围</div>
      </div>
      <div v-if="md.item" class="quota-dialog-form">
        <div class="quota-form-title">
          <strong>{{ materialTitle(md.item) }}</strong>
          <span class="muted">{{ md.item.code }} · 含税 {{ money(md.item.maxPrice, 4) }} 元/{{ md.item.unit }}</span>
          <el-button link size="small" @click="toggleCommon('material', md.item.code, !md.item.common)">
            <el-icon class="inline-icon"><component :is="md.item.common ? 'StarFilled' : 'Star'" /></el-icon>{{ md.item.common ? "取消常用" : "设为常用" }}
          </el-button>
        </div>
        <div class="quota-form-row">
          <span class="quota-form-label">数量</span>
          <el-input-number ref="mdQty" v-model="md.quantity" :min="0" :precision="2" controls-position="right" class="quota-qty" />
          <span class="muted">{{ md.item.unit }}</span>
        </div>
        <div class="quota-form-row">
          <span class="quota-form-label">用途</span>
          <el-radio-group v-model="md.remark" size="small">
            <el-radio-button v-for="use in materialUses" :key="use" :value="use">{{ use }}</el-radio-button>
          </el-radio-group>
          <el-input v-model="md.remark" size="small" placeholder="或自己填" class="quota-remark" />
        </div>
        <div v-if="md.quantity" class="quota-form-row muted">
          <span class="quota-form-label"></span>含税约 {{ money(md.item.maxPrice * md.quantity) }} 元
        </div>
      </div>
      <template #footer>
        <el-button v-if="md.mode === 'edit'" type="danger" plain class="quota-footer-left" @click="removeEditingMaterial">删除这条</el-button>
        <el-button @click="md.visible = false">取消</el-button>
        <template v-if="md.mode === 'add'">
          <el-button :loading="md.saving" @click="submitMaterial(true)">加入并继续</el-button>
          <el-button type="primary" :loading="md.saving" @click="submitMaterial(false)">加入</el-button>
        </template>
        <el-button v-else type="primary" :loading="md.saving" @click="submitMaterial(false)">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新建预算 -->
    <el-dialog v-model="create.visible" title="新建预算" width="480px">
      <el-form label-width="110px">
        <el-form-item label="基础信息模板">
          <el-select v-model="create.presetId">
            <el-option v-for="preset in page.status?.presets || []" :key="preset.id" :label="preset.isDefault ? `${preset.name}（默认）` : preset.name" :value="preset.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="项目名称" required><el-input v-model="create.projectName" /></el-form-item>
        <el-form-item label="建设地点" required><el-input v-model="create.location" /></el-form-item>
        <el-form-item label="编制人" required><el-autocomplete v-model="create.preparer" :fetch-suggestions="(q, cb) => suggestNames('preparer', q, cb)" class="quota-info-input" /></el-form-item>
        <el-form-item label="审核" required><el-autocomplete v-model="create.reviewer" :fetch-suggestions="(q, cb) => suggestNames('reviewer', q, cb)" class="quota-info-input" /></el-form-item>
      </el-form>
      <p class="muted">工程编号留空，由规建部门填写；编制日期取今天。</p>
      <template #footer>
        <el-button @click="create.visible = false">取消</el-button>
        <el-button type="primary" :loading="create.saving" @click="submitCreate">新建</el-button>
      </template>
    </el-dialog>

    <!-- 模板与单价 -->
    <el-drawer v-model="resources.visible" title="模板与单价" size="560px">
      <input ref="templateInput" type="file" accept=".xlsx" class="quota-file-input" @change="uploadTemplate" />
      <input ref="materialInput" type="file" accept=".xlsx" class="quota-file-input" @change="previewMaterials" />
      <h3>预算书模板</h3>
      <p v-if="page.status?.template" class="muted">
        {{ page.status.template.fileName }} · {{ formatDate(page.status.template.importedAt) }} 导入 · 定额 {{ page.status.template.itemCount }} 条
      </p>
      <p v-else class="muted">还没有导入。请用 WPS / Excel 把《广东广电网络工程预算书编制程序》另存为 .xlsx 再导入。</p>
      <el-alert v-for="warning in page.status?.template?.warnings || []" :key="warning" :title="warning" type="warning" :closable="false" show-icon />
      <el-button :loading="resources.uploading" @click="chooseTemplate">{{ page.status?.template ? "换新模板" : "导入模板" }}</el-button>

      <h3>材料单价参考</h3>
      <p v-if="page.status?.materials" class="muted">
        {{ page.status.materials.fileName }} · {{ formatDate(page.status.materials.importedAt) }} 导入 · 物料 {{ page.status.materials.materialCount }} 条
      </p>
      <p v-else class="muted">还没有导入。单价表每几个月更新一次，导入新表会整份替换。</p>
      <el-button :loading="resources.uploading" @click="chooseMaterials">导入单价表</el-button>
      <div v-if="resources.preview" class="quota-preview">
        <p>新表共 {{ resources.preview.materialCount }} 种物料（常用 {{ resources.preview.commonCount }}）：新增 {{ resources.preview.added }}，改价 {{ resources.preview.changed.length }}，
          不再有 {{ resources.preview.removed.length }}，合同已过期 {{ resources.preview.expired.length }}。</p>
        <el-table v-if="resources.preview.changed.length" :data="resources.preview.changed.slice(0, 50)" size="small" max-height="220">
          <el-table-column prop="code" label="编码" width="90" />
          <el-table-column label="物料" min-width="150"><template #default="{ row }">{{ row.name }} {{ row.spec }}</template></el-table-column>
          <el-table-column label="原价 → 新价" width="150"><template #default="{ row }">{{ money(row.before, 4) }} → {{ money(row.after, 4) }}</template></el-table-column>
        </el-table>
        <p v-for="item in resources.preview.skipped" :key="item.sheet" class="muted">跳过“{{ item.sheet }}”：{{ item.reason }}</p>
        <el-button type="primary" :loading="resources.uploading" @click="confirmMaterials">确认导入</el-button>
        <el-button @click="resources.preview = null">取消</el-button>
      </div>

      <h3>学到的说法</h3>
      <p class="muted">飞书定额模式里每次“确认加入 / 改用这个”都会记下说法，下次同样的说法直接按它处理；本地规则拿不准时，这些例子也会交给大模型参考。记错的可以删除。</p>
      <el-table :data="resources.learned" size="small" max-height="260" empty-text="还没有学到的说法">
        <el-table-column label="说法" min-width="140">
          <template #default="{ row }">{{ row.example || row.phrase }} <el-tag v-if="row.corrected" size="small" type="warning">纠正过</el-tag></template>
        </el-table-column>
        <el-table-column label="对应" min-width="170">
          <template #default="{ row }">{{ row.kind === "quota" ? "人工" : "材料" }} {{ row.code }} {{ row.label }}</template>
        </el-table-column>
        <el-table-column prop="hits" label="次数" width="55" />
        <el-table-column label="" width="55">
          <template #default="{ row }"><el-button link type="danger" size="small" @click="removeLearned(row)">删除</el-button></template>
        </el-table-column>
      </el-table>

      <h3>基础信息模板</h3>
      <el-table :data="page.status?.presets || []" size="small">
        <el-table-column label="名称" min-width="140">
          <template #default="{ row }">{{ row.name }} <el-tag v-if="row.isDefault" size="small">默认</el-tag></template>
        </el-table-column>
        <el-table-column label="施工单位" min-width="140"><template #default="{ row }">{{ row.fields.contractor }}</template></el-table-column>
        <el-table-column label="" width="150">
          <template #default="{ row }">
            <el-button link size="small" @click="editPreset(row)">修改</el-button>
            <el-button v-if="!row.isDefault" link size="small" @click="makeDefault(row)">设为默认</el-button>
            <el-button link type="danger" size="small" @click="removePreset(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>

    <!-- 修改基础信息模板 -->
    <el-dialog v-model="presetEdit.visible" title="修改基础信息模板" width="620px">
      <el-form label-width="150px">
        <el-form-item label="模板名称" required><el-input v-model="presetEdit.name" /></el-form-item>
        <el-form-item v-for="field in presetFields" :key="field.key" :label="field.label">
          <el-select v-if="field.key === 'regionClass'" v-model="presetEdit.fields[field.key]">
            <el-option v-for="region in regionClasses" :key="region" :label="region" :value="region" />
          </el-select>
          <el-input-number v-else-if="field.type === 'rate'" v-model="presetEdit.fields[field.key]" :min="0" :max="99.99" :precision="2" controls-position="right" />
          <el-input v-else v-model="presetEdit.fields[field.key]" />
          <span v-if="field.type === 'rate'" class="muted quota-unit">%</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="presetEdit.visible = false">取消</el-button>
        <el-button type="primary" @click="submitPreset">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { useAppContext } from "../app-context.js";
import { downloadBlob } from "../renderer-services.js";
import { PIPE_ROADS, PIPE_SOILS, PIPE_WELLS, regionIndex } from "../quota/quota-calc.mjs";
import { commonMaterialGroups as commonGroupsOf, materialShortLabel, sheetMaterials } from "../quota/quota-catalog.mjs";

const PER_BUDGET = new Set(["projectName", "projectCode", "location", "preparer", "reviewer", "preparedDate"]);
const MATERIAL_USES = ["架空用", "管道用", "直埋用", "墙壁用", "入户用"];
const CHOICE_LIMIT = 240;

// 定额预算（ADR-092）：预算列表；人工（表二定额）、材料（表四甲供）以点选为主，常用项平铺在页面上；管道计算器、基础信息、模板与单价管理。
export default {
  name: "QuotaBudgetView",
  setup() {
    const ctx = useAppContext();
    const { quotaApi } = ctx;
    const page = reactive({ loaded: false, loading: false, status: null, budgets: [], q: "", showInfo: false, showPipe: false, exporting: false, savingPipe: false, savingInfo: false });
    const view = ref(null);
    const infoForm = reactive({});
    const overview = reactive({ budgetCount: 0, monthCount: 0, feishuCount: 0, oaCount: 0, oaThreshold: 3000, recent: [] });
    const catalog = reactive({ quota: { categories: [], groups: [], common: [] }, material: { categories: [], items: [] } });
    const qd = reactive({ visible: false, mode: "add", lineId: null, category: "常用", q: "", group: null, code: "", quantity: null, inputUnit: "", reuse: false, remark: "", saving: false });
    const md = reactive({ visible: false, mode: "add", lineId: null, category: "常用", q: "", item: null, quantity: null, remark: "", saving: false });
    const create = reactive({ visible: false, saving: false, presetId: null, projectName: "", location: "", preparer: "", reviewer: "" });
    const resources = reactive({ visible: false, uploading: false, preview: null, file: null, learned: [] });
    const presetEdit = reactive({ visible: false, id: null, name: "", fields: {} });
    const pipe = reactive(emptyPipe());
    const templateInput = ref(null);
    const materialUses = MATERIAL_USES;
    const qdQty = ref(null);
    const mdQty = ref(null);
    const materialInput = ref(null);
    const pipeRoads = PIPE_ROADS.map((road) => road.key);
    const wellRoads = [...pipeRoads.filter((road) => road !== "普通开挖"), "普通土"];
    const pipeSoils = PIPE_SOILS.map((soil) => soil.key);
    const infoFields = computed(() => page.status?.infoFields || []);
    const presetFields = computed(() => infoFields.value.filter((field) => !PER_BUDGET.has(field.key)));
    const regionClasses = computed(() => page.status?.regionClasses || []);

    function emptyPipe() {
      return {
        trench: {},
        jacking: {},
        wells: Object.keys(PIPE_WELLS).map((type) => ({ type, road: "混凝土路面250mm以下", count: 0 })),
        subduct: { length: 0, road: "普通土" },
        soil: { 普通土: 50, 硬土: 0, 砂砾土: 50, 软石: 0, 坚石: 0 }
      };
    }

    const round = (value, digits = 2) => Math.round(Number(value || 0) * 10 ** digits) / 10 ** digits;
    const money = (value, digits = 2) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const formatDate = (value) => (value ? new Date(value).toLocaleString("zh-CN", { hour12: false }).slice(0, 16) : "");
    const isExpired = (item) => Boolean(item.contractEnd) && item.contractEnd < new Date().toISOString().slice(0, 10);
    const words = (q) => String(q || "").trim().split(/\s+/).filter(Boolean);

    // ---------------- 选择目录 ----------------
    const groupMap = computed(() => new Map(catalog.quota.groups.map((group) => [group.name, group])));
    const commonQuotaGroups = computed(() => catalog.quota.common.map((name) => groupMap.value.get(name)).filter(Boolean));
    const commonMaterialGroups = computed(() => commonGroupsOf(catalog.material));
    const quotaChoices = computed(() => {
      const query = words(qd.q);
      if (query.length) return catalog.quota.groups.filter((group) => query.every((word) => `${group.name} ${group.tiers.map((tier) => `${tier.code} ${tier.detail}`).join(" ")}`.includes(word)));
      if (qd.category === "常用") return commonQuotaGroups.value;
      return catalog.quota.groups.filter((group) => group.category === qd.category);
    });
    const materialChoices = computed(() => {
      const query = words(md.q);
      let rows;
      if (query.length) rows = catalog.material.items.filter((item) => query.every((word) => `${item.code} ${item.name} ${item.spec} ${item.attr}`.toUpperCase().includes(word.toUpperCase())));
      else if (md.category === "常用") rows = commonMaterialGroups.value.flatMap((group) => group.items);
      else rows = sheetMaterials(catalog.material, md.category);
      return { rows: rows.slice(0, CHOICE_LIMIT), more: Math.max(0, rows.length - CHOICE_LIMIT) };
    });
    const materialTitle = (item) => `${item.name} ${item.spec}${item.attr ? ` ${item.attr}` : ""}`.trim();
    const materialShort = (item) => materialShortLabel(item);

    async function loadCatalog() {
      const data = await guard(() => quotaApi.catalog());
      if (data) Object.assign(catalog, { quota: data.quota, material: data.material });
    }

    async function toggleCommon(kind, key, pinned) {
      const data = await guard(() => quotaApi.setCommon(kind, key, pinned), pinned ? "已设为常用" : "已取消常用");
      if (!data) return;
      Object.assign(catalog, { quota: data.quota, material: data.material });
      if (kind === "quota" && qd.group) qd.group = groupMap.value.get(qd.group.name) || qd.group;
      if (kind === "material" && md.item) md.item = catalog.material.items.find((item) => item.code === md.item.code) || md.item;
    }
    const toPercent = (info) => Object.fromEntries(Object.entries(info).map(([key, value]) => [key, infoFields.value.find((field) => field.key === key)?.type === "rate" ? round(Number(value) * 100, 4) : value]));
    const fromPercent = (info) => Object.fromEntries(Object.entries(info).map(([key, value]) => [key, infoFields.value.find((field) => field.key === key)?.type === "rate" ? Number(value || 0) / 100 : value]));

    async function guard(task, success) {
      try {
        const result = await task();
        if (success) ElMessage.success(success);
        return result;
      } catch (error) {
        ElMessage.error(error.message || "操作失败");
        return null;
      }
    }

    async function loadStatus() {
      page.status = await guard(() => quotaApi.status());
      page.loaded = true;
    }

    async function loadBudgets() {
      page.loading = true;
      const data = await guard(() => quotaApi.budgets(page.q));
      page.budgets = data?.rows || [];
      page.loading = false;
      if (!view.value) loadOverview();
    }

    async function loadOverview() {
      const data = await guard(() => quotaApi.overview());
      if (data) Object.assign(overview, data);
    }

    function applyView(data) {
      if (!data) return;
      const switched = view.value?.budget.id !== data.budget.id;
      view.value = data;
      if (switched) {
        page.showInfo = false;
        page.showPipe = Boolean(data.pipeLines?.length);
      }
      Object.keys(infoForm).forEach((key) => delete infoForm[key]);
      Object.assign(infoForm, toPercent(data.budget.info));
      const input = data.pipeInput || {};
      const next = emptyPipe();
      Object.assign(next.trench, input.trench || {});
      Object.assign(next.jacking, input.jacking || {});
      for (const well of input.wells || []) {
        const target = next.wells.find((item) => item.type === well.type);
        if (target) Object.assign(target, well);
      }
      if (input.subduct) Object.assign(next.subduct, input.subduct);
      if (input.soil) next.soil = Object.fromEntries(pipeSoils.map((soil) => [soil, round(Number(input.soil[soil] || 0) * 100, 2)]));
      Object.assign(pipe, next);
    }

    function closeBudget() {
      view.value = null;
      loadOverview();
    }

    async function openBudget(row) {
      applyView(await guard(() => quotaApi.budget(row.id)));
    }

    async function reloadView(promise, success) {
      const before = view.value?.totals.needsOa;
      const data = await guard(() => promise, success);
      if (data) applyView(data);
      // 每次改动后人工 + 监理费（含税）仍超过 3000 就弹警告，提醒上 OA
      if (data?.totals?.needsOa) {
        ElMessageBox.alert(`${data.oaNotice}。`, before ? "仍需上 OA 系统" : "需要上 OA 系统", { type: "warning", confirmButtonText: "知道了" }).catch(() => {});
      }
      await loadBudgets();
      return data;
    }

    function openCreate() {
      const presets = page.status?.presets || [];
      Object.assign(create, { visible: true, presetId: (presets.find((preset) => preset.isDefault) || presets[0])?.id || null, projectName: "", location: "", preparer: "", reviewer: "" });
    }

    async function submitCreate() {
      create.saving = true;
      const data = await guard(() => quotaApi.createBudget({ presetId: create.presetId, projectName: create.projectName, location: create.location, preparer: create.preparer, reviewer: create.reviewer }), "已新建预算");
      create.saving = false;
      if (!data) return;
      create.visible = false;
      await Promise.all([loadBudgets(), loadStatus()]);
      await openBudget(data.budget);
    }

    // ---------------- 人工 ----------------
    const quotaPreview = computed(() => {
      const tier = qd.group?.tiers.find((entry) => entry.code === qd.code);
      const quantity = quotaQuantity();
      if (!tier || !(quantity > 0) || !view.value) return "";
      const price = Number(tier.prices?.[regionIndex(view.value.budget.info.regionClass)] || 0) * (qd.reuse ? 0.7 : 1);
      return `${view.value.budget.info.regionClass}单价 ${money(price)} 元/${tier.unit}${qd.reuse ? "（已按利旧 7 折）" : ""}，小计约 ${money(price * quantity)} 元（不含税）`;
    });

    function quotaQuantity() {
      const value = Number(qd.quantity || 0);
      return qd.group?.unit === "千米" && qd.inputUnit === "米" ? Math.round(value) / 1000 : value;
    }

    function selectQuotaGroup(group) {
      const keep = qd.group?.name === group.name ? qd.code : "";
      qd.group = group;
      qd.code = keep || (group.tiers.length === 1 ? group.tiers[0].code : "");
      if (!qd.inputUnit || qd.mode === "add") qd.inputUnit = group.unit === "千米" ? "米" : group.unit;
      if (!group.reusable) qd.reuse = false;
      if (qd.code) focusLater(qdQty);
    }

    function openQuotaDialog({ group = null } = {}) {
      Object.assign(qd, { visible: true, mode: "add", lineId: null, category: "常用", q: "", group: null, code: "", quantity: null, inputUnit: "", reuse: false, remark: "", saving: false });
      if (group) selectQuotaGroup(group);
    }

    function editQuota(row) {
      const line = view.value.quotaLines.find((entry) => entry.id === row.lineIds[0]);
      const group = line?.item && groupMap.value.get(line.item.name);
      if (!line || !group) return ElMessage.warning("定额库里找不到这条人工，只能删除后重新添加");
      Object.assign(qd, { visible: true, mode: "edit", lineId: line.id, category: group.category, q: "", group: null, code: "", quantity: null, inputUnit: "", reuse: line.reuse, remark: line.remark === "利旧" ? "" : line.remark, saving: false });
      selectQuotaGroup(group);
      qd.code = line.code;
      qd.inputUnit = group.unit === "千米" ? "米" : group.unit;
      qd.quantity = group.unit === "千米" ? round(line.quantity * 1000, 3) : line.quantity;
      if (row.fromPipe) ElMessage.info("这一行合并了管道生成的数量，这里只改手工录入的部分");
    }

    async function submitQuota(keepOpen) {
      if (!qd.group) return ElMessage.warning("请先选一项人工");
      if (!qd.code) return ElMessage.warning("请选档位");
      const quantity = quotaQuantity();
      if (!(quantity > 0)) return ElMessage.warning("请填写数量");
      qd.saving = true;
      const body = { code: qd.code, quantity, reuse: qd.reuse, remark: qd.remark.trim() };
      const data = await reloadView(qd.mode === "edit"
        ? quotaApi.updateQuotaLine(view.value.budget.id, qd.lineId, body)
        : quotaApi.addQuotaLine(view.value.budget.id, body), qd.mode === "edit" ? "已保存" : `已加入：${qd.group.name}`);
      qd.saving = false;
      if (!data) return;
      loadCatalog();
      if (keepOpen) Object.assign(qd, { quantity: null, reuse: false, remark: "" });
      else qd.visible = false;
    }

    async function confirmRemove(message) {
      try {
        await ElMessageBox.confirm(message, "删除", { type: "warning", confirmButtonText: "删除" });
        return true;
      } catch {
        return false;
      }
    }

    async function removeQuota(row) {
      if (!(await confirmRemove(`删除人工“${row.name}${row.detail ? ` ${row.detail}` : ""}”？`))) return;
      for (const lineId of row.lineIds) await guard(() => quotaApi.deleteQuotaLine(view.value.budget.id, lineId));
      await openBudget(view.value.budget);
      await loadBudgets();
    }

    async function removeEditingQuota() {
      if (!(await confirmRemove(`删除人工“${qd.group?.name || ""}”？`))) return;
      const data = await reloadView(quotaApi.deleteQuotaLine(view.value.budget.id, qd.lineId), "已删除");
      if (data) qd.visible = false;
    }

    // ---------------- 材料 ----------------
    function selectMaterial(item) {
      md.item = item;
      focusLater(mdQty);
    }

    function openMaterialDialog({ item = null, sheet = "" } = {}) {
      Object.assign(md, { visible: true, mode: "add", lineId: null, category: item ? item.sheet : sheet || "常用", q: "", item, quantity: null, remark: "", saving: false });
      if (item) focusLater(mdQty);
    }

    /** 选好项目后把光标放到数量框，直接打数字。 */
    function focusLater(target) {
      nextTick(() => setTimeout(() => target.value?.focus?.(), 250));
    }

    function editMaterial(row) {
      const item = catalog.material.items.find((entry) => entry.code === row.code)
        || { code: row.code, name: row.name, spec: row.spec, attr: "", unit: row.unit, maxPrice: row.taxedUnitPrice, sheet: "", common: false };
      Object.assign(md, { visible: true, mode: "edit", lineId: row.lineId, category: item.sheet || "常用", q: "", item, quantity: row.quantity, remark: row.remark || "", saving: false });
    }

    async function submitMaterial(keepOpen) {
      if (!md.item) return ElMessage.warning("请先选一种材料");
      if (!(Number(md.quantity) > 0)) return ElMessage.warning("请填写数量");
      md.saving = true;
      const body = { code: md.item.code, quantity: Number(md.quantity), remark: md.remark.trim() };
      const data = await reloadView(md.mode === "edit"
        ? quotaApi.updateMaterialLine(view.value.budget.id, md.lineId, body)
        : quotaApi.addMaterialLine(view.value.budget.id, body), md.mode === "edit" ? "已保存" : `已加入：${materialTitle(md.item)}`);
      md.saving = false;
      if (!data) return;
      loadCatalog();
      if (keepOpen) Object.assign(md, { item: null, quantity: null, remark: "" });
      else md.visible = false;
    }

    async function removeMaterial(row) {
      if (!(await confirmRemove(`删除材料“${row.name} ${row.spec}”？`))) return;
      await reloadView(quotaApi.deleteMaterialLine(view.value.budget.id, row.lineId), "已删除");
    }

    async function removeEditingMaterial() {
      if (!(await confirmRemove(`删除材料“${md.item ? materialTitle(md.item) : ""}”？`))) return;
      const data = await reloadView(quotaApi.deleteMaterialLine(view.value.budget.id, md.lineId), "已删除");
      if (data) md.visible = false;
    }

    async function refreshPrices() {
      await reloadView(quotaApi.refreshPrices(view.value.budget.id), "已按最新单价刷新");
    }

    async function savePipe() {
      page.savingPipe = true;
      const soil = Object.fromEntries(pipeSoils.filter((key) => key !== "坚石").map((key) => [key, Number(pipe.soil[key] || 0) / 100]));
      if (Object.values(soil).reduce((sum, value) => sum + value, 0) > 1) {
        page.savingPipe = false;
        return ElMessage.warning("土质占比合计不能超过 100%");
      }
      await reloadView(quotaApi.savePipe(view.value.budget.id, {
        trench: pipe.trench,
        jacking: pipe.jacking,
        wells: pipe.wells.filter((well) => well.count > 0),
        subduct: pipe.subduct.length > 0 ? pipe.subduct : null,
        soil
      }), "管道工程量已保存");
      page.savingPipe = false;
    }

    async function saveInfo() {
      page.savingInfo = true;
      await reloadView(quotaApi.updateInfo(view.value.budget.id, fromPercent({ ...infoForm })), "基础信息已保存");
      page.savingInfo = false;
    }

    function suggestNames(kind, q, callback) {
      const names = page.status?.recentNames?.[kind] || [];
      callback(names.filter((name) => !q || name.includes(q)).map((value) => ({ value })));
    }

    function suggestUnits(q, callback) {
      const units = page.status?.template?.constructionUnits || [];
      callback(units.filter((unit) => !q || unit.includes(q)).map((value) => ({ value })));
    }

    async function exportBudget() {
      page.exporting = true;
      const result = await guard(() => quotaApi.exportBudget(view.value.budget.id));
      page.exporting = false;
      if (result) {
        downloadBlob(result.blob, result.fileName);
        ElMessage.success(`已生成 ${result.fileName}`);
      }
    }

    async function saveAsPreset() {
      try {
        const { value } = await ElMessageBox.prompt("把这份预算的基础信息（项目名称、地点、编制人、审核、日期除外）存成模板，新建预算时可以选。", "另存为基础信息模板", {
          inputPlaceholder: "模板名称，例如 某某公司施工",
          inputValidator: (text) => Boolean(String(text || "").trim()) || "请填写模板名称"
        });
        await guard(() => quotaApi.saveAsPreset(view.value.budget.id, { name: value }), "已另存为基础信息模板");
        await loadStatus();
      } catch {
        // 取消
      }
    }

    async function removeBudget() {
      try {
        await ElMessageBox.confirm(`删除“${view.value.budget.name}”后不能恢复，确认删除？`, "删除预算", { type: "warning", confirmButtonText: "删除" });
      } catch {
        return;
      }
      await guard(() => quotaApi.deleteBudget(view.value.budget.id), "已删除");
      view.value = null;
      await loadBudgets();
    }

    async function openResources() {
      resources.visible = true;
      resources.preview = null;
      resources.learned = (await guard(() => quotaApi.learned()))?.rows || [];
    }

    async function removeLearned(row) {
      const data = await guard(() => quotaApi.deleteLearned(row.id), "已删除");
      if (data) resources.learned = data.rows;
    }

    const chooseTemplate = () => templateInput.value?.click();
    const chooseMaterials = () => materialInput.value?.click();

    async function uploadTemplate(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      resources.uploading = true;
      const result = await guard(() => quotaApi.uploadTemplate(file));
      resources.uploading = false;
      if (result) {
        ElMessage.success(`模板已导入，定额 ${result.itemCount} 条`);
        await Promise.all([loadStatus(), loadCatalog()]);
      }
    }

    async function previewMaterials(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      resources.uploading = true;
      resources.file = file;
      resources.preview = await guard(() => quotaApi.previewMaterials(file));
      resources.uploading = false;
    }

    async function confirmMaterials() {
      resources.uploading = true;
      const result = await guard(() => quotaApi.uploadMaterials(resources.file));
      resources.uploading = false;
      if (result) {
        ElMessage.success(`单价表已导入，物料 ${result.materialCount} 条`);
        resources.preview = null;
        await loadStatus();
        await loadCatalog();
        if (view.value) await openBudget(view.value.budget);
      }
    }

    function editPreset(row) {
      Object.assign(presetEdit, { visible: true, id: row.id, name: row.name, fields: toPercent({ ...row.fields }) });
    }

    async function submitPreset() {
      const saved = await guard(() => quotaApi.savePreset({ id: presetEdit.id, name: presetEdit.name, fields: fromPercent({ ...presetEdit.fields }) }), "基础信息模板已保存");
      if (saved) {
        presetEdit.visible = false;
        await loadStatus();
      }
    }

    async function makeDefault(row) {
      await guard(() => quotaApi.savePreset({ id: row.id, name: row.name, fields: row.fields, isDefault: true }), "已设为默认");
      await loadStatus();
    }

    async function removePreset(row) {
      try {
        await ElMessageBox.confirm(`删除基础信息模板“${row.name}”？`, "删除模板", { type: "warning", confirmButtonText: "删除" });
      } catch {
        return;
      }
      await guard(() => quotaApi.deletePreset(row.id), "已删除");
      await loadStatus();
    }

    onMounted(async () => {
      await Promise.all([loadStatus(), loadBudgets()]);
      if (page.status?.template) await loadCatalog();
    });

    return { ...ctx, page, view, overview, closeBudget, infoForm, catalog, qd, md, qdQty, mdQty, focusLater, create, resources, presetEdit, pipe, templateInput, materialInput, pipeRoads, wellRoads, pipeSoils, infoFields, presetFields, regionClasses, materialUses, round, money, formatDate, isExpired, commonQuotaGroups, commonMaterialGroups, quotaChoices, materialChoices, materialTitle, materialShort, quotaPreview, toggleCommon, loadBudgets, openBudget, openCreate, submitCreate, selectQuotaGroup, openQuotaDialog, editQuota, submitQuota, removeQuota, removeEditingQuota, selectMaterial, openMaterialDialog, editMaterial, submitMaterial, removeMaterial, removeEditingMaterial, refreshPrices, savePipe, saveInfo, suggestNames, suggestUnits, exportBudget, saveAsPreset, removeBudget, openResources, chooseTemplate, chooseMaterials, uploadTemplate, previewMaterials, confirmMaterials, editPreset, submitPreset, makeDefault, removePreset, removeLearned };
  }
};
</script>
