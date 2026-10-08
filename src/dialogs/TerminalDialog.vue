<template>
  <el-dialog
    v-model="state.terminal.visible"
    title="内置 Telnet 终端"
    :width="state.terminal.showAssistant ? terminalDialogWidth : '960px'"
    :fullscreen="state.terminal.maximized"
    class="terminal-dialog"
    destroy-on-close
    @opened="mountTerminal"
    @closed="closeTerminalSession"
  >
    <div class="terminal-status">
      <span>{{ state.terminal.status }}</span>
      <div class="terminal-actions">
        <el-button size="small" @click="copyConfigPlan" :disabled="!state.configPlan.result?.commands">复制配置命令</el-button>
        <el-button v-if="state.terminal.ended" size="small" type="warning" @click="reconnectTerminal">重新连接</el-button>
        <el-button size="small" type="primary" plain @click="pasteClipboardToTerminal" :disabled="!state.terminal.connected || state.terminal.pasting">粘贴剪贴板</el-button>
        <el-button v-if="state.terminal.pasting" size="small" type="danger" plain @click="cancelTerminalPaste">停止发送{{ state.terminal.pasteProgress ? `（${state.terminal.pasteProgress}）` : "" }}</el-button>
        <el-button
          size="small"
          plain
          :disabled="state.terminal.pasting"
          :title="state.terminal.pasteMode === 'line' ? '整行发送，等设备回到提示符再发下一行' : '每个字符间隔发送，最稳妥'"
          @click="toggleTerminalPasteMode"
        >粘贴：{{ state.terminal.pasteMode === 'line' ? '逐行（快）' : '逐字符（稳）' }}</el-button>
        <el-button size="small" plain @click="exportTerminalLog">导出日志</el-button>
        <el-button size="small" :type="state.terminal.showAssistant ? 'success' : 'default'" plain @click="togglePiAssistant">
          {{ state.terminal.showAssistant ? '收起 Pi 助手' : '打开 Pi 助手' }}
        </el-button>
        <el-button size="small" plain @click="toggleTerminalMaximize">{{ state.terminal.maximized ? '还原窗口' : '最大化' }}</el-button>
      </div>
    </div>
    <div
      v-if="state.terminal.contextMenu.visible"
      class="terminal-context-menu"
      :style="{ left: state.terminal.contextMenu.x + 'px', top: state.terminal.contextMenu.y + 'px' }"
    >
      <button type="button" :disabled="!state.terminal.contextMenu.hasSelection" @click="runTerminalContextAction('copy')">复制选中内容<span>Ctrl+C</span></button>
      <button type="button" :disabled="!state.terminal.connected || state.terminal.pasting" @click="runTerminalContextAction('paste')">粘贴<span>Ctrl+V</span></button>
      <div class="terminal-context-divider"></div>
      <button type="button" @click="runTerminalContextAction('selectAll')">全选</button>
      <button type="button" @click="runTerminalContextAction('clear')">清屏</button>
      <button type="button" @click="runTerminalContextAction('export')">导出日志</button>
    </div>
    <div ref="terminalLayoutRef" class="terminal-layout" :class="{ 'is-resizing': state.terminal.resizing, 'has-assistant': state.terminal.showAssistant }">
      <div class="terminal-pane" @contextmenu.prevent="openTerminalContextMenu">
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
import { computed, nextTick, ref } from "vue";
import { localAuthClient } from "../renderer-services.js";
import { useAppContext } from "../app-context.js";

