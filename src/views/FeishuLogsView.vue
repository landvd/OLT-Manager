<template>
  <section>
    <div class="page-head">
      <div>
        <h1>飞书查询日志</h1>
        <p>每条飞书提问的时间、人员、内容和结果；系统据此找出常见问题，并学习村名别名和常用说法，经你审核后生效。外勤在飞书提交的资料修改由指定审批人在飞书同意后自动修改。</p>
      </div>
      <el-button :loading="page.loading" @click="reload">刷新</el-button>
    </div>

    <el-card shadow="never" class="content-card">
      <div class="agent-review-toolbar">
        <el-radio-group v-model="page.tab" @change="reload">
          <el-radio-button value="logs">查询日志</el-radio-button>
          <el-radio-button value="report">改进清单</el-radio-button>
          <el-radio-button value="learning">学习建议<template v-if="page.pendingCount"> · {{ page.pendingCount }}</template></el-radio-button>
          <el-radio-button value="edits">资料修改</el-radio-button>
          <el-radio-button value="debug">对话调试</el-radio-button>
        </el-radio-group>
        <el-radio-group v-if="page.tab === 'logs' || page.tab === 'report' || page.tab === 'debug'" v-model="page.days" size="small" @change="reload">
          <el-radio-button :value="1">今天</el-radio-button>
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 查询日志 -->
      <template v-if="page.tab === 'logs'">
        <div class="feishu-log-filters">
          <el-select v-model="page.outcome" size="small" class="feishu-log-outcome" @change="reloadLogs(0)">
            <el-option label="全部结果" value="all" />
            <el-option label="查到了" value="answered" />
            <el-option label="没查到" value="no-result" />
            <el-option label="外勤说“不对/没用”" value="negative" />
            <el-option label="出错" value="error" />
            <el-option label="看帮助" value="help" />
          </el-select>
          <el-input v-model="page.q" size="small" clearable placeholder="搜索问题、人员或群名" class="feishu-log-search" @keyup.enter="reloadLogs(0)" @clear="reloadLogs(0)" />
          <el-button size="small" @click="reloadLogs(0)">搜索</el-button>
          <span v-if="page.openId" class="muted">只看 {{ page.openIdName || "某人" }} <el-button link size="small" @click="filterPerson(null)">取消</el-button></span>
        </div>
        <el-table v-loading="page.loading" :data="page.logs" size="small" empty-text="这段时间没有飞书提问">
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ formatTime(row.occurredAt) }}</template>
          </el-table-column>
          <el-table-column label="人员" width="140">
            <template #default="{ row }">
              <el-button link size="small" @click="filterPerson(row)">{{ row.userName || shortId(row.openId) }}</el-button>
              <el-button link size="small" aria-label="设置备注名" @click="editName(row)"><el-icon><Edit /></el-icon></el-button>
            </template>
          </el-table-column>
          <el-table-column label="会话" width="130">
            <template #default="{ row }">{{ row.chatType === "group" ? `群：${row.chatName || "未命名"}` : "单聊" }}</template>
          </el-table-column>
          <el-table-column label="问题" min-width="260">
            <template #default="{ row }">
              <div>{{ row.text }}</div>
              <div v-if="row.rewrittenText" class="muted agent-review-sub">已按别名改为：{{ row.rewrittenText }}</div>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="190">
            <template #default="{ row }">
              <el-tag size="small" :type="outcomeTag(row).type">{{ outcomeTag(row).text }}</el-tag>
              <span class="muted feishu-log-kind">{{ replyLabel(row) }}</span>
              <el-tag v-if="row.feedback === 'negative'" size="small" type="danger" class="feishu-log-feedback">不对/没用</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="识别" width="96">
            <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
          </el-table-column>
          <el-table-column label="用时" width="80" align="right">
            <template #default="{ row }">{{ formatDuration(row.durationMs) }}</template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="page.total > PAGE_SIZE"
          class="feishu-log-pager"
          layout="total, prev, pager, next"
          :total="page.total"
          :page-size="PAGE_SIZE"
          :current-page="page.offset / PAGE_SIZE + 1"
          @current-change="(current) => reloadLogs((current - 1) * PAGE_SIZE)"
        />
      </template>

      <!-- 改进清单 -->
      <template v-else-if="page.tab === 'report'">
        <div v-if="page.stats" v-loading="page.loading">
          <div class="feishu-stat-grid">
            <div class="feishu-stat"><strong>{{ page.stats.total }}</strong><span>提问</span></div>
            <div class="feishu-stat"><strong>{{ page.stats.users }}</strong><span>人</span></div>
            <div class="feishu-stat"><strong>{{ percent(page.stats.noResult) }}</strong><span>没查到</span></div>
            <div class="feishu-stat"><strong>{{ page.stats.negative }}</strong><span>说“不对/没用”</span></div>
            <div class="feishu-stat"><strong>{{ page.stats.errors }}</strong><span>出错</span></div>
            <div class="feishu-stat"><strong>{{ formatDuration(page.stats.avgMs) }}</strong><span>平均用时</span></div>
            <div class="feishu-stat"><strong>{{ page.stats.llmTimes }}</strong><span>靠大模型识别</span></div>
          </div>

          <h3 class="feishu-report-title">需要改进的说法</h3>
          <p class="muted feishu-report-tip">没查到、外勤说“不对/没用”或出错的提问，按次数排列。常见的处理：村名写法不同 → 区域字典或学习建议里加别名；问的是做法 → 到“Gd 知识审核 → 未解决问题”补答。</p>
          <el-table :data="page.stats.problems" size="small" empty-text="这段时间没有需要改进的提问">
            <el-table-column prop="text" label="提问" min-width="240" />
            <el-table-column prop="times" label="次数" width="70" align="right" />
            <el-table-column prop="people" label="人数" width="70" align="right" />
            <el-table-column label="情况" width="190">
              <template #default="{ row }">
                <span v-if="row.noResult">没查到 {{ row.noResult }}　</span>
                <span v-if="row.negative">不对/没用 {{ row.negative }}　</span>
                <span v-if="row.errors">出错 {{ row.errors }}</span>
              </template>
            </el-table-column>
            <el-table-column label="处理" width="190">
              <template #default="{ row }">
                <el-button link type="primary" @click="openSuggestionEditor({ kind: 'alias', key: aliasFrom(row.text), target: '' })">加别名</el-button>
                <el-button link type="primary" @click="setView('agentKnowledge')">去补答</el-button>
              </template>
            </el-table-column>
          </el-table>

          <h3 class="feishu-report-title">外勤使用情况</h3>
          <el-table :data="page.stats.people" size="small" empty-text="没有记录">
            <el-table-column label="人员" min-width="140">
              <template #default="{ row }">{{ row.name || shortId(row.openId) }}</template>
            </el-table-column>
            <el-table-column prop="total" label="提问" width="80" align="right" />
            <el-table-column prop="noResult" label="没查到" width="80" align="right" />
            <el-table-column label="最近" width="150">
              <template #default="{ row }">{{ formatTime(row.lastAt) }}</template>
            </el-table-column>
            <el-table-column label="" width="90">
              <template #default="{ row }">
                <el-button link type="primary" @click="viewPersonLogs(row)">看记录</el-button>
              </template>
            </el-table-column>
          </el-table>

          <h3 class="feishu-report-title">各类查询平均用时</h3>
          <el-table :data="page.stats.slow" size="small" empty-text="没有记录">
            <el-table-column label="查询" min-width="160">
              <template #default="{ row }">{{ queryTypeLabel(row.queryType) }}</template>
            </el-table-column>
            <el-table-column prop="times" label="次数" width="80" align="right" />
            <el-table-column label="平均用时" width="100" align="right">
              <template #default="{ row }">{{ formatDuration(row.avgMs) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </template>

      <!-- 对话调试 -->
      <template v-else-if="page.tab === 'debug'">
        <div class="feishu-log-filters">
          <el-radio-group v-model="debug.channel" size="small" @change="reloadDebug(0)">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="feishu">飞书消息</el-radio-button>
            <el-radio-button value="feishu-callback">飞书按钮</el-radio-button>
            <el-radio-button value="pi">Gd Agent</el-radio-button>
          </el-radio-group>
          <el-input v-model="debug.q" size="small" clearable placeholder="搜索提问、回复、人员或错误" class="feishu-log-search" @keyup.enter="reloadDebug(0)" @clear="reloadDebug(0)" />
          <el-button size="small" @click="reloadDebug(0)">搜索</el-button>
          <span class="muted">共 {{ debug.total }} 条，保留 30 天</span>
          <el-dropdown :disabled="!debug.selected.length" trigger="click" @command="exportDebug">
            <el-button size="small" type="primary" :disabled="!debug.selected.length" :loading="debug.exporting">
              导出所选{{ debug.selected.length ? `（${debug.selected.length}）` : "" }}
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="txt">文本（.txt，方便阅读和转发）</el-dropdown-item>
                <el-dropdown-item command="json">JSON（.json，完整字段）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <el-table v-loading="page.loading" :data="debug.rows" size="small" row-key="id" empty-text="这段时间没有对话记录" @row-click="openDebug" @selection-change="(rows) => (debug.selected = rows)">
          <el-table-column type="selection" width="40" />
          <el-table-column label="时间" width="110">
            <template #default="{ row }">{{ formatTime(row.occurredAt) }}</template>
          </el-table-column>
          <el-table-column label="来源" width="90">
            <template #default="{ row }"><el-tag size="small" :type="debugChannelTag(row.channel)">{{ debugChannelLabel(row.channel) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="人员" width="100">
            <template #default="{ row }">{{ row.userName || (row.openId ? shortId(row.openId) : row.channel === "pi-desktop" ? "桌面" : "—") }}</template>
          </el-table-column>
          <el-table-column label="提问 / 操作" min-width="200">
            <template #default="{ row }">
              <div>{{ row.input }}</div>
              <div v-if="row.interpretation" class="muted agent-review-sub">{{ row.interpretation }}</div>
            </template>
          </el-table-column>
          <el-table-column label="回复" min-width="240">
            <template #default="{ row }">
              <div class="debug-reply-preview">{{ row.replyText }}</div>
              <div v-if="row.error" class="debug-error">{{ row.error }}</div>
            </template>
          </el-table-column>
          <el-table-column label="工具" width="60" align="right">
            <template #default="{ row }">{{ row.toolCount || "" }}</template>
          </el-table-column>
          <el-table-column label="用时" width="90" align="right">
            <template #default="{ row }">{{ formatDuration(row.durationMs) }}</template>
          </el-table-column>
        </el-table>
        <div v-if="debug.total > debug.rows.length || debug.offset" class="feishu-log-filters">
          <el-button size="small" :disabled="debug.offset === 0" @click="reloadDebug(Math.max(0, debug.offset - PAGE_SIZE))">上一页</el-button>
          <el-button size="small" :disabled="debug.offset + debug.rows.length >= debug.total" @click="reloadDebug(debug.offset + PAGE_SIZE)">下一页</el-button>
        </div>
      </template>

      <!-- 资料修改审批 -->
      <template v-else-if="page.tab === 'edits'">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="region-tip"
          title="外勤在飞书用户详情卡片上点“资料有误”，或直接说“君汇那个口的一级地址应该是顺景大厦”，可以申请修改一级地址和村 / 小组 / 小区。申请发到审批人的飞书，审批人可先改正再点同意，系统随即修改本机资料（PON 台账一级地址、该户的归属修正），不会改动设备。"
        />
        <div class="feishu-log-filters">
          <span>审批人</span>
          <el-select v-model="edits.approverOpenId" size="small" filterable clearable placeholder="从和机器人说过话的人里选择" class="feishu-log-search" @change="saveApprover">
            <el-option v-for="user in edits.users" :key="user.openId" :label="user.name || shortId(user.openId)" :value="user.openId">
              <span>{{ user.name || shortId(user.openId) }}</span>
              <span class="muted"> · 最近 {{ formatTime(user.lastAt) }}</span>
            </el-option>
          </el-select>
          <span v-if="!edits.approverOpenId" class="muted">未指定审批人时，外勤无法提交修改。</span>
          <el-radio-group v-model="edits.status" size="small" @change="reload">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="pending">待审批</el-radio-button>
            <el-radio-button value="approved">已同意</el-radio-button>
            <el-radio-button value="rejected">已驳回</el-radio-button>
          </el-radio-group>
        </div>
        <el-table v-loading="page.loading" :data="edits.requests" size="small" empty-text="还没有资料修改申请">
          <el-table-column label="时间" width="110">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="申请人" width="100">
            <template #default="{ row }">{{ row.requesterName || shortId(row.requesterOpenId) }}</template>
          </el-table-column>
          <el-table-column label="项目" width="120">
            <template #default="{ row }">{{ row.kind === "primary-address" ? "一级地址" : row.kind === "row-place" ? "台账行归属" : "单户归属" }}</template>
          </el-table-column>
          <el-table-column label="对象" min-width="200">
            <template #default="{ row }">
              <div>{{ row.kind === "place" ? (row.username || "用户") : `${row.oltName || row.oltIp} PON ${row.board}/${row.pon}` }}</div>
              <div v-if="row.kind === 'place'" class="muted agent-review-sub">{{ row.userAddress }} · {{ row.oltName || row.oltIp }} {{ row.board }}/{{ row.pon }}:{{ row.onuId }}</div>
              <div v-else-if="row.kind === 'row-place'" class="muted agent-review-sub">一级地址：{{ row.rowAddress || "（空）" }}</div>
            </template>
          </el-table-column>
          <el-table-column label="修改" min-width="220">
            <template #default="{ row }">
              {{ row.previousValue || "（空）" }} → {{ row.status === "approved" ? row.finalValue : row.proposedValue }}
              <div v-if="row.status === 'approved' && row.finalValue !== row.proposedValue" class="muted agent-review-sub">外勤原填：{{ row.proposedValue }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="150">
            <template #default="{ row }">
              <el-tag :type="row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'info' : 'warning'" size="small">
                {{ row.status === "approved" ? "已同意" : row.status === "rejected" ? "已驳回" : "待审批" }}
              </el-tag>
              <span v-if="row.approverName" class="muted"> {{ row.approverName }}</span>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <!-- 学习建议 -->
      <template v-else>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="region-tip"
          title="村名别名：外勤先问 A 没查到、马上改问 B 查到了，系统建议把 A 当作 B 的别名，以后问 A 自动按 B 查。常用说法：大模型识别对、且反复出现的说法，通过后直接按本地规则识别，不用等大模型，回复更快。都要你通过后才生效。"
        />
        <div class="feishu-log-filters">
          <el-radio-group v-model="page.kind" size="small" @change="reload">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="alias">村名别名</el-radio-button>
            <el-radio-button value="phrase">常用说法</el-radio-button>
          </el-radio-group>
          <el-radio-group v-model="page.status" size="small" @change="reload">
            <el-radio-button value="candidate">待审核</el-radio-button>
            <el-radio-button value="active">已生效</el-radio-button>
            <el-radio-button value="rejected">已驳回</el-radio-button>
          </el-radio-group>
          <el-button size="small" type="primary" @click="openSuggestionEditor({ kind: 'alias', key: '', target: '' })">手动添加</el-button>
        </div>
        <el-table v-loading="page.loading" :data="page.suggestions" size="small" empty-text="没有记录">
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ row.kind === "alias" ? "村名别名" : "常用说法" }}</template>
          </el-table-column>
          <el-table-column label="内容" min-width="260">
            <template #default="{ row }">
              <template v-if="row.kind === 'alias'">“{{ row.key }}” 按 “{{ row.target }}” 查</template>
              <template v-else>“{{ row.key }}” → {{ intentLabel(row.target) }}</template>
            </template>
          </el-table-column>
          <el-table-column label="例子" min-width="200">
            <template #default="{ row }">
              <div v-for="example in row.examples" :key="example" class="muted agent-review-sub">{{ example }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="hits" label="出现" width="70" align="right" />
          <el-table-column label="操作" width="210" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status !== 'active'" link type="primary" @click="reviewSuggestion(row, 'active')">通过</el-button>
              <el-button v-if="row.status !== 'rejected'" link type="warning" @click="reviewSuggestion(row, 'rejected')">驳回</el-button>
              <el-button link @click="openSuggestionEditor(row)">编辑</el-button>
              <el-button link type="danger" @click="removeSuggestion(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-card>

    <el-dialog v-model="debug.visible" title="对话详情" width="min(860px, 96vw)">
      <template v-if="debug.detail">
        <div v-for="item in [debug.detail, ...(debug.detail.related || [])]" :key="item.id" class="debug-entry">
          <div class="debug-entry-head">
            <el-tag size="small" :type="debugChannelTag(item.channel)">{{ debugChannelLabel(item.channel) }}</el-tag>
            <span>{{ formatFullTime(item.occurredAt) }}</span>
            <span v-if="item.userName || item.openId">{{ item.userName || shortId(item.openId) }}</span>
            <span class="muted">{{ formatDuration(item.durationMs) }}</span>
            <span v-if="item.source" class="muted">{{ item.source }}</span>
          </div>
          <div class="debug-label">提问 / 操作</div>
          <pre class="debug-pre">{{ item.input }}</pre>
          <template v-if="item.interpretation">
            <div class="debug-label">识别</div>
            <pre class="debug-pre">{{ item.interpretation }}</pre>
          </template>
          <template v-if="item.trace && item.trace.length">
            <div class="debug-label">处理过程</div>
            <div v-for="(step, index) in item.trace" :key="index" class="debug-step">
              <strong>{{ debugStepLabel(step) }}</strong>
              <pre v-if="step.type === 'toolCall'" class="debug-pre">{{ JSON.stringify(step.arguments || {}, null, 2) }}</pre>
              <pre v-else-if="step.type === 'toolResult'" class="debug-pre">{{ step.result }}</pre>
              <pre v-else-if="step.type === 'usage'" class="debug-pre">输入 {{ step.input }} tokens · 输出 {{ step.output }} tokens</pre>
              <pre v-else class="debug-pre">{{ step.text }}</pre>
            </div>
          </template>
          <div class="debug-label">回复</div>
          <pre class="debug-pre">{{ item.replyText || "（无）" }}</pre>
          <template v-if="item.error">
            <div class="debug-label">错误</div>
            <pre class="debug-pre debug-error">{{ item.error }}</pre>
          </template>
        </div>
      </template>
      <template #footer>
        <el-button @click="copyDebug">复制全部</el-button>
        <el-button type="primary" @click="debug.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editor.visible" :title="editor.id ? '编辑学习建议' : '添加别名或说法'" width="min(520px, 94vw)">
      <el-form label-width="84px">
        <el-form-item label="类型">
          <el-radio-group v-model="editor.kind" :disabled="Boolean(editor.id)">
            <el-radio-button value="alias">村名别名</el-radio-button>
            <el-radio-button value="phrase">常用说法</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="editor.kind === 'alias'">
          <el-form-item label="外勤写法">
            <el-input v-model="editor.key" placeholder="厚接村" />
          </el-form-item>
          <el-form-item label="按这个查">
            <el-input v-model="editor.target" placeholder="厚街村" />
          </el-form-item>
          <p class="muted feishu-editor-tip">提问里出现“外勤写法”时，自动换成“按这个查”的写法再处理。</p>
        </template>
        <template v-else>
          <el-form-item label="说法">
            <el-input v-model="editor.key" placeholder="帮我看看{value}的光" />
          </el-form-item>
          <el-form-item label="查什么">
            <el-select v-model="editor.target" placeholder="请选择">
              <el-option v-for="(label, value) in INTENT_LABELS" :key="value" :label="label" :value="value" />
            </el-select>
          </el-form-item>
          <p class="muted feishu-editor-tip">用 {value} 表示要查的内容，例如姓名、电话或地址，必须有且只有一个。</p>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="editor.visible = false">取消</el-button>
        <el-button type="primary" :loading="editor.saving" @click="saveSuggestion">{{ editor.id ? "保存" : "添加并生效" }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { onMounted, reactive } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { useAppContext } from "../app-context.js";
import { downloadBlob } from "../renderer-services.js";

const PAGE_SIZE = 100;
const INTENT_LABELS = Object.freeze({
  find_by_name: "按姓名查用户",
  find_by_phone: "按电话查用户",
  find_by_address: "按地址查用户",
  find_by_sn: "按 SN 查用户",
  find_by_device_number: "按设备号查用户",
  find_by_loid: "按 LOID 查用户",
  find_by_mac: "按 MAC 查用户",
  find_by_onu_coordinate: "按 ONU 坐标查",
  find_pon_by_address: "按地址查 PON 口",
  find_pons_by_village: "查某村的 PON 口",
  read_live_status: "查实时状态"
});
const QUERY_TYPE_LABELS = Object.freeze({
  find_pons_by_village: "整村 / 小组抢修验收",
  village_pon_retest: "抢修复测",
  village_region_menu: "大村小组菜单",
  weak_light: "弱光查询",
  outage_history: "断纤记录",
  pi_agent_answer: "Gd Agent 回答",
  help: "帮助",
  read_pon_statuses_by_management_ip: "按 IP 查 PON 口",
  find_by_loid: "按 LOID 查",
  edit_request: "资料修改申请",
  edit_request_form: "资料修改表单",
  edit_request_decision: "资料修改审批"
});
const REPLY_LABELS = Object.freeze({
  "candidate-set": "用户列表",
  "onu-detail": "用户详情",
  "pon-candidate-set": "PON 口列表",
  "pon-detail": "PON 口详情",
  "village-pon-summary-loading": "抢修验收",
  "village-region-menu": "小组菜单",
  "weak-light": "弱光名单",
  "outage-history": "断纤记录",
  "pi-agent-answer": "Gd Agent 回答",
  "village-pon-empty": "村名没找到",
  "loid-no-match": "LOID 没找到",
  "onu-edit-form": "资料修改表单",
  "edit-request-text": "资料修改提示"
});
const OUTCOME_TAGS = Object.freeze({
  answered: { type: "success", text: "查到了" },
  "no-result": { type: "warning", text: "没查到" },
  help: { type: "info", text: "帮助" },
  denied: { type: "info", text: "被拒绝" },
  error: { type: "danger", text: "出错" }
});

// 飞书查询日志：提问记录、改进清单与学习建议审核。只读写本地 SQLite。
export default {
  name: "FeishuLogsView",
  setup() {
    const ctx = useAppContext();
    const { feishuLearningApi, setView } = ctx;
    const page = reactive({
      tab: "logs", days: 7, outcome: "all", q: "", openId: "", openIdName: "", offset: 0, total: 0,
      kind: "", status: "candidate", pendingCount: 0, loading: false, logs: [], stats: null, suggestions: []
    });
    const editor = reactive({ visible: false, saving: false, id: 0, kind: "alias", key: "", target: "" });
    const edits = reactive({ approverOpenId: "", users: [], status: "", requests: [] });
    const debug = reactive({ channel: "", q: "", offset: 0, total: 0, rows: [], visible: false, detail: null, selected: [], exporting: false });
    const DEBUG_CHANNELS = { feishu: ["飞书消息", "primary"], "feishu-callback": ["飞书按钮", "info"], "pi-feishu": ["Gd·飞书", "success"], "pi-desktop": ["Gd·桌面", "warning"], "pi-other": ["Gd", "warning"] };
    const debugChannelLabel = (value) => DEBUG_CHANNELS[value]?.[0] || value;
    const debugChannelTag = (value) => DEBUG_CHANNELS[value]?.[1] || "info";
    const debugStepLabel = (step) => ({
      toolCall: `调用工具 ${step.name}`,
      toolResult: `工具返回 ${step.name}${step.isError ? "（出错）" : ""}${Number.isFinite(step.durationMs) ? ` · ${step.durationMs} 毫秒` : ""}`,
      text: "模型说明",
      thinking: "模型思考",
      usage: "用量",
      error: "错误"
    }[step.type] || step.type);
    const formatFullTime = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("zh-CN", { hour12: false });
    };

    async function reloadDebug(offset = debug.offset) {
      page.loading = true;
      try {
        const data = await feishuLearningApi.conversationLogs({ channel: debug.channel, q: debug.q.trim(), days: page.days, limit: PAGE_SIZE, offset });
        debug.rows = data.rows || [];
        debug.total = Number(data.total || 0);
        debug.offset = offset;
      } catch (error) {
        ElMessage.error(error.message || "读取失败");
      } finally {
        page.loading = false;
      }
    }

    async function openDebug(row, column) {
      // 点勾选框只勾选，不打开详情。
      if (column?.type === "selection") return;
      try {
        debug.detail = (await feishuLearningApi.conversationLog(row.id)).log || null;
        debug.visible = Boolean(debug.detail);
      } catch (error) {
        ElMessage.error(error.message || "读取失败");
      }
    }

    function debugText(items) {
      return items.map((item) => [
        `[${debugChannelLabel(item.channel)}] ${formatFullTime(item.occurredAt)} ${item.userName || ""} ${formatDuration(item.durationMs)} ${item.source || ""}`,
        `提问：${item.input}`,
        item.interpretation ? `识别：${item.interpretation}` : "",
        ...(item.trace || []).map((step) => `${debugStepLabel(step)}：${step.type === "toolCall" ? JSON.stringify(step.arguments || {}) : step.result || step.text || ""}`),
        `回复：${item.replyText}`,
        item.error ? `错误：${item.error}` : ""
      ].filter(Boolean).join("\n")).join("\n\n");
    }

    async function exportDebug(format = "txt") {
      if (!debug.selected.length) return;
      debug.exporting = true;
      try {
        const { logs = [] } = await feishuLearningApi.exportConversationLogs(debug.selected.map((row) => row.id));
        const stamp = new Date().toLocaleString("sv-SE", { hour12: false }).replace(/[-: ]/g, "").slice(0, 12);
        const blob = format === "json"
          ? new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: logs.length, logs }, null, 2)], { type: "application/json;charset=utf-8" })
          : new Blob([`OLT Manager 对话调试日志 · 导出 ${logs.length} 条（含关联的 Gd Agent 问答）\r\n\r\n${debugText(logs).replace(/\n/g, "\r\n")}\r\n`], { type: "text/plain;charset=utf-8" });
        downloadBlob(blob, `olt-manager-对话日志-${stamp}.${format === "json" ? "json" : "txt"}`);
        ElMessage.success(`已导出 ${logs.length} 条`);
      } catch (error) {
        ElMessage.error(error.message || "导出失败");
      } finally {
        debug.exporting = false;
      }
    }

    async function copyDebug() {
      const items = debug.detail ? [debug.detail, ...(debug.detail.related || [])] : [];
      const content = debugText(items);
      try {
        await navigator.clipboard.writeText(content);
        ElMessage.success("已复制");
      } catch {
        ElMessage.info("复制失败，请手动选择文字复制");
      }
    }

    const shortId = (value) => (value ? `用户 ${String(value).slice(-6)}` : "未知");
    const outcomeTag = (row) => OUTCOME_TAGS[row.outcome] || { type: "info", text: row.outcome || "—" };
    const replyLabel = (row) => {
      const label = REPLY_LABELS[row.replyKind] || "";
      return Number.isFinite(row.resultCount) && row.resultCount > 0 && label ? `${label} ${row.resultCount}` : label;
    };
    const sourceLabel = (value) => ({ llm: "大模型", learned: "已学说法" }[value] || "本地规则");
    const intentLabel = (value) => INTENT_LABELS[value] || value;
    const queryTypeLabel = (value) => QUERY_TYPE_LABELS[value] || INTENT_LABELS[value] || value;
    const formatTime = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    };
    const formatDuration = (ms) => {
      const value = Number(ms) || 0;
      return value >= 1000 ? `${(value / 1000).toFixed(1)} 秒` : `${value} 毫秒`;
    };
    const percent = (count) => {
      const total = Number(page.stats?.total) || 0;
      return total ? `${Math.round((Number(count) / total) * 100)}%` : "0%";
    };
    // 从提问里去掉“查”等前缀和常见后缀，作为别名的初始写法。
    const aliasFrom = (text) => String(text || "").replace(/\s+/g, "")
      .replace(/^(?:请|麻烦|帮忙|帮我)?(?:查查|查询|查找|查一下|查看|看看|看下|查)?/u, "")
      .replace(/(?:的)?(?:抢修情况|抢修|断纤情况|断纤|恢复情况|熔接情况|弱光用户|弱光|光衰情况|光衰|断纤记录|所有PON口|PON口)$/u, "");

    async function refreshPending() {
      try {
        page.pendingCount = ((await feishuLearningApi.suggestions({ status: "candidate" })).rows || []).length;
      } catch {
        page.pendingCount = 0;
      }
    }

    async function reloadLogs(offset = page.offset) {
      page.loading = true;
      try {
        const data = await feishuLearningApi.logs({ days: page.days, outcome: page.outcome === "all" ? "" : page.outcome, q: page.q.trim(), openId: page.openId, limit: PAGE_SIZE, offset });
        page.logs = data.rows || [];
        page.total = Number(data.total || 0);
        page.offset = offset;
      } catch (error) {
        ElMessage.error(error.message || "读取失败");
      } finally {
        page.loading = false;
      }
    }

    async function reloadEdits() {
      const [approver, requests] = await Promise.all([
        feishuLearningApi.editApprover(),
        feishuLearningApi.editRequests({ status: edits.status })
      ]);
      edits.users = approver.users || [];
      edits.approverOpenId = approver.approver?.openId || "";
      // 已指定的审批人不在最近名单里时也要能显示。
      if (approver.approver && !edits.users.some((user) => user.openId === approver.approver.openId)) {
        edits.users.unshift({ openId: approver.approver.openId, name: approver.approver.name, lastAt: "" });
      }
      edits.requests = requests.requests || [];
    }

    async function saveApprover(openId) {
      try {
        const result = await feishuLearningApi.saveEditApprover(openId || "");
        edits.approverOpenId = result.approver?.openId || "";
        ElMessage.success(result.approver ? `审批人已设为 ${result.approver.name || "所选用户"}` : "已取消审批人");
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
        await reloadEdits().catch(() => {});
      }
    }

    async function reload() {
      if (page.tab === "logs") {
        await reloadLogs(0);
      } else {
        page.loading = true;
        try {
          if (page.tab === "report") page.stats = (await feishuLearningApi.stats(page.days)).stats || null;
          else if (page.tab === "edits") await reloadEdits();
          else if (page.tab === "debug") await reloadDebug(0);
          else page.suggestions = (await feishuLearningApi.suggestions({ kind: page.kind, status: page.status })).rows || [];
        } catch (error) {
          ElMessage.error(error.message || "读取失败");
        } finally {
          page.loading = false;
        }
      }
      void refreshPending();
    }

    function filterPerson(row) {
      page.openId = row?.openId || "";
      page.openIdName = row ? row.userName || shortId(row.openId) : "";
      void reloadLogs(0);
    }

    function viewPersonLogs(row) {
      page.tab = "logs";
      page.outcome = "all";
      filterPerson({ openId: row.openId, userName: row.name });
    }

    async function editName(row) {
      try {
        const { value } = await ElMessageBox.prompt("给这位外勤设置一个备注名（留空则改回飞书上的名字）。", "设置备注名", {
          inputValue: row.userName || "",
          confirmButtonText: "保存",
          cancelButtonText: "取消"
        });
        await feishuLearningApi.setUserName(row.openId, value || "");
        ElMessage.success("已保存");
        await reloadLogs(page.offset);
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "保存失败");
      }
    }

    function openSuggestionEditor(row) {
      Object.assign(editor, { visible: true, saving: false, id: row.id || 0, kind: row.kind || "alias", key: row.key || "", target: row.target || "" });
    }

    async function saveSuggestion() {
      editor.saving = true;
      try {
        if (editor.id) await feishuLearningApi.reviewSuggestion(editor.id, { key: editor.key, target: editor.target });
        else await feishuLearningApi.createSuggestion({ kind: editor.kind, key: editor.key, target: editor.target });
        editor.visible = false;
        ElMessage.success(editor.id ? "已保存" : "已添加，飞书立即按这条处理");
        if (page.tab === "learning") await reload();
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
      } finally {
        editor.saving = false;
      }
    }

    async function reviewSuggestion(row, status) {
      try {
        await feishuLearningApi.reviewSuggestion(row.id, { status });
        ElMessage.success(status === "active" ? "已通过，飞书立即按这条处理" : "已驳回");
        await reload();
      } catch (error) {
        ElMessage.error(error.message || "操作失败");
      }
    }

    async function removeSuggestion(row) {
      try {
        await ElMessageBox.confirm("删除后，如果外勤还这样问，系统可能会再次提出这条建议；不想再看到请用“驳回”。", "删除学习建议", { type: "warning" });
        await feishuLearningApi.deleteSuggestion(row.id);
        await reload();
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除失败");
      }
    }

    onMounted(reload);

    return { ...ctx, PAGE_SIZE, INTENT_LABELS, page, editor, edits, saveApprover, debug, reloadDebug, openDebug, copyDebug, exportDebug, debugChannelLabel, debugChannelTag, debugStepLabel, formatFullTime, shortId, outcomeTag, replyLabel, sourceLabel, intentLabel, queryTypeLabel, formatTime, formatDuration, percent, aliasFrom, reload, reloadLogs, filterPerson, viewPersonLogs, editName, openSuggestionEditor, saveSuggestion, reviewSuggestion, removeSuggestion };
  }
};
</script>
