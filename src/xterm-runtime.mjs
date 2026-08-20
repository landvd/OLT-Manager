let xtermRuntimePromise;

export function loadXtermRuntime() {
  xtermRuntimePromise ||= Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit")
  ]).then(([xtermModule, fitModule]) => ({
    Terminal: xtermModule.Terminal || xtermModule.default?.Terminal || xtermModule.default,
    FitAddon: fitModule.FitAddon || fitModule.default?.FitAddon || fitModule.default
  }));
  return xtermRuntimePromise;
}
