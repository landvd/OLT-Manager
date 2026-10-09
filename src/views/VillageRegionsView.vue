<template>
  <section>
    <div class="page-head">
      <div>
        <h1>区域字典</h1>
        <p>把大村拆成小组，飞书“查某村抢修情况”时先选小组，只检查该小组的 PON 口。</p>
      </div>
      <el-button :loading="page.loading" @click="loadRegions">刷新</el-button>
    </div>

    <el-card shadow="never" class="content-card">
      <div class="region-toolbar">
        <el-input
          v-model="page.villageInput"
          class="region-village-input"
          placeholder="输入村名，例如：厚街村"
          clearable
          @keyup.enter="openVillage(page.villageInput)"
        />
        <el-button type="primary" :loading="page.loading" @click="openVillage(page.villageInput)">查看</el-button>
        <el-button :loading="page.discovering" :disabled="!page.villageInput" @click="discover">
          <el-icon><MagicStick /></el-icon><span>自动识别小组</span>
        </el-button>
      </div>
      <div v-if="page.villages.length" class="region-villages">
        <span class="muted">已有字典：</span>
        <el-tag
          v-for="item in page.villages"
          :key="item.village"
          :type="item.village === page.village ? 'primary' : 'info'"
          :effect="item.village === page.village ? 'dark' : 'light'"
          class="region-village-tag"
          @click="openVillage(item.village)"
        >{{ item.village }}<template v-if="item.candidate"> · 待审核 {{ item.candidate }}</template></el-tag>
      </div>
    </el-card>

    <el-card v-if="page.village" shadow="never" class="content-card">
      <template #header>
        <div class="region-card-head">
          <span>{{ page.village }} · 地址含村名的用户 {{ page.villageUsers }} 户</span>
          <div class="region-card-actions">
            <el-radio-group v-model="page.statusFilter" size="small">
              <el-radio-button value="all">全部 {{ page.regions.length }}</el-radio-button>
              <el-radio-button value="candidate">待审核 {{ statusCount('candidate') }}</el-radio-button>
              <el-radio-button value="active">已通过 {{ statusCount('active') }}</el-radio-button>
              <el-radio-button value="rejected">已驳回 {{ statusCount('rejected') }}</el-radio-button>
            </el-radio-group>
            <el-button size="small" :disabled="!page.selected.length" @click="bulkSetStatus('active')">通过所选</el-button>
            <el-button size="small" :disabled="!page.selected.length" @click="bulkSetStatus('rejected')">驳回所选</el-button>
            <el-button size="small" type="primary" @click="openEditor(null)">新增小组</el-button>
          </div>
        </div>
      </template>
      <el-alert
        v-if="statusCount('candidate')"
        type="info"
        :closable="false"
        show-icon
        title="系统按地址自动识别的小组需要审核：名字不对可以改名，同一小组的不同写法可以加到“包含关键词”，误命中的地址写进“排除关键词”，明显不是小组的直接驳回。"
        class="region-tip"
      />
      <el-table
        :data="visibleRegions"
        row-key="id"
        size="small"
        empty-text="还没有小组，点击“自动识别小组”或“新增小组”"
        @selection-change="(rows) => (page.selected = rows)"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column prop="name" label="小组" min-width="110" />
        <el-table-column label="包含关键词" min-width="200">
          <template #default="{ row }">{{ row.includeKeywords.join("，") }}</template>
        </el-table-column>
        <el-table-column label="排除关键词" min-width="140">
          <template #default="{ row }">{{ row.excludeKeywords.join("，") || "—" }}</template>
        </el-table-column>
        <el-table-column prop="userCount" label="户数" width="70" align="right" sortable />
        <el-table-column prop="ponCount" label="PON 口" width="80" align="right" sortable />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status).type" size="small">{{ statusTag(row.status).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="270" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'active'" link type="primary" @click="setStatus(row, 'active')">通过</el-button>
            <el-button v-if="row.status !== 'rejected'" link type="warning" @click="setStatus(row, 'rejected')">驳回</el-button>
            <el-button link @click="openEditor(row)">编辑</el-button>
            <el-button link type="primary" @click="openPons(row)">PON 口</el-button>
            <el-button link type="danger" @click="removeRegion(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="ponEditor.visible" :title="`${ponEditor.name} · 抢修检查的 PON 口`" width="min(900px, 96vw)">
      <p class="muted region-pon-tip">
        系统按两条依据自动纳入：一级分光地址命中小组关键词（★）且该口有本村用户；或小组用户在该口不是零星沾边。勾选 / 取消勾选会覆盖自动判断，保存后飞书按这里的清单检查。
      </p>
      <el-table v-loading="ponEditor.loading" :data="ponEditor.pons" row-key="key" size="small" max-height="460" empty-text="没有相关 PON 口">
        <el-table-column label="纳入" width="64">
          <template #default="{ row }">
            <el-checkbox v-model="row.checked" />
          </template>
        </el-table-column>
        <el-table-column label="PON 口" min-width="150">
          <template #default="{ row }">{{ row.oltIp }} {{ row.chassis }}/{{ row.board }}/{{ row.pon }}</template>
        </el-table-column>
        <el-table-column label="一级分光地址" min-width="200">
          <template #default="{ row }"><span v-if="row.ledgerMatch">★ </span>{{ row.ledgerAddress || "—" }}</template>
        </el-table-column>
        <el-table-column label="小组户数 / 该口户数" width="150" align="right">
          <template #default="{ row }">{{ row.regionUsers }} / {{ row.ponUsers }}</template>
        </el-table-column>
        <el-table-column label="来源" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.manual" size="small" type="warning">手动{{ row.manual === "include" ? "勾选" : "剔除" }}</el-tag>
            <el-tag v-else-if="row.automatic" size="small" type="success">{{ row.ledgerMatch ? "分光点" : "用户" }}</el-tag>
            <el-tag v-else size="small" type="info">零星</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <span class="muted region-pon-count">已纳入 {{ ponEditor.pons.filter((pon) => pon.checked).length }} 个口</span>
        <el-button @click="ponEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="ponEditor.saving" @click="savePons">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editor.visible" :title="editor.id ? '编辑小组' : '新增小组'" width="min(520px, 94vw)">
      <el-form label-width="96px">
        <el-form-item label="所属村">
          <el-input :model-value="page.village" disabled />
        </el-form-item>
        <el-form-item label="小组名">
          <el-input v-model="editor.name" placeholder="例如：向北" />
        </el-form-item>
        <el-form-item label="包含关键词">
          <el-input v-model="editor.include" type="textarea" :rows="2" placeholder="地址包含任一关键词即属于本小组，用逗号分隔，例如：厚街村向北，厚街镇向北" />
        </el-form-item>
        <el-form-item label="排除关键词">
          <el-input v-model="editor.exclude" type="textarea" :rows="2" placeholder="地址包含这些词时不算本小组，例如：三屯村" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="editor.status">
            <el-radio-button value="active">已通过</el-radio-button>
            <el-radio-button value="candidate">待审核</el-radio-button>
            <el-radio-button value="rejected">已驳回</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editor.visible = false">取消</el-button>
        <el-button type="primary" :loading="editor.saving" @click="saveEditor">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { computed, onMounted, reactive } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { useAppContext } from "../app-context.js";

