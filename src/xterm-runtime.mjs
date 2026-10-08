let xtermRuntimePromise;

export function loadXtermRuntime() {
  xtermRuntimePromise ||= Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    // Node 测试环境没有 DOM，也无法加载 CSS 模块。
    typeof document === "undefined" ? null : import("./xterm-styles.js")
  ]).then(([xtermModule, fitModule]) => ({
    Terminal: xtermModule.Terminal || xtermModule.default?.Terminal || xtermModule.default,
    FitAddon: fitModule.FitAddon || fitModule.default?.FitAddon || fitModule.default
  }));
  return xtermRuntimePromise;
}
