let xlsxModulePromise;

export function loadXlsx() {
  xlsxModulePromise ||= import("xlsx").then((module) => module.default || module);
  return xlsxModulePromise;
}
