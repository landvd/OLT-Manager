<template>
  <el-dialog
    v-model="state.terminal.visible"
    title="内置 Telnet 终端"
    :width="state.terminal.showAssistant ? terminalDialogWidth : '960px'"
    class="terminal-dialog"
    destroy-on-close
    @opened="mountTerminal"
    @closed="closeTerminalSession"
  >
    <div class="terminal-status">
      <span>{{ state.terminal.status }}</span>
      <div class="terminal-actions">
        <el-button size="small" @click="copyConfigPlan" :disabled="!state.configPlan.result?.commands">复制配置命令</el-button>
        <el-button size="small" type="primary" plain @click="pasteClipboardToTerminal" :disabled="!state.terminal.sessionId || state.terminal.pasting">粘贴剪贴板</el-button>
        <el-button size="small" :type="state.terminal.showAssistant ? 'success' : 'default'" plain @click="togglePiAssistant">
          {{ state.terminal.showAssistant ? '收起 Pi 助手' : '打开 Pi 助手' }}
        </el-button>
      </div>
    </div>
    <div ref="terminalLayoutRef" class="terminal-layout" :class="{ 'is-resizing': state.terminal.resizing, 'has-assistant': state.terminal.showAssistant }">
      <div class="terminal-pane">
        <div ref="terminalHost" class="embedded-terminal"></div>
      </div>
      <div
        v-if="state.terminal.showAssistant"
        class="terminal-splitter"
        title="按住左右拖动调整宽度，双击恢复默认比例"
        @mousedown="startTerminalResize"
        @dblclick="resetTerminalAssistantWidth"
      >
        <div class="splitter-line"></div>
        <div class="splitter-handle"></div>
      </div>
      <div
        v-if="state.terminal.showAssistant"
        class="pi-assistant-pane"
        :style="{ width: (state.terminal.assistantWidth || 440) + 'px' }"
      >
        <div class="pi-assistant-header">
          <div class="pi-assistant-context">
            <el-tag size="small" type="info">{{ selectedOlt?.vendor?.toUpperCase() || 'OLT' }}</el-tag>
            <span>{{ selectedOlt?.model || selectedOlt?.name || 'Pi 智能助手' }}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <el-button size="small" link type="primary" @click="openAnySearchConfigDialog">⚙️ 搜索配置</el-button>
            <el-tag size="small" type="success" effect="plain">只读问答</el-tag>
          </div>
        </div>
        <div ref="piMessagesContainer" class="pi-assistant-messages">
          <div
            v-for="(msg, index) in state.terminal.assistantMessages"
            :key="index"
            :class="['pi-message', msg.role === 'user' ? 'pi-message-user' : 'pi-message-assistant']"
          >
            <div v-if="msg.role === 'user'" class="pi-message-text">{{ msg.content }}</div>
            <div v-else class="pi-message-rich" v-html="renderPiMessage(msg.content)"></div>
            <div v-if="msg.commands && msg.commands.length" class="pi-message-commands">
              <div v-for="(cmd, cIdx) in msg.commands" :key="cIdx" class="pi-message-code-block">
                <code>{{ cmd }}</code>
                <el-button size="small" link type="success" @click="copyText(cmd)">复制</el-button>
              </div>
            </div>
          </div>
          <div v-if="state.terminal.assistantLoading" class="pi-message pi-message-assistant muted">
            Pi Agent 思考中...
          </div>
        </div>
        <div class="pi-assistant-quick-prompts">
          <el-button size="small" round @click="sendPiAssistantQuick('光功率查询与门限标准')">光功率标准</el-button>
          <el-button size="small" round @click="sendPiAssistantQuick('C600与C300命令避坑差异')">C600避坑</el-button>
          <el-button size="small" round @click="sendPiAssistantQuick('查看未注册ONU')">未注册查询</el-button>
          <el-button size="small" round @click="sendPiAssistantQuick('ONU掉线离线原因排查')">离线原因分析</el-button>
          <el-button size="small" round @click="sendPiAssistantQuick('流氓ONU长发光排查')">流氓ONU排查</el-button>
          <el-button size="small" round @click="sendPiAssistantQuick('PON端口流量与丢包统计')">端口流量丢包</el-button>
          <el-button size="small" round @click="sendPiAssistantQuick('查看机框板卡与温度')">板卡与环境</el-button>
          <el-button size="small" round @click="sendPiAssistantQuick('查看设备当前活动告警')">活动告警</el-button>
        </div>
        <div class="pi-assistant-input-box">
          <el-input
            v-model="state.terminal.assistantInput"
            size="small"
            placeholder="向 Pi 助手提问命令或诊断..."
            :disabled="state.terminal.assistantLoading"
            @keyup.enter="sendPiAssistantMessage"
          />
          <el-button
            size="small"
            type="primary"
            :loading="state.terminal.assistantLoading"
            @click="sendPiAssistantMessage"
          >发送</el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 内置 Telnet 终端与 Pi Agent。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "TerminalDialog",
  setup() {
    return useAppContext();
  }
};
</script>
