<template>
  <section>
    <div class="page-head">
      <div>
        <h1>专线项目管理</h1>
      </div>
      <div class="toolbar">
        <el-input
          v-model="state.projectSearch"
          clearable
          placeholder="搜索名称/地址/联系人/VLAN"
          class="project-search"
          @change="loadProjects"
          @clear="loadProjects"
        />
        <el-button @click="loadProjects">搜索</el-button>
        <el-button type="primary" @click="openProjectDialog()">新增项目</el-button>
      </div>
    </div>
    <div class="project-workspace">
      <div class="project-workspace-top">
        <div class="project-pane-title">
          <strong>项目列表</strong>
          <span>{{ state.projects.length }} 个项目</span>
        </div>
        <el-empty v-if="!state.loading.admin && !state.projects.length" :description="state.projectSearch ? '没有匹配项目' : '暂无项目'" />
        <div class="project-rail">
          <div
            v-for="project in state.projects"
            :key="project.id"
            role="button"
            tabindex="0"
            :class="['project-list-item', { active: state.projectDetail.project?.id === project.id }]"
            @click="selectProjectDetail(project, { reload: true })"
            @keydown.enter.prevent="selectProjectDetail(project, { reload: true })"
            @keydown.space.prevent="selectProjectDetail(project, { reload: true })"
          >
            <div class="project-list-main">
              <strong>{{ project.name }}</strong>
              <el-tag size="small" type="success">VLAN {{ project.vlan }}</el-tag>
            </div>
            <div class="project-list-meta">
              <span>{{ project.address || "未填写地址" }}</span>
              <span>{{ project.contactName || "未填写联系人" }}</span>
            </div>
            <div class="project-list-actions">
              <el-button type="primary" link @click.stop="openProjectDialog(project)">编辑</el-button>
              <el-button type="danger" link @click.stop="deleteProject(project)">删除</el-button>
            </div>
          </div>
        </div>
      </div>

      <template v-if="state.projectDetail.project">
        <div class="project-workspace-body">
          <section class="project-table-pane">
            <div class="project-section-title">
              <strong>ONU 设备台账</strong>
              <div class="project-section-actions">
                <span>点击行查看地址和操作</span>
                <el-button size="small" :loading="state.projectDetail.loading" @click="loadProjectOnus">刷新 ONU</el-button>
              </div>
            </div>
            <el-table
              :data="state.projectDetail.onus"
              border
              stripe
              size="small"
              max-height="560"
              class="project-device-table"
              v-loading="state.projectDetail.loading"
              empty-text="暂无项目 ONU"
              :row-class-name="projectOnuRowClassName"
              @row-click="selectProjectOnu"
            >
              <el-table-column prop="oltName" label="OLT" min-width="160" show-overflow-tooltip />
              <el-table-column label="位置" width="92">
                <template #default="{ row }">
                  <span class="project-device-coordinate">{{ onuCoordinateLabel(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="serial" label="SN" min-width="140" show-overflow-tooltip />
              <el-table-column label="状态" width="82">
                <template #default="{ row }">
                  <span class="project-device-status">
                    <i :class="['project-device-status-dot', phaseInfo(row.phase).type || 'info']"></i>
                    {{ row.phase ? phaseInfo(row.phase).text : "-" }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="光功率" width="105">
                <template #default="{ row }">
                  <span v-if="row.rxPower" :class="['project-device-rx', rxPowerInfo(row.rxPower).className]">{{ rxPowerInfo(row.rxPower).text }}</span>
                  <span v-else>-</span>
                </template>
              </el-table-column>
              <el-table-column prop="distance" label="距离" width="82" />
              <el-table-column label="设备安装地址" min-width="280" show-overflow-tooltip>
                <template #default="{ row }">
                  <span>{{ row.noteDraft || row.note || "-" }}</span>
                </template>
              </el-table-column>
            </el-table>
            <div class="project-onu-inline" v-if="state.projectDetail.selectedOnu">
              <el-input class="project-inline-note" v-model="state.projectDetail.selectedOnu.noteDraft" size="small" maxlength="240" show-word-limit placeholder="填写设备安装地址" />
              <div class="project-inline-actions">
                <el-button type="primary" size="small" :loading="state.projectDetail.selectedOnu.savingNote" @click="saveProjectOnuNote(state.projectDetail.selectedOnu)">修改安装地址</el-button>
                <el-button type="danger" size="small" plain :loading="state.projectDetail.selectedOnu.removing" @click="removeProjectOnu(state.projectDetail.selectedOnu)">移除 ONU</el-button>
              </div>
            </div>
            <el-alert v-if="state.projectDetail.selectedOnu?.refreshError" type="warning" :closable="false" :title="state.projectDetail.selectedOnu.refreshError" />
            <el-empty v-if="!state.projectDetail.selectedOnu && !state.projectDetail.loading" description="选择一台 ONU 编辑备注或移除" />
          </section>
        </div>
      </template>
      <el-empty v-else description="请选择项目查看 ONU 台账" />
    </div>
  </section>
</template>

<script>
import { projectApi } from "../renderer-services.js";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { onuCoordinateLabel } from "../pon-coordinate.mjs";
import { removeProjectOnuRow } from "../project-onu-state.mjs";
import { projectFormFor, projectOnuRowClassName as projectOnuRowClassNameFor } from "../project-view-state.mjs";
import { useAppContext } from "../app-context.js";

// 专线项目管理。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "ProjectAdminView",
  setup() {
    const ctx = useAppContext();
    const { fetchProjects, loadOnus, state, syncSelectedProjectAfterProjectListChange } = ctx;

    async function loadProjects() {
      state.loading.admin = true;
      try {
        const projects = await fetchProjects();
        state.projects = projects;
        await syncSelectedProjectAfterProjectListChange();
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    function openProjectDialog(project) {
      state.projectDialog.form = projectFormFor(project);
      state.projectDialog.visible = true;
    }

    async function deleteProject(project) {
      try {
        await ElMessageBox.confirm(`确认删除项目「${project.name}」？\n只会删除本地项目和项目 ONU 关联，不会删除 OLT 实机 ONU。`, "删除确认", { type: "warning" });
        await projectApi.remove(project.id);
        const projects = await fetchProjects();
        state.projects = projects;
        await syncSelectedProjectAfterProjectListChange();
        ElMessage.success("项目已删除");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除项目失败");
      }
    }

    function selectProjectOnu(row) {
      state.projectDetail.selectedOnu = row || null;
    }

    function projectOnuRowClassName({ row }) {
      return projectOnuRowClassNameFor(row, state.projectDetail.selectedOnu);
    }

    async function saveProjectOnuNote(row) {
      const project = state.projectDetail.project;
      if (!project?.id || !row?.id) return;
      row.savingNote = true;
      try {
        const onu = await projectApi.updateOnuNote(project.id, row.id, row.noteDraft);
        row.note = onu?.note || "";
        row.noteDraft = row.note;
        ElMessage.success("设备安装地址已修改");
      } catch (error) {
        ElMessage.error(error.message || "保存设备安装地址失败");
      } finally {
        row.savingNote = false;
      }
    }

    async function removeProjectOnu(row) {
      const project = state.projectDetail.project;
      if (!project?.id || !row?.id) return;
      try {
        await ElMessageBox.confirm(`确认从项目「${project.name}」移除 ONU ${onuCoordinateLabel(row)}？\n只删除本地项目关联，不会删除 OLT 实机 ONU。`, "移除项目 ONU", { type: "warning" });
        row.removing = true;
        await projectApi.removeOnu(project.id, row.id);
        const projectOnuState = removeProjectOnuRow(state.projectDetail.onus, state.projectDetail.selectedOnu?.id, row.id);
        state.projectDetail.onus = projectOnuState.rows;
        state.projectDetail.selectedOnu = projectOnuState.selectedOnu;
        if (state.activeView === "onus") await loadOnus();
        ElMessage.success("项目 ONU 已移除");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "移除项目 ONU 失败");
      } finally {
        row.removing = false;
      }
    }

    return { ...ctx, loadProjects, openProjectDialog, deleteProject, selectProjectOnu, projectOnuRowClassName, saveProjectOnuNote, removeProjectOnu };
  }
};
</script>
