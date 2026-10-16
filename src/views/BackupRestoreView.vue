<template>
  <section>
    <div class="page-head"><div><h1>备份还原</h1></div></div>
    <el-card shadow="never" class="content-card">
      <el-alert title="还原备份将覆盖当前系统数据，请在确认备份文件安全后操作。" type="warning" :closable="false" show-icon />
      <div class="toolbar" style="margin-top: 18px">
        <el-button type="primary" @click="exportProjectBackup">导出组合备份</el-button>
        <el-button type="danger" @click="triggerProjectRestore">导入并还原</el-button>
        <input id="project-backup-input" type="file" accept=".json,.oltbackup,.sqlite,application/vnd.sqlite3" hidden @change="restoreProjectBackup" />
      </div>
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header><span>资料包（Mac ↔ Windows 搬运内勤资料）</span></template>
      <div class="muted data-package-tip">
        <p><strong>Windows → Mac：</strong>在 Windows 导出组合备份，到 Mac “导入并还原”。跨系统还原不会带走飞书机器人配置，Mac 会自动暂停定时同步和夜间采集，只作为资料副本。</p>
        <p><strong>Mac → Windows：</strong>在 Mac 补好资料后“导出资料包”，到 Windows “导入资料包”。只替换勾选的几类资料，Windows 上的飞书配置、查询日志、夜间采样、抢修档案和台账同步结果都不动；导入前会自动备份数据库。不要把 Mac 的整库还原到 Windows。</p>
      </div>
      <el-checkbox-group v-model="dataPackage.categories" class="data-package-categories">
        <el-checkbox v-for="item in DATA_PACKAGE_OPTIONS" :key="item.key" :value="item.key">{{ item.label }}</el-checkbox>
      </el-checkbox-group>
      <div class="toolbar">
        <el-button type="primary" :disabled="!dataPackage.categories.length" :loading="dataPackage.exporting" @click="exportDataPackage">导出资料包</el-button>
        <el-button @click="triggerDataPackageImport">导入资料包</el-button>
        <input id="data-package-input" type="file" accept=".json,application/json" hidden @change="inspectDataPackageFile" />
      </div>
    </el-card>

    <el-dialog v-model="dataPackage.visible" title="导入资料包" width="min(640px, 96vw)">
      <p class="muted">
        来自 {{ platformName(dataPackage.info.platform) }} · {{ dataPackage.info.appVersion || "未知版本" }} · 导出于 {{ localTime(dataPackage.info.createdAt) }}
      </p>
      <el-alert v-if="dataPackage.info.schemaVersion > dataPackage.info.localSchemaVersion" type="warning" :closable="false" show-icon
        title="资料包来自更新版本的程序，本机缺少的字段会被忽略，建议先把本机升级到同一版本。" />
      <el-table :data="dataPackageRows" size="small" class="data-package-table">
        <el-table-column label="导入" width="64">
          <template #default="{ row }">
            <el-checkbox v-if="row.first" :model-value="dataPackage.selected.includes(row.key)" :disabled="!row.included" @change="(checked) => toggleCategory(row.key, checked)" />
          </template>
        </el-table-column>
        <el-table-column label="类别" width="150"><template #default="{ row }">{{ row.first ? row.label : "" }}</template></el-table-column>
        <el-table-column label="内容" min-width="120"><template #default="{ row }">{{ TABLE_NAMES[row.table] || row.table }}</template></el-table-column>
        <el-table-column label="资料包" width="90" align="right"><template #default="{ row }">{{ row.packageRows ?? "—" }}</template></el-table-column>
        <el-table-column label="本机现有" width="90" align="right"><template #default="{ row }">{{ row.localRows }}</template></el-table-column>
      </el-table>
      <p class="muted">勾选的类别会整类替换成资料包里的内容（本机现有的这几类会被覆盖），其余数据不变。</p>
      <template #footer>
        <el-button @click="dataPackage.visible = false">取消</el-button>
        <el-button type="danger" :disabled="!dataPackage.selected.length" :loading="dataPackage.importing" @click="importDataPackage">导入并替换所选资料</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { downloadBlob } from "../renderer-services.js";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { detectBackupFormat } from "../backup-format.mjs";
