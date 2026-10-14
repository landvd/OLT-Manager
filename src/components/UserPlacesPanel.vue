<template>
  <div class="places-panel">
    <el-card shadow="never" class="content-card">
      <div class="places-summary">
        <div class="places-stat"><span class="muted">合并台账</span><strong>{{ summary.totalUsers }}</strong></div>
        <div class="places-stat"><span class="muted">已归村</span><strong>{{ assignedVillageUsers }}</strong></div>
        <div class="places-stat"><span class="muted">小区</span><strong>{{ communityUsers }}</strong></div>
        <div class="places-stat places-stat-warn" @click="showUnassigned">
          <span class="muted">未归村（点击查看）</span><strong>{{ summary.unassigned }}</strong>
        </div>
        <div class="places-stat"><span class="muted">地址为空</span><strong>{{ summary.emptyAddress }}</strong></div>
        <div class="places-summary-actions">
          <span class="muted">计算于 {{ localTime(summary.computedAt) }}</span>
          <el-button :loading="state.loading" @click="loadAll">刷新</el-button>
        </div>
      </div>
      <p class="muted places-tip">
        村按“单户修正 → 批量规则 → 区域字典改归属 → 地址自动识别”的顺序确定，小组取本村已通过的区域字典小组，小区由小区规则确定、与村互不影响。台账同步、字典或规则修改后自动重算。
      </p>
    </el-card>

    <div class="places-grid">
      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="places-card-head">
            <span>未归村地址建议（按户数）</span>
            <el-button size="small" @click="openRule(null)">新增规则</el-button>
          </div>
        </template>
        <el-table :data="suggestions" size="small" max-height="360" empty-text="没有未归村的地址">
          <el-table-column label="地址开头" min-width="130">
            <template #default="{ row }">
              <span :title="row.samples.join('\n')">{{ row.keyword }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="count" label="户数" width="70" align="right" />
          <el-table-column label="批量设置" width="170">
            <template #default="{ row }">
              <el-button link type="primary" @click="openRule(null, { kind: 'community', target: row.keyword, include: row.keyword })">设为小区</el-button>
              <el-button link type="primary" @click="openRule(null, { kind: 'village', target: '', include: row.keyword })">归到村…</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="content-card">
        <template #header><span>批量规则（{{ rules.length }}）</span></template>
        <el-table :data="rules" size="small" max-height="360" empty-text="还没有批量规则">
          <el-table-column label="类型" width="70">
            <template #default="{ row }"><el-tag size="small" :type="row.kind === 'community' ? 'success' : 'primary'">{{ row.kind === "community" ? "小区" : "归村" }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="target" label="归属" min-width="100" />
          <el-table-column label="地址包含" min-width="140"><template #default="{ row }">{{ row.includeKeywords.join("，") }}</template></el-table-column>
          <el-table-column label="排除" min-width="90"><template #default="{ row }">{{ row.excludeKeywords.join("，") || "—" }}</template></el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="{ row }">
              <el-button link @click="openRule(row)">编辑</el-button>
              <el-button link type="danger" @click="removeRule(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="places-card-head">
          <span>按村 / 小区查看用户</span>
          <span class="muted">共 {{ users.total }} 户{{ users.total > users.rows.length ? `，显示前 ${users.rows.length} 户` : "" }}</span>
        </div>
      </template>
      <div class="places-filters">
        <el-select v-model="filters.village" clearable filterable placeholder="村" @change="onVillageChange">
          <el-option v-for="item in summary.villages" :key="item.village" :label="`${item.village}（${item.users}）`" :value="item.village" />
        </el-select>
        <el-select v-model="filters.group" clearable filterable placeholder="小组" :disabled="!groupOptions.length" @change="loadUsers">
          <el-option v-for="item in groupOptions" :key="item.name" :label="`${item.name}（${item.users}）`" :value="item.name" />
        </el-select>
        <el-select v-model="filters.community" clearable filterable placeholder="小区" @change="loadUsers">
          <el-option v-for="item in summary.communities" :key="item.name" :label="`${item.name}（${item.users}）`" :value="item.name" />
        </el-select>
        <el-checkbox v-model="filters.unassigned" @change="loadUsers">只看未归村</el-checkbox>
        <el-checkbox v-model="filters.includeEmpty" :disabled="!filters.unassigned" @change="loadUsers">含地址为空</el-checkbox>
        <el-checkbox v-model="filters.recommended" @change="loadUsers">只看有推荐</el-checkbox>
        <el-input v-model="filters.q" clearable placeholder="姓名 / 地址 / LOID" @keyup.enter="loadUsers" @clear="loadUsers" />
        <el-button type="primary" :loading="state.usersLoading" @click="loadUsers">查询</el-button>
      </div>
      <div class="places-recommend-bar">
        <span class="muted">推荐：同一 PON 口上已归村的户里，某村至少 3 户且占 60% 以上。采纳后记为单户修正，可再改。</span>
        <el-button size="small" type="success" :disabled="!selectedRecommended.length" :loading="state.accepting" @click="acceptRecommendations(selectedRecommended)">
          采纳所选推荐（{{ selectedRecommended.length }}）
        </el-button>
        <el-button size="small" :disabled="!pageRecommended.length" :loading="state.accepting" @click="acceptRecommendations(pageRecommended, true)">
          采纳本页全部推荐（{{ pageRecommended.length }}）
        </el-button>
      </div>
      <el-table v-loading="state.usersLoading" :data="users.rows" size="small" max-height="460" empty-text="没有符合条件的用户" @selection-change="(rows) => (state.selected = rows)">
        <el-table-column type="selection" width="40" :selectable="(row) => Boolean(row.recommendation)" />
        <el-table-column prop="username" label="姓名" width="100" />
        <el-table-column prop="installationAddress" label="装机地址" min-width="260" show-overflow-tooltip />
        <el-table-column label="坐标" width="96"><template #default="{ row }">{{ row.board }}/{{ row.pon }}:{{ row.onuId }}</template></el-table-column>
        <el-table-column label="村" width="100"><template #default="{ row }">{{ row.village || "—" }}</template></el-table-column>
        <el-table-column label="小组" width="100"><template #default="{ row }">{{ row.villageGroup || "—" }}</template></el-table-column>
        <el-table-column label="小区" width="110"><template #default="{ row }">{{ row.community || "—" }}</template></el-table-column>
        <el-table-column label="推荐" width="210">
          <template #default="{ row }">
            <template v-if="row.recommendation">
              {{ row.recommendation.village }}<span class="muted">（同口 {{ row.recommendation.count }}/{{ row.recommendation.assigned }}）</span>
              <el-button link type="success" @click="acceptRecommendations([row])">采纳</el-button>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="80">
          <template #default="{ row }"><el-tag v-if="row.placeSource" size="small" :type="SOURCE_TAGS[row.placeSource]?.type">{{ SOURCE_TAGS[row.placeSource]?.text }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="70" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="openOverride(row)">修正</el-button></template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="ruleEditor.visible" :title="ruleEditor.id ? '编辑批量规则' : '新增批量规则'" width="min(560px, 94vw)">
      <el-form label-width="96px">
        <el-form-item label="类型">
          <el-radio-group v-model="ruleEditor.kind">
            <el-radio-button value="village">归到村</el-radio-button>
            <el-radio-button value="community">设为小区</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="ruleEditor.kind === 'community' ? '小区名' : '村名'">
          <el-autocomplete v-if="ruleEditor.kind === 'village'" v-model="ruleEditor.target" class="place-input" clearable :fetch-suggestions="suggestVillages" placeholder="例如：赤岭村（可直接输入）" />
          <el-input v-else v-model="ruleEditor.target" placeholder="例如：万达广场" />
        </el-form-item>
        <el-form-item label="地址包含">
          <el-input v-model="ruleEditor.include" type="textarea" :rows="2" placeholder="地址包含任一关键词即命中，用逗号分隔" />
        </el-form-item>
        <el-form-item label="排除">
          <el-input v-model="ruleEditor.exclude" type="textarea" :rows="2" placeholder="地址包含这些词时不命中" />
        </el-form-item>
        <el-form-item label="预览">
          <div class="places-preview">
            <el-button size="small" :loading="ruleEditor.previewing" @click="previewRule">看看会命中哪些户</el-button>
            <template v-if="ruleEditor.preview">
              <div>命中 <strong>{{ ruleEditor.preview.matched }}</strong> 户，其中目前未归村 {{ ruleEditor.preview.unassigned }} 户</div>
              <div v-for="(sample, index) in ruleEditor.preview.samples" :key="index" class="muted places-preview-row">
                {{ sample.address }}<template v-if="sample.place">（现在：{{ sample.place }}）</template>
              </div>
            </template>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="ruleEditor.saving" @click="saveRule">保存并重算</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="overrideEditor.visible" title="单户修正归属" width="min(480px, 94vw)">
      <p class="muted">{{ overrideEditor.username }} · {{ overrideEditor.address }}</p>
      <p class="muted">按 LOID（{{ overrideEditor.loid || "无" }}）记住这一户{{ overrideEditor.loid ? "" : "，没有 LOID 时按坐标" }}，台账同步后仍然有效。三项都清空即恢复按规则计算。</p>
      <el-form label-width="64px">
        <el-form-item label="村">
          <el-autocomplete v-model="overrideEditor.village" class="place-input" clearable :fetch-suggestions="suggestVillages" placeholder="按规则（可直接输入）" />
        </el-form-item>
        <el-form-item label="小组"><el-input v-model="overrideEditor.villageGroup" clearable placeholder="按规则" /></el-form-item>
        <el-form-item label="小区">
          <el-autocomplete v-model="overrideEditor.community" class="place-input" clearable :fetch-suggestions="suggestCommunities" placeholder="按规则（可直接输入）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="overrideEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="overrideEditor.saving" @click="saveOverride">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { useAppContext } from "../app-context.js";

const SOURCE_TAGS = Object.freeze({
  manual: { type: "danger", text: "人工" },
  port: { type: "primary", text: "按口" },
  rule: { type: "warning", text: "规则" },
  dictionary: { type: "success", text: "字典" },
  address: { type: "info", text: "地址" }
});

// 用户归属（村 / 小组 / 小区）：未归村建议、批量规则、按村查看和单户修正（ADR-087）。只读写本地 SQLite。
export default {
  name: "UserPlacesPanel",
  setup() {
    const { fieldRepairApi } = useAppContext();
    const state = reactive({ loading: false, usersLoading: false, accepting: false, selected: [] });
    const summary = reactive({ totalUsers: 0, unassigned: 0, emptyAddress: 0, villages: [], communities: [], computedAt: "" });
    const suggestions = ref([]);
    const rules = ref([]);
    const users = reactive({ total: 0, rows: [] });
    // 默认打开未归村清单，内勤直接看到待处理的户。
    const filters = reactive({ village: "", group: "", community: "", unassigned: true, includeEmpty: false, recommended: false, q: "" });
    const ruleEditor = reactive({ visible: false, saving: false, previewing: false, id: 0, kind: "village", target: "", include: "", exclude: "", preview: null });
    const overrideEditor = reactive({ visible: false, saving: false, row: null, username: "", address: "", loid: "", village: "", villageGroup: "", community: "" });

    // 数据库记录的是 UTC（CURRENT_TIMESTAMP），显示成本地时间。
    function localTime(value) {
      const time = Date.parse(`${String(value || "").replace(" ", "T")}Z`);
      return Number.isFinite(time) ? new Date(time).toLocaleString("zh-CN", { hour12: false }) : "—";
    }

    const assignedVillageUsers = computed(() => summary.villages.reduce((sum, item) => sum + item.users, 0));
    const communityUsers = computed(() => summary.communities.reduce((sum, item) => sum + item.users, 0));
    const selectedRecommended = computed(() => state.selected.filter((row) => row.recommendation));
    const pageRecommended = computed(() => users.rows.filter((row) => row.recommendation));

    // 采纳推荐：把推荐的村写成单户修正（保留该户已有的小组、小区修正）。
    async function acceptRecommendations(rows, confirmAll = false) {
      const items = rows.filter((row) => row.recommendation).map((row) => ({
        loid: row.loid, oltIp: row.oltIp, chassis: row.chassis, board: row.board, pon: row.pon, onuId: row.onuId,
        village: row.recommendation.village
      }));
      if (!items.length) return;
      try {
        if (confirmAll) {
          await ElMessageBox.confirm(`按 PON 口推荐，把本页 ${items.length} 户写入对应的村？以后可以逐户再修正。`, "采纳推荐", { type: "warning" });
        }
        state.accepting = true;
        const data = await fieldRepairApi.acceptPlaceRecommendations(items);
        ElMessage.success(`已采纳 ${data.saved} 户`);
        await Promise.all([loadSummary(), loadUsers()]);
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "采纳失败");
      } finally {
        state.accepting = false;
      }
    }

    // 输入框可直接填新名称（不需要回车确认），下拉只是已有名称的提示。
    const suggestFrom = (names) => (query, callback) => {
      const keyword = String(query || "").trim();
      callback(names().filter((name) => !keyword || name.includes(keyword)).slice(0, 50).map((value) => ({ value })));
    };
    const suggestVillages = suggestFrom(() => summary.villages.map((item) => item.village));
    const suggestCommunities = suggestFrom(() => summary.communities.map((item) => item.name));

    const groupOptions = computed(() => summary.villages.find((item) => item.village === filters.village)?.groups || []);

    async function loadSummary() {
      Object.assign(summary, await fieldRepairApi.placeSummary());
    }

    async function loadAll() {
      state.loading = true;
      try {
        const [, suggested, ruleList] = await Promise.all([loadSummary(), fieldRepairApi.placeSuggestions(30), fieldRepairApi.placeRules()]);
        suggestions.value = suggested.rows || [];
        rules.value = ruleList.rows || [];
        await loadUsers();
      } catch (error) {
        ElMessage.error(error.message || "读取用户归属失败");
      } finally {
        state.loading = false;
      }
    }

    async function loadUsers() {
      state.usersLoading = true;
      state.selected = [];
      try {
        const data = await fieldRepairApi.placeUsers({ ...filters, limit: 300 });
        users.total = data.total;
        users.rows = data.rows || [];
      } catch (error) {
        ElMessage.error(error.message || "读取用户失败");
      } finally {
        state.usersLoading = false;
      }
    }

    function onVillageChange() {
      filters.group = "";
      void loadUsers();
    }

    function showUnassigned() {
      Object.assign(filters, { village: "", group: "", community: "", unassigned: true, includeEmpty: false, recommended: false, q: "" });
      void loadUsers();
    }

    function openRule(row, preset = null) {
      Object.assign(ruleEditor, row
        ? { id: row.id, kind: row.kind, target: row.target, include: row.includeKeywords.join("，"), exclude: row.excludeKeywords.join("，") }
        : { id: 0, kind: preset?.kind || "village", target: preset?.target || "", include: preset?.include || "", exclude: "" });
      ruleEditor.preview = null;
      ruleEditor.visible = true;
      if (ruleEditor.include) void previewRule();
    }

    function rulePayload() {
      return { kind: ruleEditor.kind, target: ruleEditor.target, includeKeywords: ruleEditor.include, excludeKeywords: ruleEditor.exclude };
    }

    async function previewRule() {
      ruleEditor.previewing = true;
      try {
        ruleEditor.preview = await fieldRepairApi.previewPlaceRule(rulePayload());
      } catch (error) {
        ElMessage.error(error.message || "预览失败");
      } finally {
        ruleEditor.previewing = false;
      }
    }

    async function saveRule() {
      ruleEditor.saving = true;
      try {
        const data = ruleEditor.id
          ? await fieldRepairApi.updatePlaceRule(ruleEditor.id, rulePayload())
          : await fieldRepairApi.createPlaceRule(rulePayload());
        ruleEditor.visible = false;
        ElMessage.success(`已保存，重新计算了 ${data.changed || 0} 户`);
        await loadAll();
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
      } finally {
        ruleEditor.saving = false;
      }
    }

    async function removeRule(row) {
      try {
        await ElMessageBox.confirm(`删除规则“${row.target}”？命中的用户会恢复按其他规则或地址计算。`, "删除规则", { type: "warning" });
        await fieldRepairApi.deletePlaceRule(row.id);
        await loadAll();
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除失败");
      }
    }

    function openOverride(row) {
      Object.assign(overrideEditor, {
        visible: true,
        row,
        username: row.username,
        address: row.installationAddress,
        loid: row.loid,
        village: row.placeSource === "manual" ? row.village : "",
        villageGroup: row.placeSource === "manual" ? row.villageGroup : "",
        community: row.placeSource === "manual" ? row.community : ""
      });
    }

    async function saveOverride() {
      overrideEditor.saving = true;
      try {
        const { row } = overrideEditor;
        await fieldRepairApi.savePlaceOverride({
          loid: row.loid,
          oltIp: row.oltIp,
          chassis: row.chassis,
          board: row.board,
          pon: row.pon,
          onuId: row.onuId,
          village: overrideEditor.village,
          villageGroup: overrideEditor.villageGroup,
          community: overrideEditor.community
        });
        overrideEditor.visible = false;
        ElMessage.success("已保存");
        await Promise.all([loadSummary(), loadUsers()]);
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
      } finally {
        overrideEditor.saving = false;
      }
    }

    onMounted(loadAll);

    return {
      SOURCE_TAGS, state, summary, suggestions, rules, users, filters, ruleEditor, overrideEditor,
      assignedVillageUsers, communityUsers, groupOptions, suggestVillages, suggestCommunities, selectedRecommended, pageRecommended, acceptRecommendations,
      localTime, loadAll, loadUsers, onVillageChange, showUnassigned, openRule, previewRule, saveRule, removeRule, openOverride, saveOverride
    };
  }
};
</script>

<style scoped>
.places-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px; }
.places-stat { display: flex; flex-direction: column; gap: 2px; }
.places-stat strong { font-size: 20px; }
.places-stat-warn { cursor: pointer; }
.places-stat-warn strong { color: var(--el-color-warning); }
.places-summary-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.places-tip { margin: 10px 0 0; }
.places-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
.places-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.places-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.places-filters .el-select { width: 170px; }
.places-filters .el-input { width: 200px; }
.places-recommend-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.places-preview { display: flex; flex-direction: column; gap: 4px; }
.places-preview-row { font-size: 12px; }
</style>