// 内置 Telnet 终端与 Pi Agent。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "TerminalDialog",
  setup() {
    const ctx = useAppContext();
    const { fitTerminal, loadAnySearchConfig, piMessagesContainer, selectedOlt, state } = ctx;

    const terminalLayoutRef = ref(null);

    async function sendPiAssistantMessage() {
      const text = String(state.terminal.assistantInput || "").trim();
      if (!text || state.terminal.assistantLoading) return;
      state.terminal.assistantInput = "";
      await dispatchPiAssistantChat(text);
    }

    async function sendPiAssistantQuick(promptText) {
      if (state.terminal.assistantLoading) return;
      await dispatchPiAssistantChat(promptText);
    }

    async function dispatchPiAssistantChat(queryText) {
      const olt = selectedOlt.value || {};
      state.terminal.assistantMessages.push({
        role: "user",
        content: queryText
      });
      state.terminal.assistantLoading = true;
      scrollPiMessagesBottom();

      try {
        const payload = {
          messages: state.terminal.assistantMessages.map((m) => ({ role: m.role, content: m.content })),
          context: {
            oltId: olt.id || state.selectedOltId,
            vendor: olt.vendor,
            model: olt.deviceProfile || olt.model,
            version: olt.version,
            deviceProfile: olt.deviceProfile,
            terminalContext: state.terminal.recentOutput,
            piSdk: true,
            readonlyScope: {
              oltIds: [String(olt.id || state.selectedOltId)].filter(Boolean)
            }
          }
        };
        const res = await localAuthClient.fetch("/api/pi-agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        const reply = String(data.reply || "（未收到有效解答）").replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();

        // 提取建议命令
        const codeBlocks = [];
        const regex = /```(?:[a-zA-Z0-9_-]*\n)?([\s\S]*?)```|`([^`\n]{3,80})`/g;
        let match;
        while ((match = regex.exec(reply)) !== null) {
          const cmd = (match[1] || match[2] || "").trim();
          if (cmd && !cmd.includes("\n") && (cmd.startsWith("show ") || cmd.startsWith("display ") || cmd.startsWith("interface ") || cmd.startsWith("ont ") || cmd.startsWith("configure ") || cmd.startsWith("config"))) {
            if (!codeBlocks.includes(cmd)) codeBlocks.push(cmd);
          }
        }

        state.terminal.assistantMessages.push({
          role: "assistant",
          content: reply,
          commands: codeBlocks
        });
      } catch (err) {
        state.terminal.assistantMessages.push({
          role: "assistant",
          content: `网络异常或服务未响应：${err.message || "请求失败"}`,
          commands: []
        });
      } finally {
        state.terminal.assistantLoading = false;
        scrollPiMessagesBottom();
      }
    }

    async function openAnySearchConfigDialog() {
      await loadAnySearchConfig();
      state.anysearch.dialogVisible = true;
    }

    function scrollPiMessagesBottom() {
      nextTick(() => {
        if (piMessagesContainer.value) {
          piMessagesContainer.value.scrollTop = piMessagesContainer.value.scrollHeight;
        }
      });
    }

    function escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function formatInlineMarkdown(str) {
      return escapeHtml(str)
        .replace(/\*\*([^*]+)\*\*/g, "<strong class='pi-bold'>$1</strong>")
        .replace(/`([^`\n]+)`/g, (_m, c) => `<code class="pi-inline-code" onclick="window.copyPiInlineCode(this)" title="点击复制命令">${c}</code>`);
    }

    function renderPiMessage(rawContent) {
      if (!rawContent) return "";
      let text = String(rawContent).trim();

      // 1. 保护代码块
      const codeBlocks = [];
      text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
        const id = `__PI_CODE_${codeBlocks.length}__`;
        codeBlocks.push({ lang: lang || "bash", code: code.trim() });
        return id;
      });

      // 2. 保护表格
      const tableBlocks = [];
      text = text.replace(/(?:^[ \t]*\|[^\n]+\|[ \t]*(?:\r?\n|$))+/gm, (tableText) => {
        const lines = tableText.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) return tableText;

        const parseRow = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const headers = parseRow(lines[0]);
        let dataStartIndex = 1;
        if (lines[1] && /^\|?[\s:-|]+\|?$/.test(lines[1])) {
          dataStartIndex = 2;
        }

        const theadHtml = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;
        const rowsHtml = lines.slice(dataStartIndex).map((r) => {
          const cells = parseRow(r);
          return `<tr>${cells.map((c) => `<td>${formatInlineMarkdown(c)}</td>`).join("")}</tr>`;
        }).join("");

        const id = `__PI_TABLE_${tableBlocks.length}__`;
        tableBlocks.push(`<div class="pi-table-wrap"><table class="pi-rich-table">${theadHtml}<tbody>${rowsHtml}</tbody></table></div>`);
        return id;
      });

      // 3. 结构化模块标头转换
      text = text.replace(/(?:^|\n)###?\s*([^\n]+)/g, (_m, title) => {
        let badgeClass = "pi-badge-general";
        let icon = "📌";
        if (title.includes("结论") || title.includes("诊断") || title.includes("💡")) {
          badgeClass = "pi-badge-diagnosis";
          icon = "💡";
        } else if (title.includes("命令") || title.includes("对比") || title.includes("📋")) {
          badgeClass = "pi-badge-commands";
          icon = "📋";
        } else if (title.includes("指标") || title.includes("门限") || title.includes("标准") || title.includes("📊")) {
          badgeClass = "pi-badge-metrics";
          icon = "📊";
        } else if (title.includes("避坑") || title.includes("警告") || title.includes("注意") || title.includes("⚠️")) {
          badgeClass = "pi-badge-warning";
          icon = "⚠️";
        } else if (title.includes("来源") || title.includes("检索") || title.includes("文档") || title.includes("🌐")) {
          badgeClass = "pi-badge-source";
          icon = "🌐";
        }
        const cleanTitle = title.replace(/[💡📋📊⚠️🌐📌]/g, "").trim();
        return `\n<div class="pi-section-title ${badgeClass}"><span class="pi-badge-icon">${icon}</span><span class="pi-badge-text">${escapeHtml(cleanTitle)}</span></div>\n`;
      });

      // 4. 处理段落与常规文本
      const lines = text.split("\n");
      const processedLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return "<div class='pi-spacer'></div>";
        if (trimmed.startsWith("__PI_CODE_") || trimmed.startsWith("__PI_TABLE_") || trimmed.startsWith("<div class=\"pi-section-title")) {
          return trimmed;
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return `<div class="pi-list-item"><span class="pi-bullet">•</span><span>${formatInlineMarkdown(trimmed.slice(2))}</span></div>`;
        }
        if (/^\d+\.\s/.test(trimmed)) {
          const num = trimmed.match(/^(\d+)\.\s/)[1];
          const rest = trimmed.replace(/^\d+\.\s/, "");
          return `<div class="pi-step-item"><span class="pi-step-num">${num}</span><span>${formatInlineMarkdown(rest)}</span></div>`;
        }
        if (trimmed.startsWith("&gt;") || trimmed.startsWith(">")) {
          const quote = trimmed.replace(/^(&gt;|>)\s*/, "");
          return `<blockquote class="pi-blockquote">${formatInlineMarkdown(quote)}</blockquote>`;
        }
        return `<p class="pi-paragraph">${formatInlineMarkdown(trimmed)}</p>`;
      });

      let html = processedLines.join("");

      // 5. 还原表格
      html = html.replace(/__PI_TABLE_(\d+)__/g, (_m, idx) => tableBlocks[Number(idx)] || "");

      // 6. 还原代码块
      html = html.replace(/__PI_CODE_(\d+)__/g, (_m, idx) => {
        const block = codeBlocks[Number(idx)];
        if (!block) return "";
        const escapedCode = escapeHtml(block.code);
        return `<div class="pi-code-card">
          <div class="pi-code-header">
            <span class="pi-code-lang">${escapeHtml(block.lang.toUpperCase() || 'COMMAND')}</span>
            <button class="pi-copy-btn" onclick="window.copyPiCode(this)" data-code="${escapeHtml(block.code)}">复制</button>
          </div>
          <pre class="pi-code-pre"><code>${escapedCode}</code></pre>
        </div>`;
      });

      return html;
    }

    function startTerminalResize(e) {
      e.preventDefault();
      state.terminal.resizing = true;
      const startX = e.clientX;
      const startWidth = Number(state.terminal.assistantWidth) || 440;
      const containerWidth = terminalLayoutRef.value?.clientWidth || 1200;
      const minTerminalWidth = Math.min(460, Math.max(320, Math.floor(containerWidth * 0.38)));
      const minAssistantWidth = 320;
      const splitterWidth = 10;
      const maxAssistantWidth = Math.max(minAssistantWidth, Math.min(680, containerWidth - minTerminalWidth - splitterWidth));

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function onMouseMove(moveEvent) {
        // 向左拉，助手变宽；向右拉，助手变窄
        const deltaX = startX - moveEvent.clientX;
        const targetWidth = startWidth + deltaX;
        const newWidth = Math.max(minAssistantWidth, Math.min(maxAssistantWidth, Math.round(targetWidth)));
        state.terminal.assistantWidth = newWidth;
        requestAnimationFrame(() => {
          fitTerminal();
        });
      }

      function onMouseUp() {
        state.terminal.resizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        nextTick(() => {
          fitTerminal();
        });
      }

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    function resetTerminalAssistantWidth() {
      const containerWidth = terminalLayoutRef.value?.clientWidth || 1200;
      const defaultWidth = Math.min(440, Math.max(340, Math.round(containerWidth * 0.38)));
      state.terminal.assistantWidth = defaultWidth;
      nextTick(() => {
        fitTerminal();
      });
    }

    const terminalDialogWidth = computed(() => "min(96vw, 1260px)");

    return { ...ctx, terminalLayoutRef, sendPiAssistantMessage, sendPiAssistantQuick, openAnySearchConfigDialog, renderPiMessage, startTerminalResize, resetTerminalAssistantWidth, terminalDialogWidth };
  }
};
</script>
