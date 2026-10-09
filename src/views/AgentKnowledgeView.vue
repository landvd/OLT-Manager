<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Pi 知识审核</h1>
        <p>Pi Agent 从对话中学到的规约和用户资料纠正，先在这里审核，通过后才会生效。</p>
      </div>
      <el-button :loading="page.loading" @click="reload">刷新</el-button>
    </div>

    <el-card shadow="never" class="content-card">
      <div class="agent-review-toolbar">
        <el-radio-group v-model="page.tab" @change="reload">
          <el-radio-button value="memories">知识与规约</el-radio-button>
          <el-radio-button value="corrections">用户资料修正</el-radio-button>
          <el-radio-button value="questions">未解决问题</el-radio-button>
        </el-radio-group>
        <el-radio-group v-if="page.tab === 'questions'" v-model="page.questionStatus" size="small" @change="reload">
          <el-radio-button value="open">待处理</el-radio-button>
          <el-radio-button value="answered">已补答</el-radio-button>
          <el-radio-button value="ignored">已忽略</el-radio-button>
        </el-radio-group>
        <el-radio-group v-else v-model="page.status" size="small" @change="reload">
          <el-radio-button value="candidate">待审核</el-radio-button>
          <el-radio-button value="active">已生效</el-radio-button>
          <el-radio-button value="rejected">已驳回</el-radio-button>
        </el-radio-group>
        <el-button v-if="page.tab === 'memories'" size="small" type="primary" @click="openMemoryEditor(null)">新增规约</el-button>
      </div>

      <el-table v-if="page.tab === 'memories'" v-loading="page.loading" :data="page.memories" row-key="id" size="small" empty-text="没有记录">
        <el-table-column label="类别" width="90">
          <template #default="{ row }">{{ domainLabel(row.domain) }}</template>
        </el-table-column>
        <el-table-column prop="entity_key" label="对象" min-width="110" />
        <el-table-column prop="topic" label="主题" min-width="120" />
        <el-table-column label="内容" min-width="240">
          <template #default="{ row }">
            <div>{{ row.fact_content }}</div>
            <div v-if="row.anti_pattern" class="muted agent-review-sub">错误写法：{{ row.anti_pattern }}</div>
          </template>
        </el-table-column>
        <el-table-column label="来源" min-width="200">
          <template #default="{ row }">
            <div>{{ sourceLabel(row.source) }}<template v-if="row.hit_count"> · 已引用 {{ row.hit_count }} 次</template></div>
            <div v-if="row.source_context" class="muted agent-review-sub agent-review-quote">{{ row.source_context }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'active'" link type="primary" @click="reviewMemory(row, 'active')">通过</el-button>
            <el-button v-if="row.status !== 'rejected'" link type="warning" @click="reviewMemory(row, 'rejected')">驳回</el-button>
            <el-button link @click="openMemoryEditor(row)">编辑</el-button>
            <el-button link type="danger" @click="removeMemory(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-table v-else-if="page.tab === 'questions'" v-loading="page.loading" :data="page.questions" row-key="id" size="small" empty-text="没有记录">
        <el-table-column label="问题" min-width="280">
          <template #default="{ row }">
            <div>{{ row.question }}</div>
            <div class="muted agent-review-sub">{{ questionReasonLabel(row.reason) }} · 问过 {{ row.askCount }} 次 · 最近 {{ row.lastAt }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'answered'" link type="primary" @click="openAnswer(row)">补答</el-button>
            <el-button v-if="row.reason === 'village-no-match'" link @click="setView('villageRegions')">去区域字典</el-button>
            <el-button v-if="row.status === 'open'" link type="warning" @click="setQuestionStatus(row, 'ignored')">忽略</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-table v-else v-loading="page.loading" :data="page.corrections" row-key="id" size="small" empty-text="没有记录">
        <el-table-column label="用户" min-width="150">
          <template #default="{ row }">
            <div>{{ row.username || "—" }}</div>
            <div class="muted agent-review-sub">
              <template v-if="row.loid">LOID {{ row.loid }}<template v-if="row.onuIndex"> · {{ row.oltIp }} {{ row.onuIndex }}</template></template>
              <template v-else>{{ row.matchCount > 1 ? `同名 ${row.matchCount} 户，需确认是哪一户` : "台账中没找到此人，需手动填写 LOID" }}</template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="修正内容" min-width="240">
          <template #default="{ row }">
            <div>{{ fieldLabel(row.field) }}：<strong>{{ row.value }}</strong></div>
            <div v-if="row.previousValue" class="muted agent-review-sub">原来：{{ row.previousValue }}</div>
          </template>
        </el-table-column>
        <el-table-column label="来源" min-width="200">
          <template #default="{ row }">
            <div>{{ sourceLabel(row.source) }}</div>
            <div v-if="row.sourceText" class="muted agent-review-sub agent-review-quote">{{ row.sourceText }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'active'" link type="primary" @click="openCorrection(row)">通过</el-button>
            <el-button v-if="row.status !== 'rejected'" link type="warning" @click="reviewCorrection(row, { status: 'rejected' })">驳回</el-button>
            <el-button link type="danger" @click="removeCorrection(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="memoryEditor.visible" :title="memoryEditor.id ? '编辑规约' : '新增规约'" width="min(560px, 94vw)">
      <el-form label-width="84px">
        <template v-if="!memoryEditor.id">
          <el-form-item label="类别">
            <el-select v-model="memoryEditor.domain">
              <el-option v-for="(label, value) in DOMAIN_LABELS" :key="value" :label="label" :value="value" />
            </el-select>
          </el-form-item>
          <el-form-item label="对象">
            <el-input v-model="memoryEditor.entityKey" placeholder="例如：厚街机房、zte-c600" />
          </el-form-item>
          <el-form-item label="主题">
            <el-input v-model="memoryEditor.topic" placeholder="例如：外层 SVLAN 规划" />
          </el-form-item>
        </template>
        <el-form-item label="内容">
          <el-input v-model="memoryEditor.factContent" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="错误写法">
          <el-input v-model="memoryEditor.antiPattern" placeholder="可选：回答中出现这段文字时会提示纠正" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="memoryEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="memoryEditor.saving" @click="saveMemory">保存并生效</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="answerEditor.visible" title="补答问题" width="min(560px, 94vw)">
      <p class="muted agent-review-tip">补答会保存为一条已生效的“常见问题”规约，以后有人问相似的问题，Pi Agent 会引用这里的答案。</p>
      <el-form label-width="64px">
        <el-form-item label="问题">
          <el-input v-model="answerEditor.question" />
        </el-form-item>
        <el-form-item label="答案">
          <el-input v-model="answerEditor.answer" type="textarea" :rows="4" placeholder="例如：查某村所有 PON 口请发“查某某村抢修情况”" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="answerEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="answerEditor.saving" @click="saveAnswer">保存并生效</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="correctionEditor.visible" title="确认资料修正" width="min(720px, 96vw)">
      <p class="muted agent-review-tip">通过后立即写入合并台账中这一户的资料，以后每次同步合并也会继续套用。</p>
      <el-form label-width="84px">
        <el-form-item :label="fieldLabel(correctionEditor.field)">
          <el-input v-model="correctionEditor.value" />
        </el-form-item>
        <el-form-item label="LOID">
          <el-input v-model="correctionEditor.loid" placeholder="从下表选择，或直接填写" />
        </el-form-item>
      </el-form>
      <el-table v-loading="correctionEditor.loading" :data="correctionEditor.matches" size="small" max-height="260" empty-text="合并台账中没有同名用户" @row-click="(row) => (correctionEditor.loid = row.loid)">
        <el-table-column label="" width="40">
          <template #default="{ row }"><el-radio :model-value="correctionEditor.loid" :value="row.loid">{{ "" }}</el-radio></template>
        </el-table-column>
        <el-table-column prop="loid" label="LOID" min-width="120" />
        <el-table-column label="位置" min-width="150">
          <template #default="{ row }">{{ row.oltIp }} {{ row.onuIndex }}</template>
        </el-table-column>
        <el-table-column prop="userPhone" label="电话" min-width="110" />
        <el-table-column prop="installationAddress" label="地址" min-width="180" />
      </el-table>
      <template #footer>
        <el-button @click="correctionEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="correctionEditor.saving" @click="confirmCorrection">通过并写入台账</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { onMounted, reactive } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { useAppContext } from "../app-context.js";

const DOMAIN_LABELS = Object.freeze({ site: "机房 / 局点", olt: "OLT 设备", command: "命令避坑", general: "通用规约", faq: "常见问题" });
const SOURCE_LABELS = Object.freeze({ feishu: "飞书对话", desktop: "桌面端对话", manual: "手动添加" });
const FIELD_LABELS = Object.freeze({ userPhone: "电话", installationAddress: "装机地址" });
const QUESTION_REASONS = Object.freeze({
  "village-no-match": "村名查不到",
  "no-answer": "没有查到结果",
  "agent-error": "Pi Agent 出错",
  "negative-feedback": "外勤回复“不对 / 没用”"
});

// Pi Agent 知识审核：自动学到的规约和资料纠正先为候选，管理员通过后才生效。只读写本地 SQLite。
export default {
  name: "AgentKnowledgeView",
  setup() {
    const ctx = useAppContext();
    const { agentReviewApi, setView } = ctx;
    const page = reactive({ tab: "memories", status: "candidate", questionStatus: "open", loading: false, memories: [], corrections: [], questions: [] });
    const answerEditor = reactive({ visible: false, saving: false, id: 0, question: "", answer: "" });
    const questionReasonLabel = (value) => QUESTION_REASONS[value] || "未解决";
    const memoryEditor = reactive({ visible: false, saving: false, id: 0, domain: "site", entityKey: "", topic: "", factContent: "", antiPattern: "" });
    const correctionEditor = reactive({ visible: false, loading: false, saving: false, id: 0, field: "", value: "", loid: "", matches: [] });

    const domainLabel = (value) => DOMAIN_LABELS[value] || value || "—";
    const sourceLabel = (value) => SOURCE_LABELS[value] || "对话";
    const fieldLabel = (value) => FIELD_LABELS[value] || value;

    async function reload() {
      page.loading = true;
      try {
        if (page.tab === "memories") page.memories = (await agentReviewApi.listMemories(page.status)).rows || [];
        else if (page.tab === "questions") page.questions = (await agentReviewApi.listQuestions(page.questionStatus)).rows || [];
        else page.corrections = (await agentReviewApi.listCorrections(page.status)).rows || [];
      } catch (error) {
        ElMessage.error(error.message || "读取失败");
      } finally {
        page.loading = false;
      }
    }

    async function reviewMemory(row, status) {
      try {
        await agentReviewApi.reviewMemory(row.id, { status });
        ElMessage.success(status === "active" ? "已通过，Pi Agent 之后会引用这条规约" : "已驳回");
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "操作失败");
      }
    }

    function openMemoryEditor(row) {
      Object.assign(memoryEditor, row
        ? { visible: true, id: row.id, factContent: row.fact_content, antiPattern: row.anti_pattern || "" }
        : { visible: true, id: 0, domain: "site", entityKey: "", topic: "", factContent: "", antiPattern: "" });
    }

    async function saveMemory() {
      memoryEditor.saving = true;
      try {
        if (memoryEditor.id) {
          await agentReviewApi.reviewMemory(memoryEditor.id, { status: "active", factContent: memoryEditor.factContent, antiPattern: memoryEditor.antiPattern });
        } else {
          await agentReviewApi.createMemory({
            domain: memoryEditor.domain, entityKey: memoryEditor.entityKey, topic: memoryEditor.topic,
            factContent: memoryEditor.factContent, antiPattern: memoryEditor.antiPattern, reason: "管理员手动添加"
          });
        }
        memoryEditor.visible = false;
        ElMessage.success("已保存并生效");
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
      } finally {
        memoryEditor.saving = false;
      }
    }

    async function removeMemory(row) {
      try {
        await ElMessageBox.confirm("确认删除这条记忆？不想再看到同类内容时建议用“驳回”。", "删除", { type: "warning" });
        await agentReviewApi.deleteMemory(row.id);
        await reload();
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除失败");
      }
    }

    async function openCorrection(row) {
      Object.assign(correctionEditor, { visible: true, loading: true, id: row.id, field: row.field, value: row.value, loid: row.loid, matches: [] });
      try {
        correctionEditor.matches = (await agentReviewApi.correctionMatches(row.id)).matches || [];
        if (!correctionEditor.loid && correctionEditor.matches.length === 1) correctionEditor.loid = correctionEditor.matches[0].loid;
      } catch (error) {
        ElMessage.error(error.message || "读取同名用户失败");
      } finally {
        correctionEditor.loading = false;
      }
    }

    async function reviewCorrection(row, input) {
      try {
        await agentReviewApi.reviewCorrection(row.id, input);
        ElMessage.success(input.status === "active" ? "已通过并写入台账" : "已驳回");
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "操作失败");
      }
    }

    async function confirmCorrection() {
      correctionEditor.saving = true;
      try {
        await agentReviewApi.reviewCorrection(correctionEditor.id, { status: "active", loid: correctionEditor.loid, value: correctionEditor.value });
        correctionEditor.visible = false;
        ElMessage.success("已通过并写入台账");
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "操作失败");
      } finally {
        correctionEditor.saving = false;
      }
    }

    async function removeCorrection(row) {
      try {
        await ElMessageBox.confirm("确认删除这条修正建议？已写入台账的资料不会回退，下次同步会恢复为原始数据。", "删除", { type: "warning" });
        await agentReviewApi.deleteCorrection(row.id);
        await reload();
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除失败");
      }
    }

    function openAnswer(row) {
      Object.assign(answerEditor, { visible: true, id: row.id, question: row.question, answer: "" });
    }

    async function saveAnswer() {
      answerEditor.saving = true;
      try {
        await agentReviewApi.answerQuestion(answerEditor.id, { question: answerEditor.question, answer: answerEditor.answer });
        answerEditor.visible = false;
        ElMessage.success("已补答，Pi Agent 之后会引用这条答案");
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
      } finally {
        answerEditor.saving = false;
      }
    }

    async function setQuestionStatus(row, status) {
      try {
        await agentReviewApi.setQuestionStatus(row.id, status);
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "操作失败");
      }
    }

    onMounted(reload);

    return { ...ctx, answerEditor, questionReasonLabel, openAnswer, saveAnswer, setQuestionStatus, DOMAIN_LABELS, page, memoryEditor, correctionEditor, domainLabel, sourceLabel, fieldLabel, reload, reviewMemory, openMemoryEditor, saveMemory, removeMemory, openCorrection, reviewCorrection, confirmCorrection, removeCorrection };
  }
};
</script>
