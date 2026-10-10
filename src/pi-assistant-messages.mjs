// 桌面内置终端 Pi 助手的消息辅助：会话 key、回答清洗与建议命令提取（前端与测试共用）。

// 每台 OLT 一条永久对话（ADR-085）。
export function piDesktopConversationKey(oltId) {
  const id = String(oltId ?? "").trim();
  return id ? `desktop:${id}` : "";
}

export function cleanPiReply(reply) {
  return String(reply || "").replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}

const COMMAND_PREFIXES = ["show ", "display ", "interface ", "ont ", "configure ", "config"];

export function extractPiCommands(reply) {
  const commands = [];
  const regex = /```(?:[a-zA-Z0-9_-]*\n)?([\s\S]*?)```|`([^`\n]{3,80})`/g;
  let match;
  while ((match = regex.exec(String(reply || ""))) !== null) {
    const cmd = (match[1] || match[2] || "").trim();
    if (cmd && !cmd.includes("\n") && COMMAND_PREFIXES.some((prefix) => cmd.startsWith(prefix)) && !commands.includes(cmd)) {
      commands.push(cmd);
    }
  }
  return commands;
}

// 服务端历史 → 对话框消息；回答重新提取建议命令。
export function historyToAssistantMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === "user" || message.role === "assistant") && message.content)
    .map((message) => message.role === "user"
      ? { role: "user", content: String(message.content) }
      : { role: "assistant", content: cleanPiReply(message.content), commands: extractPiCommands(cleanPiReply(message.content)) });
}
