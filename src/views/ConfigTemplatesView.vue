<template>
  <section>
    <div class="page-head">
      <div>
        <h1>配置方案管理</h1>
        <div class="page-subtitle">支持查看、编辑系统内置方案及新增自定义开通方案，自动计算变量并生成安全命令预览。</div>
      </div>
      <div class="toolbar">
        <el-button @click="loadConfigTemplates({ reload: true })">刷新方案</el-button>
        <el-button type="primary" @click="createNewTemplate">新建方案</el-button>
      </div>
    </div>

    <div class="template-editor-workspace">
      <!-- 左侧方案列表 -->
      <div class="template-sidebar">
        <div class="sidebar-filter-box">
          <el-input
            v-model="state.templateEditor.searchKeyword"
            clearable
            placeholder="搜索方案名称 / 说明"
            size="small"
          />
          <div class="sidebar-vendor-tabs">
            <el-radio-group v-model="state.templateEditor.filterVendor" size="small">
              <el-radio-button label="">全部</el-radio-button>
              <el-radio-button label="zte">中兴</el-radio-button>
              <el-radio-button label="huawei">华为</el-radio-button>
            </el-radio-group>
          </div>
        </div>

        <div class="template-list-scroll">
          <div
            v-for="tpl in filteredEditorTemplates"
            :key="tpl.id"
            role="button"
            tabindex="0"
            :class="['template-list-item', { active: state.templateEditor.selectedId === tpl.id }]"
            @click="selectTemplate(tpl)"
          >
            <div class="template-item-header">
              <strong class="template-item-name">{{ tpl.name }}</strong>
              <el-tag size="small" :type="tpl.isBuiltin ? 'info' : 'success'">
                {{ tpl.isBuiltin ? '系统内置' : '自定义' }}
              </el-tag>
            </div>
            <div class="template-item-meta">
              <span class="meta-vendor">{{ tpl.vendor?.toUpperCase() }}</span>
              <span class="meta-profiles">{{ (tpl.deviceProfiles || []).join(', ') || '通用' }}</span>
            </div>
            <div v-if="tpl.remark" class="template-item-desc">{{ tpl.remark }}</div>
          </div>
          <el-empty v-if="!filteredEditorTemplates.length" description="未找到匹配方案" />
        </div>
      </div>

      <!-- 右侧编辑器与实时演练 -->
      <div class="template-editor-main">
        <el-card shadow="never" class="editor-card">
          <template #header>
            <div class="editor-card-header">
              <div>
                <strong>{{ state.templateEditor.form.id ? (state.templateEditor.form.isBuiltin ? '编辑系统内置方案' : '编辑自定义方案') : '新建配置方案' }}</strong>
                <span v-if="state.templateEditor.form.id" class="editor-id-tag">ID: {{ state.templateEditor.form.id }}</span>
              </div>
              <div class="editor-actions">
                <el-button v-if="state.templateEditor.form.isBuiltin" type="warning" plain size="small" @click="resetCurrentBuiltinTemplate">恢复出厂默认</el-button>
                <el-button v-if="state.templateEditor.form.id && !state.templateEditor.form.isBuiltin" type="danger" plain size="small" @click="deleteCurrentTemplate">删除方案</el-button>
                <el-button v-if="state.templateEditor.form.id" size="small" @click="saveAsNewTemplate">另存为新方案</el-button>
                <el-button type="primary" size="small" @click="saveTemplate">保存方案</el-button>
              </div>
            </div>
          </template>

          <!-- 基础属性表单 -->
          <el-form label-width="84px" size="small" class="template-props-form">
            <el-row :gutter="16">
              <el-col :span="14">
                <el-form-item label="方案名称">
                  <el-input v-model="state.templateEditor.form.name" placeholder="例如: ZTE C300 自营宽带" />
                </el-form-item>
              </el-col>
              <el-col :span="10">
                <el-form-item label="所属厂商">
                  <el-select v-model="state.templateEditor.form.vendor" @change="handleTemplateVendorChange">
                    <el-option label="中兴 (ZTE)" value="zte" />
                    <el-option label="华为 (Huawei)" value="huawei" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="适用型号">
                  <el-checkbox-group v-model="state.templateEditor.form.deviceProfiles">
                    <el-checkbox-button label="zte-c300">中兴 C300</el-checkbox-button>
                    <el-checkbox-button label="zte-c600">中兴 C600 (TITAN)</el-checkbox-button>
                    <el-checkbox-button label="huawei-ma5800">华为 MA5800</el-checkbox-button>
                  </el-checkbox-group>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="方案说明">
                  <el-input v-model="state.templateEditor.form.remark" placeholder="说明该方案业务场景与打标规则" />
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>

          <!-- 变量快捷插入胶囊条 -->
          <div class="variable-palette-toolbar">
            <div class="palette-hint">
              <span class="hint-icon">💡</span>
              <span>已启用右键快速插入：在下方编辑框内<strong>点击鼠标右键</strong>，即可在光标处弹出变量菜单插入机框、VLAN、端口等</span>
            </div>
            <el-button 
              link 
              type="primary" 
              size="small" 
              @click="showVariablePalette = !showVariablePalette"
            >
              {{ showVariablePalette ? '收起顶部备用变量栏 ▲' : '展开顶部备用变量栏 ▼' }}
            </el-button>
          </div>

          <!-- 可折叠的备用胶囊栏 -->
          <el-collapse-transition>
            <div v-if="showVariablePalette" class="variable-palette">
              <div class="palette-chips">
                <el-button
                  v-for="v in state.templateEditor.variables"
                  :key="v.name"
                  size="small"
                  round
                  class="variable-chip-btn"
                  :title="v.desc"
                  @click="insertTemplateVariable(v.name)"
                >
                  <code>&#123;&#123;{{ v.name }}&#125;&#125;</code>
                  <span class="chip-label">{{ v.label }}</span>
                </el-button>
              </div>
            </div>
          </el-collapse-transition>

          <!-- 命令代码多行编辑框 -->
          <div class="template-editor-box">
            <div class="editor-subhead">
              <span>命令模板文本 (使用 <code>&#123;&#123;variable&#125;&#125;</code> 占位符)</span>
              <span class="editor-tip">💡 在编辑区内【鼠标右键】可快速插入变量；仅供生成只读配置预览</span>
            </div>
            <el-input
              ref="templateEditorInputRef"
              v-model="state.templateEditor.form.commandTemplate"
              type="textarea"
              :rows="14"
              placeholder="请在此输入配置命令行模板，在光标处右键即可弹出变量菜单插入 {{chassis}}、{{board}}、{{pon}}、{{onuId}}、{{ethPort}} 等..."
              class="code-textarea"
              @contextmenu="handleTemplateEditorContextMenu($event)"
            />

            <!-- 鼠标右键浮层菜单 -->
            <teleport to="body">
              <div
                v-if="templateContextMenu.visible"
                class="editor-context-menu"
                :style="{ left: templateContextMenu.x + 'px', top: templateContextMenu.y + 'px' }"
                @click.stop
              >
                <div class="context-menu-header">
                  <span class="menu-title">🧩 插入模板变量</span>
                  <span class="menu-close" @click="closeTemplateContextMenu" title="关闭 (Esc)">✕</span>
                </div>
                <div class="context-menu-body">
                  <div v-for="group in groupedTemplateVariables" :key="group.key" class="menu-group">
                    <div class="menu-group-title">{{ group.title }}</div>
                    <div class="menu-items-grid">
                      <div
                        v-for="v in group.items"
                        :key="v.name"
                        class="menu-item"
                        :title="v.desc"
                        @click="insertVariableFromContextMenu(v.name)"
                      >
                        <div class="item-code">&#123;&#123;{{ v.name }}&#125;&#125;</div>
                        <div class="item-label">{{ v.label }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="context-menu-footer">
                  <div class="footer-btn" @click="copyAllTemplateText">📋 复制全部模板</div>
                  <div class="footer-btn text-danger" @click="clearTemplateText">🗑️ 清空文本</div>
                </div>
              </div>
            </teleport>
          </div>

          <!-- 实时演练与渲染预览 -->
          <div class="preview-playground">
            <div class="playground-header">
              <strong>🔍 实时演算预览 (根据测试样本即时渲染最终命令)</strong>
              <el-button size="small" @click="copyEditorPreview">复制预览命令</el-button>
            </div>
            <div class="playground-body">
              <div class="sample-param-bar">
                <span class="param-bar-label">样本参数：</span>
                <span class="param-chip">机框: {{ state.templateEditor.testParams.chassis }}</span>
                <span class="param-chip">板卡/PON: {{ state.templateEditor.testParams.board }}/{{ state.templateEditor.testParams.pon }}</span>
                <span class="param-chip">ONU ID: {{ state.templateEditor.testParams.onuId }}</span>
                <span class="param-chip">SN: {{ state.templateEditor.testParams.serial }}</span>
                <span class="param-chip">外层SVLAN: {{ state.templateEditor.testParams.outerVlan }}</span>
                <span class="param-chip">物理端口: {{ state.templateEditor.testParams.ethPort }}</span>
              </div>
              <pre class="rendered-code-block">{{ renderedEditorPreview || '请在上方输入命令模板进行实时演练...' }}</pre>
            </div>
          </div>
        </el-card>
      </div>
    </div>
  </section>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 配置方案管理。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "ConfigTemplatesView",
  setup() {
    return useAppContext();
  }
};
</script>
