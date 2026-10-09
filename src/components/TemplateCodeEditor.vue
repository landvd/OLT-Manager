<template>
  <div :class="['tce', { 'is-readonly': readonly }]" :style="{ height }">
    <div ref="gutterRef" class="tce-gutter" aria-hidden="true">
      <div v-for="line in lineCount" :key="line" :class="['tce-line-no', { 'has-error': errorLineSet.has(line) }]">{{ line }}</div>
    </div>
    <div class="tce-body">
      <pre ref="highlightRef" class="tce-highlight" aria-hidden="true"><code v-html="highlighted"></code></pre>
      <textarea
        ref="textareaRef"
        class="tce-input"
        :value="modelValue"
        :readonly="readonly"
        :placeholder="placeholder"
        wrap="off"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        @input="handleInput"
        @keydown="handleKeydown"
        @scroll="syncScroll"
        @click="closeSuggest"
        @blur="handleBlur"
        @contextmenu="openContextMenu"
      ></textarea>
      <span ref="measureRef" class="tce-measure" aria-hidden="true">0000000000</span>
      <div v-if="suggest.visible && suggest.items.length" class="tce-suggest" :style="{ top: `${suggest.top}px`, left: `${suggest.left}px` }" role="listbox">
        <div
          v-for="(item, index) in suggest.items"
          :key="item.name"
          :class="['tce-suggest-item', { active: index === suggest.index }]"
          role="option"
          :aria-selected="index === suggest.index"
          @mousedown.prevent="applySuggestion(item)"
          @mouseenter="suggest.index = index"
        >
          <code>{{ item.name }}</code>
          <span>{{ item.label }}</span>
        </div>
      </div>
    </div>
    <teleport to="body">
      <div
        v-if="contextMenu.visible"
        ref="contextMenuRef"
        class="tce-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        role="menu"
        @mousedown.prevent
      >
        <div class="tce-context-head">在光标处插入变量</div>
        <div class="tce-context-body">
          <div v-for="group in contextGroups" :key="group.title" class="tce-context-group">
            <div class="tce-context-title">{{ group.title }}</div>
            <div
              v-for="item in group.items"
              :key="item.name"
              class="tce-context-item"
              role="menuitem"
              :title="item.desc || ''"
              @click="insertFromContextMenu(item.name)"
            >
              <code>{{ item.name }}</code>
              <span>{{ item.label }}</span>
            </div>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";

