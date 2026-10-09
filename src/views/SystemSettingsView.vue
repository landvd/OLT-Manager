<template>
  <section>
    <div class="page-head"><div><h1>系统设置</h1></div></div>
    <el-card shadow="never" class="content-card settings-card">
      <template #header>本机登录保护</template>
      <div class="settings-row">
        <div class="settings-text">
          <strong>{{ state.authRequired ? "已开启：打开管理页面需要输入本地密码" : "已关闭：本机打开管理页面无需密码" }}</strong>
          <p class="muted">关闭后仅本机访问免密码，局域网访问仍强制要求密码。现场正式使用建议保持开启。</p>
        </div>
        <!-- 不用 v-model：确认框取消时开关状态保持不变 -->
        <el-switch
          :model-value="state.authRequired"
          :loading="state.authToggleLoading"
          active-text="开启"
          inactive-text="关闭"
          @change="toggleAuthRequirement"
        />
      </div>
    </el-card>
    <el-card shadow="never" class="content-card settings-card">
      <template #header>夜间光功率基线</template>
      <div class="settings-row">
        <div class="settings-text">
          <strong>{{ baselineHeadline }}</strong>
          <p class="muted">每天对已启用的 OLT 只读采集一次 ONU 收光功率。断纤恢复后，飞书“查某村抢修情况”会逐户对比断纤前 7 晚的中位数，标出变差 2 dB 以上需要重新熔接的用户。电脑夜间关机时，开机后会自动补采当天数据。</p>
          <p v-if="baseline.coverage.nights" class="muted">已积累 {{ baseline.coverage.nights }} 晚数据（{{ baseline.coverage.firstDate }} 至 {{ baseline.coverage.lastDate }}）<template v-if="baseline.coverage.nights < 3">，至少积累 3 晚后对比结果才可靠</template>。</p>
          <p v-if="lastRunText" class="muted">{{ lastRunText }}</p>
        </div>
        <div class="settings-actions">
          <el-switch
            :model-value="baseline.enabled"
            :loading="baseline.saving"
            active-text="开启"
            inactive-text="关闭"
            @change="(value) => saveBaseline({ enabled: value })"
          />
          <el-select
            :model-value="baseline.runHour"
            size="small"
            class="baseline-hour"
            :disabled="!baseline.enabled || baseline.saving"
            @change="(value) => saveBaseline({ runHour: value })"
          >
            <el-option v-for="hour in baselineHours" :key="hour" :label="`每天 ${hour}:00`" :value="hour" />
          </el-select>
          <el-button size="small" :loading="baseline.running" @click="runBaselineNow">立即采集一次</el-button>
        </div>
      </div>
    </el-card>
    <el-card shadow="never" class="content-card settings-card">
      <template #header>版本信息</template>
      <div class="settings-row">
        <div class="settings-text">
          <strong>OLT 管理系统 v{{ state.version || "0.0.0" }}</strong>
          <p class="muted">升级请使用“系统更新”页选择增量包。</p>
        </div>
        <el-button @click="setView('systemUpdate')">前往系统更新</el-button>
      </div>
    </el-card>
  </section>
</template>

<script>
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { useAppContext } from "../app-context.js";

const RUN_STATUS_TEXT = Object.freeze({
  success: "成功",
  partial: "部分 OLT 失败",
  failed: "失败",
  running: "进行中",
  interrupted: "中断"
});

// 系统设置：本机登录保护、夜间光功率基线等系统级开关。
export default {
  name: "SystemSettingsView",
  setup() {
    const ctx = useAppContext();
    const { fieldRepairApi } = ctx;
    const baseline = reactive({
      enabled: true,
      runHour: 2,
      running: false,
      progress: null,
      saving: false,
      nextRunAt: "",
      recentRuns: [],
      coverage: { nights: 0, firstDate: "", lastDate: "" }
    });
    const baselineHours = [0, 1, 2, 3, 4, 5, 6, 22, 23];
    let pollTimer = null;

    const baselineHeadline = computed(() => {
      if (!baseline.enabled) return "已关闭：不采集夜间光功率，抢修查询只能随机抽样对比";
      if (baseline.running) {
        const progress = baseline.progress;
        if (!progress) return "正在采集，逐个 PON 口读取，整网通常需要几分钟";
        const pons = progress.ponTotal ? `，PON 口 ${progress.ponDone}/${progress.ponTotal}` : "";
        return `正在采集：第 ${progress.oltIndex}/${progress.oltCount} 台 OLT（${progress.oltName}）${pons}`;
      }
      const next = baseline.nextRunAt ? new Date(baseline.nextRunAt) : null;
      return next && !Number.isNaN(next.getTime())
        ? `已开启：下次采集 ${next.toLocaleString("zh-CN", { hour12: false })}`
        : `已开启：每天 ${baseline.runHour}:00 采集`;
    });

    const lastRunText = computed(() => {
      const run = baseline.recentRuns[0];
      if (!run) return "";
      const when = new Date(run.completedAt || run.startedAt).toLocaleString("zh-CN", { hour12: false });
      const status = RUN_STATUS_TEXT[run.status] || run.status;
      const detail = run.status === "running" ? "" : `，${run.oltCount} 台 OLT、${run.onuCount} 个 ONU`;
      return `最近一次：${when} ${run.trigger === "manual" ? "手动" : "定时"}采集${status}${detail}${run.error ? `（${run.error}）` : ""}`;
    });

    function applyStatus(data) {
      Object.assign(baseline, {
        enabled: data.enabled !== false,
        runHour: Number(data.runHour ?? 2),
        running: Boolean(data.running),
        progress: data.progress || null,
        nextRunAt: data.nextRunAt || "",
        recentRuns: Array.isArray(data.recentRuns) ? data.recentRuns : [],
        coverage: data.coverage || baseline.coverage
      });
    }

    function stopPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }

    async function loadBaseline() {
      try {
        applyStatus(await fieldRepairApi.baselineStatus());
        if (!baseline.running) stopPolling();
      } catch (error) {
        stopPolling();
        ElMessage.error(error.message || "读取夜间光功率基线状态失败");
      }
    }

    async function saveBaseline(change) {
      baseline.saving = true;
      try {
        await fieldRepairApi.saveBaselineSettings({ enabled: baseline.enabled, runHour: baseline.runHour, ...change });
        await loadBaseline();
        ElMessage.success("夜间光功率采集设置已保存");
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
      } finally {
        baseline.saving = false;
      }
    }

    async function runBaselineNow() {
      try {
        await fieldRepairApi.runBaselineNow();
        baseline.running = true;
        ElMessage.success("已开始采集，完成后此处会更新结果");
        stopPolling();
        pollTimer = setInterval(loadBaseline, 3000);
      } catch (error) {
        ElMessage.error(error.message || "启动采集失败");
      }
    }

    onMounted(loadBaseline);
    onBeforeUnmount(stopPolling);

    return { ...ctx, baseline, baselineHours, baselineHeadline, lastRunText, saveBaseline, runBaselineNow };
  }
};
</script>
