// PON 台账内容指纹：桌面端打开台账时记下，保存时服务端比对，防止整表保存覆盖别处刚改的内容
// （例如飞书资料修改审批改了一级地址）。浏览器和 Node 共用，纯函数。
const FIELDS = ["oltIp", "chassis", "board", "pon", "ponPort", "outerVlan", "address"];

/** 按台账读取顺序（服务端 getPonPorts 的排序）计算 FNV-1a 指纹。 */
export function ponLedgerRevision(rows = []) {
  const text = JSON.stringify((Array.isArray(rows) ? rows : []).map((row) =>
    FIELDS.map((field) => String((field === "board" ? row?.board ?? row?.slot : row?.[field]) ?? "").trim())));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${(Array.isArray(rows) ? rows.length : 0)}-${hash.toString(16).padStart(8, "0")}`;
}
