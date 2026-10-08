<template>
  <section>
    <div class="feishu-settings-layout">
      <!-- 顶部 Hero 机器人控制中心 -->
      <div class="feishu-hero-panel">
        <div class="feishu-hero-header">
          <div class="feishu-hero-info">
            <div class="feishu-hero-icon">
              <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.38-1 1.72V7h2a7 7 0 0 1 7 7v1h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1v1a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-1H1a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h1v-1a7 7 0 0 1 7-7h2V5.72A2.001 2.001 0 0 1 10 4a2 2 0 0 1 2-2m-4 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M7 17v1h10v-1z"/></svg>
            </div>
            <div>
              <div class="feishu-hero-title-row">
                <h1 class="feishu-hero-title">飞书智能运维机器人</h1>
                <el-tag :type="state.feishu.connection.state === 'connected' ? 'success' : state.feishu.enabled ? 'warning' : 'info'" size="large" effect="dark" class="feishu-status-pill">
                  <span class="status-indicator-dot" :class="state.feishu.connection.state === 'connected' ? 'online' : state.feishu.enabled ? 'warning' : 'offline'"></span>
                  {{ state.feishu.connection.state === 'connected' ? '已连接' : state.feishu.enabled ? '已启用但未连接' : '默认关闭' }}
                </el-tag>
              </div>
              <p class="feishu-hero-desc">
                基于飞书开放平台 WebSocket 长连接模式，无需公网 IP 和端口映射，为一线运维人员提供单聊极速查单、实时光衰诊断、整口健康大盘及 Pi 专家排障能力。
              </p>
            </div>
          </div>
          <div class="feishu-hero-actions">
            <el-button
              type="success"
              size="large"
              :disabled="!state.feishu.languageProviderReady"
              :loading="state.feishu.saving"
              @click="enableFeishu"
            >
              ▶ 启用飞书机器人
            </el-button>
            <el-button
              type="danger"
              plain
              size="large"
              :disabled="!state.feishu.enabled"
              :loading="state.feishu.saving"
              @click="stopFeishu"
            >
              ⏹ 停止服务
            </el-button>
            <el-button size="large" @click="loadFeishuSettings" title="重新获取连接状态与凭据状态">
              🔄 刷新状态
            </el-button>
          </div>
        </div>

        <!-- 运行状态横向指标条 -->
        <div class="feishu-metrics-bar">
          <div class="feishu-metric-item">
            <span class="feishu-metric-label">长连接通信</span>
            <span class="feishu-metric-value" :class="state.feishu.connection.state === 'connected' ? 'text-success' : 'text-muted'">
              {{ state.feishu.connection.state === 'connected' ? '🟢 链路正常 (WebSocket)' : state.feishu.enabled ? '🟠 连接建立中' : '⚪ 未建立' }}
            </span>
          </div>
          <div class="feishu-metric-divider"></div>
          <div class="feishu-metric-item">
            <span class="feishu-metric-label">飞书应用凭据</span>
            <span class="feishu-metric-value" :class="state.feishu.credentialConfigured ? 'text-success' : 'text-warning'">
              {{ state.feishu.credentialConfigured ? '🟢 已配置安全凭据' : '⚠️ 待配置 APP 凭据' }}
            </span>
          </div>
          <div class="feishu-metric-divider"></div>
          <div class="feishu-metric-item">
            <span class="feishu-metric-label">自然语言解析 (Jev)</span>
            <span class="feishu-metric-value" :class="state.feishu.languageProviderReady ? 'text-success' : 'text-warning'">
              {{ state.feishu.languageProviderReady ? '🟢 模型就绪 (' + (state.feishu.languageModel || 'jev-latest') + ')' : '⚠️ 待配置 API KEY' }}
            </span>
          </div>
          <div class="feishu-metric-divider"></div>
          <div class="feishu-metric-item">
            <span class="feishu-metric-label">Pi Agent 专家</span>
            <span class="feishu-metric-value" :class="state.feishu.piAgentLanguageApiKeyConfigured ? 'text-success' : 'text-muted'">
              {{ state.feishu.piAgentLanguageApiKeyConfigured ? '🟢 已就绪' : '⚪ 可选' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 状态警告栏 -->
      <el-alert v-if="state.feishu.error" :title="state.feishu.error" type="warning" :closable="false" show-icon class="feishu-status-alert" />
      <el-alert
        v-else-if="state.feishu.enabled && state.feishu.connection.state !== 'connected'"
        :title="state.feishu.connection.state === 'connecting' || state.feishu.connection.state === 'reconnecting'
          ? '飞书长连接仍在重试；请确认飞书开放平台已启用机器人，并将事件订阅方式设为“使用长连接接收事件/回调”。'
          : '飞书机器人已启用但尚未连接；可点击“启用”重试。'"
        type="warning"
        :closable="false"
        show-icon
        class="feishu-status-alert"
      />

      <!-- 折叠式飞书开放平台 3 步配置指南 -->
      <el-collapse class="feishu-guide-collapse">
        <el-collapse-item name="guide">
          <template #title>
            <div class="feishu-guide-title">
              <span>💡 飞书开放平台 3 步极速接入指南 (无需公网 IP，长连接安全模式)</span>
            </div>
          </template>
          <div class="feishu-guide-content">
            <div class="feishu-guide-step">
              <div class="step-num">1</div>
              <div class="step-body">
                <strong>创建企业自建应用</strong>
                <p>登录 <a href="https://open.feishu.cn" target="_blank">飞书开放平台 (open.feishu.cn)</a>，创建“企业自建应用”，进入“凭证与基础信息”获取 <code>App ID</code> 和 <code>App Secret</code> 填入下方卡片。</p>
              </div>
            </div>
            <div class="feishu-guide-step">
              <div class="step-num">2</div>
              <div class="step-body">
                <strong>添加机器人能力并发布</strong>
                <p>在左侧导航进入“添加应用能力”，添加“机器人”；并在“版本管理与发布”中创建并发布版本（可设置为仅企业内部运维人员可见）。</p>
              </div>
            </div>
            <div class="feishu-guide-step">
              <div class="step-num">3</div>
              <div class="step-body">
                <strong>开启长连接事件订阅</strong>
                <p>进入“事件与回调”，将事件订阅方式配置为<strong>“使用长连接接收事件”</strong>（无需公网 IP 和域名），并添加接收消息 <code>im.message.receive_v1</code> 与卡片回调事件权限。</p>
              </div>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <!-- 四大配置卡片网格 -->
      <div class="feishu-cards-grid">
        <!-- 卡片 1：官方凭据 -->
        <el-card shadow="never" class="content-card feishu-card">
          <template #header>
            <div class="card-header-line">
              <span>飞书机器人凭据</span>
              <el-tag :type="state.feishu.credentialConfigured ? 'success' : 'info'" size="small">
                {{ state.feishu.credentialConfigured ? '已配置' : '未配置' }}
              </el-tag>
            </div>
          </template>
          <el-form label-position="top">
            <el-form-item label="飞书APP ID"><el-input v-model="state.feishu.appId" placeholder="cli_..." /></el-form-item>
            <el-form-item label="APP SECRET"><el-input v-model="state.feishu.appSecret" type="password" show-password autocomplete="new-password" placeholder="请输入 APP SECRET" /></el-form-item>
            <div class="feishu-card-footer">
              <el-button type="primary" :loading="state.feishu.credentialSaving" @click="saveFeishuCredentials">保存飞书APP ID和APP SECRET</el-button>
            </div>
          </el-form>
        </el-card>

        <!-- 卡片 2：Jev 大模型 -->
        <el-card shadow="never" class="content-card feishu-card">
          <template #header>
            <div class="card-header-line">
              <span>飞书查询 Jev 路由大模型</span>
              <el-tag :type="state.feishu.languageProviderReady ? 'success' : 'info'" size="small">
                {{ state.feishu.languageProviderReady ? '就绪' : '未就绪' }}
              </el-tag>
            </div>
          </template>
          <el-form label-position="top">
            <el-form-item label="路由名称"><el-input v-model="state.feishu.languageProviderName" placeholder="Jev 或 TypeSafe Jev" /></el-form-item>
            <el-form-item label="API 请求地址（可留空）"><el-input v-model="state.feishu.languageEndpoint" placeholder="Jev 配置无需填写" /></el-form-item>
            <el-form-item label="默认模型"><el-input v-model="state.feishu.languageModel" placeholder="jev-latest" /></el-form-item>
            <el-form-item label="上游格式">
              <el-select v-model="state.feishu.languageFormat" style="width: 100%">
                <el-option label="Chat Completions（兼容）" value="chat-completions" />
                <el-option label="Responses（原生）" value="responses" />
              </el-select>
            </el-form-item>
            <el-form-item label="Jev API KEY"><el-input v-model="state.feishu.languageApiKey" type="password" show-password autocomplete="new-password" placeholder="请输入 Jev API KEY" /></el-form-item>
            <div class="feishu-card-footer">
              <el-button type="primary" :loading="state.feishu.languageSaving" @click="saveLanguageProvider">保存大模型配置</el-button>
              <el-button type="success" :disabled="!state.feishu.languageProviderReady" :loading="state.feishu.saving" @click="enableFeishu">启用</el-button>
              <el-button :disabled="!state.feishu.enabled" :loading="state.feishu.saving" @click="stopFeishu">停止</el-button>
            </div>
          </el-form>
        </el-card>

        <!-- 卡片 3：Pi Agent 排障大模型 -->
        <el-card shadow="never" class="content-card feishu-card">
          <template #header>
            <div class="card-header-line">
              <span>Pi Agent 原大模型配置</span>
              <el-tag :type="state.feishu.piAgentLanguageApiKeyConfigured ? 'success' : 'info'" size="small">
                {{ state.feishu.piAgentLanguageApiKeyConfigured ? '已配置' : '未配置' }}
              </el-tag>
            </div>
          </template>
          <el-form label-position="top">
            <el-form-item label="供应商名称"><el-input v-model="state.feishu.piAgentLanguageProviderName" placeholder="例如 MiniMax / OpenAI Compatible" /></el-form-item>
            <el-form-item label="API 请求地址"><el-input v-model="state.feishu.piAgentLanguageEndpoint" placeholder="https://api.example.com/v1" /></el-form-item>
            <el-form-item label="默认模型"><el-input v-model="state.feishu.piAgentLanguageModel" placeholder="例如 MiniMax-M2.7" /></el-form-item>
            <el-form-item label="上游格式">
              <el-select v-model="state.feishu.piAgentLanguageFormat" style="width: 100%">
                <el-option label="Chat Completions（兼容）" value="chat-completions" />
                <el-option label="Responses（原生）" value="responses" />
              </el-select>
            </el-form-item>
            <el-form-item label="Pi Agent API KEY"><el-input v-model="state.feishu.piAgentLanguageApiKey" type="password" show-password autocomplete="new-password" placeholder="请输入 Pi Agent API KEY" /></el-form-item>
            <div class="feishu-card-footer">
              <el-button type="primary" :loading="state.feishu.piAgentLanguageSaving" @click="savePiAgentLanguage">保存配置</el-button>
            </div>
          </el-form>
        </el-card>

        <!-- 卡片 4：AnySearch 联网搜索 -->
        <el-card shadow="never" class="content-card feishu-card">
          <template #header>
            <div class="card-header-line">
              <span>AnySearch 智能联网搜索</span>
              <el-tag :type="state.anysearch.apiKey ? 'success' : 'info'" size="small">
                {{ state.anysearch.apiKey ? '已配置' : '默认未配置' }}
              </el-tag>
            </div>
          </template>
          <el-form label-position="top">
            <el-form-item label="AnySearch Key">
              <el-input v-model="state.anysearch.apiKey" show-password placeholder="as_sk_..." />
            </el-form-item>
            <div class="feishu-card-footer">
              <el-button type="primary" :loading="state.anysearch.saving" @click="saveAnySearchConfig">保存 AnySearch Key</el-button>
            </div>
          </el-form>
        </el-card>
      </div>
    </div>
  </section>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 飞书机器人设置。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "FeishuSettingsView",
  setup() {
    return useAppContext();
  }
};
</script>