const PADDING = 10;
const CONTEXT_GROUPS = Object.freeze([
  { key: "coordinate", title: "设备与坐标" },
  { key: "onu", title: "终端与 SN" },
  { key: "business", title: "业务与 VLAN" },
  { key: "port", title: "物理网口（多选时逐行展开）" }
]);

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 配置方案命令模板编辑器：行号、变量高亮（已知 / 生成参数 / 不认识）、输入 {{ 自动补全。
// 只编辑本地模板文本，不连接设备。
export default {
  name: "TemplateCodeEditor",
  props: {
    modelValue: { type: String, default: "" },
    readonly: { type: Boolean, default: false },
    variables: { type: Array, default: () => [] },
    paramNames: { type: Array, default: () => [] },
    paramLabels: { type: Object, default: () => ({}) },
    errorLines: { type: Array, default: () => [] },
    placeholder: { type: String, default: "" },
    height: { type: String, default: "380px" }
  },
  emits: ["update:modelValue"],
  setup(props, { emit, expose }) {
    const textareaRef = ref(null);
    const highlightRef = ref(null);
    const gutterRef = ref(null);
    const measureRef = ref(null);
    const metrics = reactive({ charWidth: 7.8, lineHeight: 20 });
    const suggest = reactive({ visible: false, items: [], index: 0, top: 0, left: 0, start: 0 });
    const contextMenuRef = ref(null);
    const contextMenu = reactive({ visible: false, x: 0, y: 0, start: 0, end: 0 });

    const lineCount = computed(() => Math.max(1, String(props.modelValue || "").split("\n").length));
    const errorLineSet = computed(() => new Set(props.errorLines));
    const knownSet = computed(() => new Set(props.variables.map((item) => item.name)));
    const paramSet = computed(() => new Set(props.paramNames));
    const candidates = computed(() => [
      ...props.paramNames.map((name) => ({ name, label: props.paramLabels[name] || "生成时填写" })),
      ...props.variables.map((item) => ({ name: item.name, label: item.label || "" }))
    ]);

    const highlighted = computed(() => {
      const text = String(props.modelValue || "");
      const html = escapeHtml(text).replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (match, name) => {
        const kind = paramSet.value.has(name) ? "param" : knownSet.value.has(name) ? "known" : "unknown";
        return `<span class="tce-var is-${kind}">${match}</span>`;
      });
      // 末尾换行需要占位，否则高亮层比输入框少一行导致错位。
      return `${html}\n `;
    });

    function syncScroll() {
      const textarea = textareaRef.value;
      if (!textarea) return;
      if (highlightRef.value) {
        highlightRef.value.scrollTop = textarea.scrollTop;
        highlightRef.value.scrollLeft = textarea.scrollLeft;
      }
      if (gutterRef.value) gutterRef.value.scrollTop = textarea.scrollTop;
      if (suggest.visible) positionSuggest();
    }

    function closeSuggest() {
      suggest.visible = false;
    }

    function handleBlur() {
      setTimeout(closeSuggest, 120);
    }

    function positionSuggest() {
      const textarea = textareaRef.value;
      if (!textarea) return;
      const before = textarea.value.slice(0, textarea.selectionStart);
      const lines = before.split("\n");
      const row = lines.length - 1;
      const column = lines[row].length;
      suggest.top = PADDING + (row + 1) * metrics.lineHeight - textarea.scrollTop + 2;
      suggest.left = Math.min(PADDING + column * metrics.charWidth - textarea.scrollLeft, textarea.clientWidth - 230);
    }

    function updateSuggest() {
      const textarea = textareaRef.value;
      if (!textarea || props.readonly) return closeSuggest();
      const before = textarea.value.slice(0, textarea.selectionStart);
      const match = before.match(/\{\{\s*([A-Za-z0-9_]*)$/);
      if (!match) return closeSuggest();
      const prefix = match[1].toLowerCase();
      const items = candidates.value.filter((item) => item.name.toLowerCase().includes(prefix));
      if (!items.length) return closeSuggest();
      suggest.items = items.sort((a, b) => Number(!a.name.toLowerCase().startsWith(prefix)) - Number(!b.name.toLowerCase().startsWith(prefix)));
      suggest.index = 0;
      suggest.start = textarea.selectionStart - match[0].length;
      suggest.visible = true;
      positionSuggest();
    }

    function handleInput(event) {
      emit("update:modelValue", event.target.value);
      nextTick(() => {
        syncScroll();
        updateSuggest();
      });
    }

    function replaceRange(start, end, insertText) {
      const textarea = textareaRef.value;
      const value = String(props.modelValue || "");
      emit("update:modelValue", value.slice(0, start) + insertText + value.slice(end));
      nextTick(() => {
        if (!textarea) return;
        textarea.focus();
        const caret = start + insertText.length;
        textarea.setSelectionRange(caret, caret);
        syncScroll();
      });
    }

    function applySuggestion(item) {
      const textarea = textareaRef.value;
      if (!textarea) return;
      const end = textarea.selectionStart;
      const after = textarea.value.slice(end);
      const closing = after.match(/^\s*\}\}/);
      replaceRange(suggest.start, end + (closing ? closing[0].length : 0), `{{${item.name}}}`);
      closeSuggest();
    }

    function handleKeydown(event) {
      if (event.key === "Tab" && !suggest.visible && !props.readonly) {
        event.preventDefault();
        const textarea = textareaRef.value;
        replaceRange(textarea.selectionStart, textarea.selectionEnd, "  ");
        return;
      }
      if (!suggest.visible) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        suggest.index = (suggest.index + 1) % suggest.items.length;
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        suggest.index = (suggest.index - 1 + suggest.items.length) % suggest.items.length;
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applySuggestion(suggest.items[suggest.index]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSuggest();
      }
    }

    /** 在光标处插入变量（供“插入变量”菜单调用）。 */
    function insertVariable(name) {
      if (props.readonly) return;
      const textarea = textareaRef.value;
      const length = String(props.modelValue || "").length;
      const start = textarea ? textarea.selectionStart : length;
      const end = textarea ? textarea.selectionEnd : length;
      replaceRange(start, end, `{{${name}}}`);
    }

    const contextGroups = computed(() => {
      const groups = CONTEXT_GROUPS.map((group) => ({ title: group.title, items: props.variables.filter((item) => item.category === group.key) }));
      const others = props.variables.filter((item) => !CONTEXT_GROUPS.some((group) => group.key === item.category));
      if (others.length) groups.push({ title: "其他", items: others });
      if (props.paramNames.length) groups.unshift({ title: "生成时填写的参数", items: props.paramNames.map((name) => ({ name, label: props.paramLabels[name] || "" })) });
      return groups.filter((group) => group.items.length);
    });

    function closeContextMenu() {
      contextMenu.visible = false;
    }

    function openContextMenu(event) {
      if (props.readonly) return;
      event.preventDefault();
      closeSuggest();
      const textarea = textareaRef.value;
      contextMenu.start = textarea?.selectionStart ?? 0;
      contextMenu.end = textarea?.selectionEnd ?? contextMenu.start;
      const width = 300;
      const height = 420;
      contextMenu.x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8));
      contextMenu.y = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8));
      contextMenu.visible = true;
    }

    function insertFromContextMenu(name) {
      replaceRange(contextMenu.start, contextMenu.end, `{{${name}}}`);
      closeContextMenu();
    }

    function handleDocumentPointer(event) {
      if (contextMenu.visible && !contextMenuRef.value?.contains(event.target)) closeContextMenu();
    }

    // 菜单自身滚动时不关闭；页面其它地方滚动时关闭，避免菜单悬在错位的位置。
    function handleDocumentScroll(event) {
      if (contextMenu.visible && !contextMenuRef.value?.contains(event.target)) closeContextMenu();
    }

    function handleDocumentKey(event) {
      if (event.key === "Escape") closeContextMenu();
    }

    /** 跳到指定行（检查结果里点击某条问题时使用）。 */
    function focusLine(line) {
      const textarea = textareaRef.value;
      if (!textarea) return;
      const lines = String(props.modelValue || "").split("\n");
      const offset = lines.slice(0, Math.max(0, line - 1)).reduce((sum, text) => sum + text.length + 1, 0);
      textarea.focus();
      textarea.setSelectionRange(offset, offset + (lines[line - 1] || "").length);
      textarea.scrollTop = Math.max(0, (line - 3) * metrics.lineHeight);
      syncScroll();
    }

    onMounted(() => {
      document.addEventListener("mousedown", handleDocumentPointer);
      document.addEventListener("keydown", handleDocumentKey);
      window.addEventListener("scroll", handleDocumentScroll, true);
      const span = measureRef.value;
      if (span?.getBoundingClientRect().width) metrics.charWidth = span.getBoundingClientRect().width / 10;
      const textarea = textareaRef.value;
      if (textarea) {
        const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight);
        if (Number.isFinite(lineHeight)) metrics.lineHeight = lineHeight;
      }
    });

    onBeforeUnmount(() => {
      document.removeEventListener("mousedown", handleDocumentPointer);
      document.removeEventListener("keydown", handleDocumentKey);
      window.removeEventListener("scroll", handleDocumentScroll, true);
    });

    expose({ insertVariable, focusLine });

    return { textareaRef, highlightRef, gutterRef, measureRef, contextMenuRef, contextMenu, contextGroups, openContextMenu, insertFromContextMenu, suggest, lineCount, errorLineSet, highlighted, handleInput, handleKeydown, syncScroll, closeSuggest, handleBlur, applySuggestion };
  }
};
</script>
