<template>
  <section>
    <div class="page-head">
      <div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <h1>ONU 安装查询</h1>
          <el-tag size="small" type="info" effect="plain">
            全网汇总 · 涵盖 {{ state.olts.length }} 台 OLT
          </el-tag>
        </div>
        <div style="font-size: 13px; color: #64748b; margin-top: 4px;">
          实时读取全网所有已启用 OLT 下的未注册（Autofind / Unconfigured）ONU 设备，点击即可一键生成对应机型的配置方案
        </div>
      </div>
      <div class="page-head-actions">
        <el-button type="primary" :loading="state.loading.install" @click="loadInstallOnus">
          🔄 刷新全网未注册 ONU
        </el-button>
      </div>
    </div>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; color: #0f172a;">全网未注册 ONU 清单</span>
            <el-tag size="small" type="danger" effect="plain" v-if="filteredUnregisteredRows.length > 0">
              共发现 {{ filteredUnregisteredRows.length }} 台未注册设备
            </el-tag>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <el-select
              v-model="state.installFilterOltHost"
              placeholder="按 OLT 设备筛选"
              clearable
              size="small"
              style="width: 260px;"
            >
              <el-option :label="'全部 OLT 设备 (' + state.unregisteredRows.length + '台)'" value="" />
              <el-option
                v-for="olt in state.olts"
                :key="olt.id"
                :label="olt.host ? (olt.host + ' (' + (olt.model || '') + ') · ' + getOltUnregisteredCount(olt.host) + '台') : olt.name"
                :value="olt.host"
              />
            </el-select>
            <el-input
              v-model="state.installSearchKeyword"
              placeholder="搜索序列号 / 坐标 / 地址"
              clearable
              size="small"
              style="width: 220px;"
            />
          </div>
        </div>
      </template>

      <el-table
        :data="filteredUnregisteredRows"
        border
        stripe
        size="small"
        :empty-text="installEmptyText"
      >
        <!-- 第 1 列：所属 OLT -->
        <el-table-column label="所属 OLT" min-width="170">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 6px;">
              <el-tag
                :type="row.oltVendor === 'huawei' ? 'danger' : 'primary'"
                size="small"
                effect="plain"
                style="font-size: 11px; height: 20px; line-height: 18px;"
              >
                {{ row.oltVendor === 'huawei' ? '华为' : '中兴' }}
              </el-tag>
              <span style="font-family: monospace; font-size: 13px; font-weight: 700; color: #0f172a;">
                {{ row.oltHost || row.oltName || '未知 OLT' }}
              </span>
            </div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
              {{ row.oltModel || '' }}
            </div>
          </template>
        </el-table-column>

        <!-- 第 2 列：物理坐标 -->
        <el-table-column label="槽/板卡/PON/ID" min-width="140">
          <template #default="{ row }">
            <span style="font-family: monospace; font-weight: 600;">{{ onuCoordinateLabel(row) }}</span>
          </template>
        </el-table-column>

        <!-- 第 3 列：一级箱 / 门牌地址 -->
        <el-table-column label="一级箱 / 安装地址" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.address" style="color: #1e293b; font-weight: 500;">
              📦 {{ row.address }}
            </span>
            <span v-else style="color: #94a3b8;">未登记一级箱</span>
          </template>
        </el-table-column>

        <!-- 第 4 列：序列号 -->
        <el-table-column prop="serial" label="序列号" min-width="190">
          <template #default="{ row }">
            <div class="cell-copy-row">
              <span style="font-family: monospace; font-weight: 700;">{{ row.serial || "N/A" }}</span>
              <button v-if="row.serial" type="button" class="quick-copy-btn" title="复制序列号" @click.stop="quickCopy(row.serial, '序列号')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              </button>
            </div>
          </template>
        </el-table-column>

        <!-- 第 5 列：配置方案操作 -->
        <el-table-column label="配置方案" min-width="130" align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" plain @click="openConfigPlanDialog(row)">
              生成方案 ⚙️
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </section>
</template>

<script>
import { computed } from "vue";
import { onuCoordinateLabel } from "../pon-coordinate.mjs";
import { useAppContext } from "../app-context.js";

// ONU 安装查询。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "OnuInstallView",
  setup() {
    const ctx = useAppContext();
    const { currentConfigTemplates, defaultEthPortsForTemplate, handleConfigTemplateChange, state } = ctx;

    const filteredUnregisteredRows = computed(() => {
      let rows = state.unregisteredRows || [];
      const filterOltHost = (state.installFilterOltHost || "").trim().toLowerCase();
      if (filterOltHost) {
        rows = rows.filter((r) => (r.oltHost || "").toLowerCase() === filterOltHost || (r.oltId || "").toLowerCase() === filterOltHost);
      }
      const kw = (state.installSearchKeyword || "").trim().toLowerCase();
      if (kw) {
        rows = rows.filter((r) => {
          const serial = (r.serial || "").toLowerCase();
          const addr = (r.address || "").toLowerCase();
          const host = (r.oltHost || "").toLowerCase();
          const coord = onuCoordinateLabel(r).toLowerCase();
          return serial.includes(kw) || addr.includes(kw) || host.includes(kw) || coord.includes(kw);
        });
      }
      return rows;
    });

    function getOltUnregisteredCount(oltHost) {
      if (!oltHost) return (state.unregisteredRows || []).length;
      const target = String(oltHost).toLowerCase();
      return (state.unregisteredRows || []).filter((r) => (r.oltHost || "").toLowerCase() === target || (r.oltId || "").toLowerCase() === target).length;
    }

    const installEmptyText = computed(() => {
      if (state.loading.install) return "正在并发扫描全网各 OLT 未注册 ONU，请稍候...";
      if (state.installFilterOltHost) {
        return "当前选中的 OLT (" + state.installFilterOltHost + ") 暂无未注册 ONU 设备。";
      }
      if (state.installSearchKeyword) {
        return "未匹配到包含「" + state.installSearchKeyword + "」的未注册 ONU。";
      }
      return state.installMessage || "全网所有已启用 OLT 暂未发现未注册 ONU 设备。";
    });

    function openConfigPlanDialog(row) {
      state.configPlan.visible = true;
      state.configPlan.row = row;
      state.configPlan.result = null;
      state.configPlan.templateId = currentConfigTemplates.value[0]?.id || "";
      state.configPlan.ethPorts = [...defaultEthPortsForTemplate.value];
      state.configPlan.customVlan = undefined;
      handleConfigTemplateChange();
    }

    return { ...ctx, filteredUnregisteredRows, getOltUnregisteredCount, installEmptyText, openConfigPlanDialog };
  }
};
</script>
