export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