const STATUS_TAGS = Object.freeze({
  active: { type: "success", text: "已通过" },
  candidate: { type: "warning", text: "待审核" },
  rejected: { type: "info", text: "已驳回" }
});

// 区域字典审核页：村 → 小组 → 地址关键词。只读写本地 SQLite，不访问 OLT。
export default {
  name: "VillageRegionsView",
  setup() {
    const ctx = useAppContext();
    const { fieldRepairApi } = ctx;
    const page = reactive({
      villageInput: "",
      village: "",
      villageUsers: 0,
      villages: [],
      regions: [],
      selected: [],
      statusFilter: "all",
      loading: false,
      discovering: false
    });
    const editor = reactive({ visible: false, saving: false, id: 0, name: "", include: "", exclude: "", status: "active" });
    const ponEditor = reactive({ visible: false, loading: false, saving: false, id: 0, name: "", pons: [] });

    function applyPons(pons) {
      ponEditor.pons = (pons || []).map((pon) => ({ ...pon, checked: pon.included }));
    }

    async function openPons(row) {
      Object.assign(ponEditor, { visible: true, loading: true, id: row.id, name: row.name, pons: [] });
      try {
        applyPons((await fieldRepairApi.regionPons(row.id)).pons);
      } catch (error) {
        ElMessage.error(error.message || "读取 PON 口失败");
      } finally {
        ponEditor.loading = false;
      }
    }

    // 只保存与自动判断不同的部分：自动未纳入但勾选的记为手动勾选，自动纳入但取消的记为手动剔除。
    async function savePons() {
      ponEditor.saving = true;
      try {
        const include = ponEditor.pons.filter((pon) => pon.checked && !pon.automatic).map((pon) => pon.key);
        const exclude = ponEditor.pons.filter((pon) => !pon.checked && pon.automatic).map((pon) => pon.key);
        const data = await fieldRepairApi.saveRegionPons(ponEditor.id, { include, exclude });
        replaceRegion(data.region);
        applyPons(data.pons);
        ponEditor.visible = false;
        ElMessage.success(`已保存，${data.region.name} 纳入 ${data.region.ponCount} 个 PON 口`);
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
      } finally {
        ponEditor.saving = false;
      }
    }

    const visibleRegions = computed(() => page.statusFilter === "all"
      ? page.regions
      : page.regions.filter((region) => region.status === page.statusFilter));

    function statusCount(status) {
      return page.regions.filter((region) => region.status === status).length;
    }

    function statusTag(status) {
      return STATUS_TAGS[status] || STATUS_TAGS.candidate;
    }

    function sortRegions(regions) {
      return [...regions].sort((left, right) => right.userCount - left.userCount);
    }

    async function loadRegions() {
      page.loading = true;
      try {
        const data = await fieldRepairApi.listRegions(page.village);
        page.villages = data.villages || [];
        if (page.village) {
          page.regions = sortRegions(data.regions || []);
          page.villageUsers = Number(data.villageUsers || 0);
        }
      } catch (error) {
        ElMessage.error(error.message || "读取区域字典失败");
      } finally {
        page.loading = false;
      }
    }

    async function openVillage(value) {
      const village = String(value || "").replace(/\s+/g, "");
      if (village.length < 2) {
        ElMessage.warning("请输入村名，例如：厚街村");
        return;
      }
      page.villageInput = village;
      page.village = village;
      page.selected = [];
      await loadRegions();
    }

    async function discover() {
      const village = String(page.villageInput || "").replace(/\s+/g, "");
      if (village.length < 2) return;
      page.discovering = true;
      try {
        const data = await fieldRepairApi.discoverRegions(village);
        page.village = data.village;
        page.villageUsers = Number(data.villageUsers || 0);
        page.regions = sortRegions(data.regions || []);
        page.statusFilter = "all";
        ElMessage.success(`已识别 ${data.discoveredCount} 个小组候选，已审核或驳回的条目保持不变`);
        await loadRegions();
      } catch (error) {
        ElMessage.error(error.message || "自动识别小组失败");
      } finally {
        page.discovering = false;
      }
    }

    async function refreshVillages() {
      try {
        page.villages = (await fieldRepairApi.listRegions()).villages || [];
      } catch {
        // 顶部计数刷新失败不影响当前编辑。
      }
    }

    function replaceRegion(region) {
      const index = page.regions.findIndex((item) => item.id === region.id);
      if (index >= 0) page.regions.splice(index, 1, region);
      else page.regions.push(region);
    }

    async function setStatus(row, status) {
      try {
        const data = await fieldRepairApi.updateRegion(row.id, { status });
        replaceRegion(data.region);
        void refreshVillages();
      } catch (error) {
        ElMessage.error(error.message || "更新状态失败");
      }
    }

    async function bulkSetStatus(status) {
      const rows = [...page.selected];
      for (const row of rows) await setStatus(row, status);
      ElMessage.success(`已${status === "active" ? "通过" : "驳回"} ${rows.length} 个小组`);
      await loadRegions();
    }

    function openEditor(row) {
      Object.assign(editor, row
        ? { id: row.id, name: row.name, include: row.includeKeywords.join("，"), exclude: row.excludeKeywords.join("，"), status: row.status }
        : { id: 0, name: "", include: "", exclude: "", status: "active" });
      editor.visible = true;
    }

    async function saveEditor() {
      editor.saving = true;
      try {
        const payload = { name: editor.name, includeKeywords: editor.include, excludeKeywords: editor.exclude, status: editor.status };
        const data = editor.id
          ? await fieldRepairApi.updateRegion(editor.id, payload)
          : await fieldRepairApi.createRegion({ ...payload, village: page.village });
        replaceRegion(data.region);
        page.regions = sortRegions(page.regions);
        editor.visible = false;
        void refreshVillages();
        ElMessage.success(`已保存，匹配 ${data.region.userCount} 户 / ${data.region.ponCount} 个 PON 口`);
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
      } finally {
        editor.saving = false;
      }
    }

    async function removeRegion(row) {
      try {
        await ElMessageBox.confirm(`确认删除小组“${row.name}”？删除后再次自动识别可能会重新生成候选；不想再看到它请用“驳回”。`, "删除小组", { type: "warning" });
        await fieldRepairApi.deleteRegion(row.id);
        page.regions = page.regions.filter((item) => item.id !== row.id);
        void refreshVillages();
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除失败");
      }
    }

    onMounted(loadRegions);

    return { ...ctx, page, editor, ponEditor, openPons, savePons, visibleRegions, statusCount, statusTag, loadRegions, openVillage, discover, setStatus, bulkSetStatus, openEditor, saveEditor, removeRegion };
  }
};
</script>
