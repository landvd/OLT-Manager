<template>
  <section>
    <div class="page-head">
      <div>
        <h1>抢修档案</h1>
        <p>系统从夜间采集和飞书抢修查询中自动记下的断纤事件，以及据此推断的同缆组。</p>
      </div>
      <el-button :loading="page.loading" @click="reload">刷新</el-button>
    </div>

    <el-card shadow="never" class="content-card">
      <div class="agent-review-toolbar">
        <el-radio-group v-model="page.tab" @change="reload">
          <el-radio-button value="events">断纤事件</el-radio-button>
          <el-radio-button value="groups">同缆组</el-radio-button>
        </el-radio-group>
        <el-radio-group v-if="page.tab === 'events'" v-model="page.days" size="small" @change="reload">
          <el-radio-button :value="30">近 30 天</el-radio-button>
          <el-radio-button :value="90">近 90 天</el-radio-button>
          <el-radio-button :value="365">近一年</el-radio-button>
        </el-radio-group>
        <template v-else>
          <el-radio-group v-model="page.status" size="small" @change="reload">
            <el-radio-button value="candidate">待审核</el-radio-button>
            <el-radio-button value="active">已确认</el-radio-button>
            <el-radio-button value="rejected">已驳回</el-radio-button>
          </el-radio-group>
          <el-button size="small" :loading="page.refreshing" @click="refreshGroups">重新推断</el-button>
        </template>
      </div>

      <template v-if="page.tab === 'events'">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="region-tip"
          title="识别依据：夜间采集时整口 80% 以上离线；中兴 C300 同口多数用户在同一 10 分钟内因 LOS 离线（白天断、白天修好也能补记）；飞书抢修查询时发现整口离线。"
        />
        <el-table v-loading="page.loading" :data="page.events" size="small" empty-text="还没有断纤记录">
          <el-table-column label="断纤时间" width="170">
            <template #default="{ row }">{{ formatTime(row.startedAt) }}</template>
          </el-table-column>
          <el-table-column label="恢复" width="170">
            <template #default="{ row }">{{ row.recoveredAt ? formatTime(row.recoveredAt) : "未恢复" }}</template>
          </el-table-column>
          <el-table-column label="涉及 PON 口" min-width="320">
            <template #default="{ row }">
              <div v-for="pon in row.pons" :key="pon.ponKey" class="agent-review-sub">
                {{ pon.oltName }} {{ pon.coordinate }}<template v-if="pon.address"> · {{ pon.address }}</template>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="150">
            <template #default="{ row }">{{ row.sources.map(sourceLabel).join("、") }}</template>
          </el-table-column>
          <el-table-column label="抢修验收" min-width="200">
            <template #default="{ row }">
              <div v-for="item in row.inspections" :key="item.id" class="agent-review-sub">
                {{ item.queryValue }} · {{ verdictLabel(item.verdict) }}
              </div>
              <span v-if="!row.inspections.length" class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <template v-else>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="region-tip"
          title="在不同断纤事件中至少一起断过 2 次、且同断比例 60% 以上的 PON 口会被推断为同一条主干光缆。确认后，飞书抢修卡片会对组内的口给出“建议一并检查”提示。"
        />
        <el-table v-loading="page.loading" :data="page.groups" size="small" empty-text="还没有同缆组（需要积累多次断纤事件）">
          <el-table-column label="PON 口" min-width="360">
            <template #default="{ row }">
              <div v-for="pon in row.pons" :key="pon.ponKey" class="agent-review-sub">
                {{ pon.oltName }} {{ pon.coordinate }}<template v-if="pon.address"> · {{ pon.address }}</template>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="一起断过" width="110">
            <template #default="{ row }">{{ row.together === row.maxTogether ? row.together : `${row.together}–${row.maxTogether}` }} 次</template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status !== 'active'" link type="primary" @click="reviewGroup(row, 'active')">确认</el-button>
              <el-button v-if="row.status !== 'rejected'" link type="warning" @click="reviewGroup(row, 'rejected')">驳回</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-card>
  </section>
</template>

<script>
import { onMounted, reactive } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { useAppContext } from "../app-context.js";

const SOURCE_LABELS = Object.freeze({ "nightly-offline": "夜间采集（整口离线）", "offline-cluster": "离线记录（C300 LOS）", "feishu-query": "飞书抢修查询" });
const VERDICT_LABELS = Object.freeze({ pass: "可以封盒", warning: "需复核熔接", outage: "整口断纤", isolated: "需关注" });

// 抢修档案：断纤事件与同缆组审核。只读写本地 SQLite。
export default {
  name: "FieldArchiveView",
  setup() {
    const ctx = useAppContext();
    const { fieldRepairApi } = ctx;
    const page = reactive({ tab: "events", days: 90, status: "candidate", loading: false, refreshing: false, events: [], groups: [] });

    const sourceLabel = (value) => SOURCE_LABELS[value] || value;
    const verdictLabel = (value) => VERDICT_LABELS[value] || "已检查";
    const formatTime = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("zh-CN", { hour12: false });
    };

    async function reload() {
      page.loading = true;
      try {
        if (page.tab === "events") page.events = (await fieldRepairApi.outageEvents(page.days)).events || [];
        else page.groups = (await fieldRepairApi.cableGroups(page.status)).groups || [];
      } catch (error) {
        ElMessage.error(error.message || "读取失败");
      } finally {
        page.loading = false;
      }
    }

    async function refreshGroups() {
      page.refreshing = true;
      try {
        const data = await fieldRepairApi.refreshCableGroups();
        ElMessage.success(`已重新推断，共 ${data.inferred} 组`);
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "推断失败");
      } finally {
        page.refreshing = false;
      }
    }

    async function reviewGroup(row, status) {
      try {
        await fieldRepairApi.reviewCableGroup(row.id, { status });
        ElMessage.success(status === "active" ? "已确认，飞书抢修卡片会给出同缆提示" : "已驳回");
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "操作失败");
      }
    }

    onMounted(reload);

    return { ...ctx, page, sourceLabel, verdictLabel, formatTime, reload, refreshGroups, reviewGroup };
  }
};
</script>
