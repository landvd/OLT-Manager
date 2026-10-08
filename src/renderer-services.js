import { createLocalAuthClient } from "./local-auth-client.mjs";
import { createProjectApi } from "./project-api.mjs";

// 渲染端共享单例：认证客户端持有会话 token，所有组件必须复用同一实例。
export const localAuthClient = createLocalAuthClient();
export const projectApi = createProjectApi({ fetch: (path, options) => localAuthClient.fetch(path, options) });

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
