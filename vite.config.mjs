import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const NODE_MODULES_MARKER = "/node_modules/";

function normalizeModuleId(id) {
  return String(id || "").replaceAll("\\", "/");
}

/**
 * Keep the largest browser dependencies in stable, named chunks.
 *
 * This keeps dependency families in stable, named chunks. Heavy feature-only
 * dependencies may additionally be loaded through explicit runtime seams.
 */
export function manualChunks(id) {
  const normalizedId = normalizeModuleId(id);
  if (!normalizedId.includes(NODE_MODULES_MARKER)) return undefined;

  if (normalizedId.includes("/node_modules/@xterm/")) return "vendor-xterm";
  if (normalizedId.includes("/node_modules/xlsx/")) return "vendor-xlsx";
  if (
    normalizedId.includes("/node_modules/element-plus/") ||
    normalizedId.includes("/node_modules/@element-plus/")
  ) {
    return "vendor-element-plus";
  }
  if (
    normalizedId.includes("/node_modules/vue/") ||
    normalizedId.includes("/node_modules/@vue/") ||
    normalizedId.includes("/node_modules/@vueuse/")
  ) {
    return "vendor-vue";
  }

  return "vendor-common";
}

export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks
      }
    }
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