import { isEncryptedBackupFile } from "../backup-view-state.mjs";
import { useAppContext } from "../app-context.js";
import { computed, reactive } from "vue";

const DATA_PACKAGE_OPTIONS = Object.freeze([
  { key: "places", label: "用户归属" },
  { key: "regions", label: "区域字典" },
  { key: "ponLedger", label: "PON 台账" },
  { key: "agentKnowledge", label: "Gd 知识与资料修正" }
]);
const TABLE_NAMES = Object.freeze({
  pon_place_assignments: "按口指定",
  place_rules: "批量规则",
  onu_place_overrides: "单户修正",
  village_regions: "村和小组",
  pon_ports: "PON 口台账行",
  agent_learned_memories: "Gd 规约记忆",
  agent_user_corrections: "电话 / 地址修正"
});

// 备份还原。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "BackupRestoreView",
  setup() {
    const ctx = useAppContext();
    const { backupApi } = ctx;
    const dataPackage = reactive({
      categories: DATA_PACKAGE_OPTIONS.map((item) => item.key),
      exporting: false,
      importing: false,
      visible: false,
      pkg: null,
      info: { categories: [] },
      selected: []
    });
    const dataPackageRows = computed(() => (dataPackage.info.categories || []).flatMap((category) =>
      category.tables.map((table, index) => ({ ...table, key: category.key, label: category.label, included: category.included, first: index === 0 }))));

    function toggleCategory(key, checked) {
      dataPackage.selected = checked
        ? [...new Set([...dataPackage.selected, key])]
        : dataPackage.selected.filter((item) => item !== key);
    }

    function platformName(value) {
      return { darwin: "Mac", win32: "Windows", linux: "Linux" }[value] || value || "未知系统";
    }

    function localTime(value) {
      const time = Date.parse(value || "");
      return Number.isFinite(time) ? new Date(time).toLocaleString("zh-CN", { hour12: false }) : "—";
    }

    async function exportDataPackage() {
      dataPackage.exporting = true;
      try {
        const pkg = await backupApi.exportDataPackage(dataPackage.categories);
        const host = { darwin: "mac", win32: "win" }[pkg.platform] || pkg.platform || "pc";
        downloadBlob(new Blob([JSON.stringify(pkg)], { type: "application/json" }), `olt-manager-data-package-${host}-${new Date().toISOString().slice(0, 10)}.json`);
        ElMessage.success("资料包已导出");
      } catch (error) {
        ElMessage.error(error.message || "导出资料包失败");
      } finally {
        dataPackage.exporting = false;
      }
    }

    function triggerDataPackageImport() { document.getElementById("data-package-input")?.click(); }

    async function inspectDataPackageFile(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        let pkg;
        try {
          pkg = JSON.parse(await file.text());
        } catch {
          throw new Error("不是有效的资料包文件。");
        }
        const info = await backupApi.inspectDataPackage(pkg);
        Object.assign(dataPackage, {
          pkg,
          info,
          selected: info.categories.filter((category) => category.included).map((category) => category.key),
          visible: true
        });
      } catch (error) {
        ElMessage.error(error.message || "资料包无法识别");
      }
    }

    async function importDataPackage() {
      const labels = DATA_PACKAGE_OPTIONS.filter((item) => dataPackage.selected.includes(item.key)).map((item) => item.label).join("、");
      try {
        await ElMessageBox.confirm(`将用资料包替换本机的：${labels}。导入前会自动备份数据库。确认继续？`, "确认导入资料包", { type: "warning", confirmButtonText: "确认导入" });
        dataPackage.importing = true;
        const result = await backupApi.importDataPackage(dataPackage.pkg, dataPackage.selected);
        dataPackage.visible = false;
        const rows = result.imported.reduce((sum, item) => sum + item.rows, 0);
        ElMessage.success(`已导入 ${rows} 条资料，重新计算了 ${result.placesRecomputed || 0} 户归属；导入前的备份已保存`);
      } catch (error) {
        if (error !== "cancel" && error !== "close") ElMessage.error(error.message || "导入资料包失败");
      } finally {
        dataPackage.importing = false;
      }
    }

    async function exportProjectBackup() {
      try {
        if (window.oltManagerDesktop?.feishuBackup) {
          const bytes = await window.oltManagerDesktop.feishuBackup.export();
          downloadBlob(new Blob([bytes], { type: "application/json" }), `olt-manager-combined-backup-${new Date().toISOString().slice(0, 10)}.oltbackup.json`);
          ElMessage.success("OLT 与 Feishu 组合备份已导出");
          return;
        }
        downloadBlob(await backupApi.exportSqlite(), `olt-manager-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
        ElMessage.success("完整项目备份已导出");
      } catch (error) { ElMessage.error(error.message); }
    }

    function triggerProjectRestore() { document.getElementById("project-backup-input")?.click(); }

    async function restoreProjectBackup(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const format = detectBackupFormat({ name: file.name, type: file.type, bytes });
        // 加密 SQLite 备份已于 1.2.6 下线，误选时给出明确提示，不再要求输入主密码。
        if (isEncryptedBackupFile(file)) throw new Error("加密备份（.sqlite.enc）功能已下线，请使用 .sqlite 或 .oltbackup.json 备份文件还原。");
        if (format === "unknown") throw new Error("无法识别备份文件，请选择 WEB 导出的 .sqlite 或桌面端导出的 .oltbackup.json。");
        const isCombined = format === "combined-json";
        const title = isCombined ? "确认还原组合备份" : "确认还原 SQLite 备份";
        const message = isCombined
          ? "还原会覆盖当前本机 SQLite、Feishu 加密状态和授权配置，且无法撤销。确认继续？"
          : "还原会覆盖当前本机 SQLite 数据，且无法撤销。Feishu 加密状态不会随 WEB 的 SQLite 文件迁移。确认继续？";
        await ElMessageBox.confirm(message, title, { type: "warning", confirmButtonText: "确认还原" });
        if (isCombined) {
          if (!window.oltManagerDesktop?.feishuBackup) {
            throw new Error("WEB 模式不能还原桌面组合备份，请在桌面程序中导入。");
          }
          const result = await window.oltManagerDesktop.feishuBackup.restore({ bytes, confirmed: true });
          ElMessage.success(result.warnings?.join("；") || "组合备份还原成功，正在刷新页面");
          window.setTimeout(() => window.location.reload(), 500);
          return;
        }
        if (window.oltManagerDesktop?.databaseBackup) {
          const result = await window.oltManagerDesktop.databaseBackup.restore({ bytes, confirmed: true });
          ElMessage.success(result.warnings?.join("；") || "SQLite 数据库还原成功，正在刷新页面");
          window.setTimeout(() => window.location.reload(), 500);
          return;
        }
        await backupApi.restoreSqlite(file);
        ElMessage.success("还原成功，正在刷新页面");
        window.setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        if (error !== "cancel") ElMessage.error(error.message || "备份还原失败");
      }
    }

    return { ...ctx, DATA_PACKAGE_OPTIONS, TABLE_NAMES, dataPackage, dataPackageRows, toggleCategory, platformName, localTime,
      exportProjectBackup, triggerProjectRestore, restoreProjectBackup, exportDataPackage, triggerDataPackageImport, inspectDataPackageFile, importDataPackage };
  }
};
</script>

<style scoped>
.data-package-tip p { margin: 0 0 6px; line-height: 1.6; }
.data-package-categories { margin: 8px 0 12px; }
.data-package-table { margin: 10px 0; }
</style>
