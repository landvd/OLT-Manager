<template>
  <section>
    <div class="page-head">
      <div>
        <h1>定时任务</h1>
      </div>
      <el-button :loading="state.resourceSchedule.loading" @click="loadResourceSchedules">刷新任务</el-button>
    </div>
    <el-card shadow="never" class="content-card resource-schedule-card">
      <template #header>新增同步任务</template>
      <el-form label-position="top" class="resource-schedule-form">
        <el-form-item label="执行日期" required>
          <el-date-picker
            v-model="state.resourceSchedule.form.runAt"
            type="datetime"
            placeholder="选择执行日期和时间"
            format="YYYY年MM月DD日 HH:mm"
            value-format="YYYY-MM-DD HH:mm:ss"
            :editable="false"
            :disabled-date="disablePastDate"
          />
        </el-form-item>
        <el-form-item label="同步类型" required>
          <el-select v-model="state.resourceSchedule.form.operation" placeholder="请选择同步类型">
            <el-option v-for="operation in resourceSyncOperations" :key="operation.value" :label="operation.label" :value="operation.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="重复执行">
          <div class="resource-schedule-repeat-control">
            <el-switch v-model="state.resourceSchedule.form.repeatEnabled" active-text="重复" inactive-text="仅一次" />
            <el-input-number v-if="state.resourceSchedule.form.repeatEnabled" v-model="state.resourceSchedule.form.repeatDays" :min="1" :max="365" controls-position="right" />
            <span v-if="state.resourceSchedule.form.repeatEnabled" class="muted">天一次</span>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="state.resourceSchedule.saving" @click="createResourceSchedule">新增定时任务</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    <el-card shadow="never" class="content-card resource-schedule-card">
      <template #header>
        <div class="card-header-line"><span>任务列表</span><span class="muted">{{ state.resourceSchedule.tasks.length }} 个任务</span></div>
      </template>
      <el-table :data="state.resourceSchedule.tasks" border stripe size="small" empty-text="暂无定时任务">
        <el-table-column label="执行日期" min-width="180"><template #default="{ row }">{{ formatDate(row.runAt) }}</template></el-table-column>
        <el-table-column label="同步类型" min-width="150"><template #default="{ row }">{{ resourceScheduleOperationText(row.operation) }}</template></el-table-column>
        <el-table-column label="重复" width="100"><template #default="{ row }">{{ resourceScheduleRepeatText(row) }}</template></el-table-column>
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="resourceScheduleStatusType(row.status)">{{ resourceScheduleStatusText(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="同步条数" width="110"><template #default="{ row }">{{ row.resultCount || 0 }}</template></el-table-column>
        <el-table-column label="上次执行" min-width="180"><template #default="{ row }">{{ formatDate(row.lastRunAt) || '-' }}</template></el-table-column>
        <el-table-column label="结果" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ resourceScheduleLastResult(row) }}</template></el-table-column>
        <el-table-column label="操作" width="140"><template #default="{ row }"><div class="resource-schedule-actions"><el-button v-if="row.status === 'pending'" type="warning" link :loading="state.resourceSchedule.cancelingId === row.id" @click="cancelResourceSchedule(row)">取消</el-button><el-button v-if="row.status !== 'running'" type="danger" link :loading="state.resourceSchedule.deletingId === row.id" @click="deleteResourceSchedule(row)">删除</el-button><span v-if="row.status === 'running'" class="muted">执行中</span></div></template></el-table-column>
      </el-table>
    </el-card>
  </section>
</template>

<script>
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { RESOURCE_SYNC_OPERATIONS } from "../resource-schedule-view-state.mjs";
import { useAppContext } from "../app-context.js";

// 定时任务。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "ResourceScheduleView",
  setup() {
    const ctx = useAppContext();
    const { loadResourceSchedules, resourceSyncApi, state } = ctx;

    function disablePastDate(date) {
      return date.getTime() < new Date().setHours(0, 0, 0, 0);
    }

    async function createResourceSchedule() {
      const { operation, runAt, repeatEnabled, repeatDays } = state.resourceSchedule.form;
      if (!operation || !runAt) {
        ElMessage.warning("请选择执行日期和同步类型");
        return;
      }
      state.resourceSchedule.saving = true;
      try {
        await resourceSyncApi.createTask({ operation, runAt, repeatEnabled, repeatDays });
        state.resourceSchedule.form.runAt = "";
        state.resourceSchedule.form.repeatEnabled = false;
        await loadResourceSchedules();
        ElMessage.success("定时任务已创建");
      } catch (error) {
        ElMessage.error(error.message || "定时任务创建失败");
      } finally {
        state.resourceSchedule.saving = false;
      }
    }

    async function cancelResourceSchedule(task) {
      try {
        await ElMessageBox.confirm("确认取消这个定时任务？", "取消定时任务", { type: "warning" });
        state.resourceSchedule.cancelingId = task.id;
        await resourceSyncApi.cancelTask(task.id);
        await loadResourceSchedules();
        ElMessage.success("定时任务已取消");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "取消定时任务失败");
      } finally {
        state.resourceSchedule.cancelingId = "";
      }
    }

    async function deleteResourceSchedule(task) {
      try {
        await ElMessageBox.confirm("确认永久删除这个定时任务？已写入的用户快照不会受影响。", "删除定时任务", { type: "warning" });
        state.resourceSchedule.deletingId = task.id;
        await resourceSyncApi.deleteTask(task.id);
        await loadResourceSchedules();
        ElMessage.success("定时任务已删除");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除定时任务失败");
      } finally {
        state.resourceSchedule.deletingId = "";
      }
    }

    const resourceSyncOperations = RESOURCE_SYNC_OPERATIONS;

    return { ...ctx, disablePastDate, createResourceSchedule, cancelResourceSchedule, deleteResourceSchedule, resourceSyncOperations };
  }
};
</script>
