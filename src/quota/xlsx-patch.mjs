// 预算书模板局部改写（ADR-092）：以 zip 方式打开 .xlsx，只改写需要填数据的工作表 XML，
// 其余部件（样式、主题、批注、控件、打印设置等）原样保留。SheetJS 社区版直接写文件会丢样式，所以只借用它的 CFB 读写 zip。
import XLSX from "xlsx";

const { CFB } = XLSX;

const decode = (text) => String(text).replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const encode = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const columnNumber = (column) => [...column].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CELL_REF = /((?:'(?:[^']|'')+'|[^\s!(),+\-*/&=<>:^'"]+)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![\w(])/g;

/**
 * 改写公式里的单元格引用（跳过双引号字符串和函数名）。
 * mapper(sheetName|null, row1, row2|null) 返回 [newRow1, newRow2]。
 */
export function mapFormulaRows(formula, mapper) {
  return String(formula).split(/("(?:[^"]|"")*")/).map((segment, index) => (index % 2 ? segment : segment.replace(CELL_REF,
    (all, sheet, d1, c1, d2, r1, d3, c2, d4, r2, offset, whole) => {
      const previous = whole[offset - 1];
      if (previous && /[A-Za-z0-9_.]/.test(previous)) return all;
      const sheetName = sheet ? sheet.slice(0, -1).replace(/^'|'$/g, "").replace(/''/g, "'") : null;
      const [n1, n2] = mapper(sheetName, Number(r1), r2 === undefined ? null : Number(r2));
      return `${sheet || ""}${d1}${c1}${d2}${n1}${r2 === undefined ? "" : `:${d3}${c2}${d4}${n2}`}`;
    }))).join("");
}

export class XlsxPackage {
  constructor(buffer) {
    this.zip = CFB.read(buffer, { type: "buffer" });
    const workbook = this.part("xl/workbook.xml");
    const rels = this.part("xl/_rels/workbook.xml.rels");
    if (!workbook || !rels) throw new Error("不是有效的 .xlsx 文件");
    this.sheets = {};
    for (const match of workbook.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
      const rel = rels.match(new RegExp(`<Relationship [^>]*Id="${escapeRegExp(match[2])}"[^>]*>`));
      if (!rel) continue;
      this.sheets[decode(match[1])] = `xl/${rel[0].match(/Target="([^"]+)"/)[1].replace(/^\/?xl\//, "")}`;
    }
  }

  entry(path) {
    return this.zip.FileIndex[this.zip.FullPaths.indexOf(`Root Entry/${path}`)];
  }

  part(path) {
    const entry = this.entry(path);
    return entry ? Buffer.from(entry.content).toString("utf8") : null;
  }

  setPart(path, text) {
    const entry = this.entry(path);
    if (!entry) throw new Error(`模板缺少部件 ${path}`);
    entry.content = Buffer.from(text, "utf8");
    entry.size = entry.content.length;
  }

  hasSheet(name) {
    return Boolean(this.sheets[name]);
  }

  sheet(name) {
    if (!this.sheets[name]) throw new Error(`模板缺少工作表“${name}”`);
    return this.part(this.sheets[name]);
  }

  setSheet(name, xml) {
    this.setPart(this.sheets[name], xml);
  }

  calcPr() {
    return this.part("xl/workbook.xml").match(/<calcPr[^>]*\/?>/)?.[0] || "";
  }

  toBuffer() {
    return CFB.write(this.zip, { type: "buffer", fileType: "zip", compression: true });
  }

  sharedStrings() {
    this.sharedStringCache ||= [...(this.part("xl/sharedStrings.xml") || "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((match) => decode([...match[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
    return this.sharedStringCache;
  }

  /** 读某行各单元格的样式序号 { 列: s }。 */
  rowStyles(sheetName, row) {
    const match = this.sheet(sheetName).match(new RegExp(`<row r="${row}"[^>]*>([\\s\\S]*?)</row>`));
    if (!match) throw new Error(`${sheetName} 没有第 ${row} 行`);
    return Object.fromEntries([...match[1].matchAll(/<c r="([A-Z]+)\d+"(?: s="(\d+)")?/g)].map((cell) => [cell[1], cell[2]]));
  }

  /** 找某列文字（去掉空白后）等于 text 的第一行，支持共享字符串和内联字符串。 */
  findRowByText(sheetName, column, text) {
    const strings = this.sharedStrings();
    const wanted = String(text).replace(/\s/g, "");
    for (const match of this.sheet(sheetName).matchAll(new RegExp(`<c r="${column}(\\d+)"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`, "g"))) {
      const [, row, attrs, body = ""] = match;
      let value = null;
      if (/t="s"/.test(attrs)) value = strings[Number(body.match(/<v>(\d+)<\/v>/)?.[1])];
      else if (/t="inlineStr"/.test(attrs)) value = decode([...body.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
      if (value !== null && value !== undefined && value.replace(/\s/g, "") === wanted) return Number(row);
    }
    return null;
  }

  /**
   * 在 sheetName 的第 at 行前插入 count 行（at 及以下整体下移），新行复制 styleRow 的行属性与单元格样式。
   * 同步调整：所有工作表中指向该表的公式、共享公式范围、定义名称（打印 / 筛选区域）、本表合并单元格、
   * 条件格式、数据有效性和 dimension。extraMerges 为新行要合并的列对（例如表二 E:F）；
   * dataFirst 给出时，完全落在数据区内的条件格式扩大到整个数据区。
   */
  insertRows(sheetName, at, count, styleRow, { extraMerges = [], dataFirst = null } = {}) {
    if (!(count > 0)) return;
    const shift = (row) => (row >= at ? row + count : row);
    const shiftPair = (r1, r2) => [shift(r1), r2 === null ? null : shift(r2)];
    for (const [name, path] of Object.entries(this.sheets)) {
      const xml = this.part(path);
      const local = name === sheetName;
      const next = xml.replace(/(<f[^>]*>)([^<]*)(<\/f>)/g, (all, open, body, close) => {
        const mapped = mapFormulaRows(decode(body), (sheet, r1, r2) => ((local && sheet === null) || sheet === sheetName ? shiftPair(r1, r2) : [r1, r2]));
        const openTag = local ? open.replace(/ref="([^"]+)"/, (m, ref) => `ref="${mapFormulaRows(ref, (s, a, b) => shiftPair(a, b))}"`) : open;
        return openTag + encode(mapped) + close;
      });
      if (next !== xml) this.setPart(path, next);
    }
    const workbook = this.part("xl/workbook.xml").replace(/(<definedName [^>]*>)([^<]*)(<\/definedName>)/g, (all, open, body, close) =>
      open + encode(mapFormulaRows(decode(body), (sheet, r1, r2) => (sheet === sheetName ? shiftPair(r1, r2) : [r1, r2]))) + close);
    this.setPart("xl/workbook.xml", workbook);

    let xml = this.sheet(sheetName);
    const shiftRefs = (text) => text.replace(/([A-Z]{1,3})(\d+)/g, (m, column, row) => column + shift(Number(row)));
    xml = xml.replace(/<row r="(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (all, row, attrs, tail, body) => {
      if (tail === "/>") return `<row r="${shift(Number(row))}"${attrs}/>`;
      return `<row r="${shift(Number(row))}"${attrs}>${body.replace(/<c r="([A-Z]{1,3})(\d+)"/g, (m, column, r) => `<c r="${column}${shift(Number(r))}"`)}</row>`;
    });
    xml = xml.replace(/<mergeCell ref="([^"]+)"\/>/g, (m, ref) => `<mergeCell ref="${shiftRefs(ref)}"/>`);
    xml = xml.replace(/(<(?:conditionalFormatting|dataValidation)\b[^>]*sqref=")([^"]+)"/g, (m, open, ref) => `${open}${shiftRefs(ref)}"`);
    xml = xml.replace(/<dimension ref="([^"]+)"\/>/, (m, ref) => `<dimension ref="${shiftRefs(ref)}"/>`);

    const template = xml.match(new RegExp(`<row r="${styleRow}"([^>]*)>([\\s\\S]*?)</row>`));
    if (!template) throw new Error(`${sheetName} 没有样式行 ${styleRow}`);
    const newRows = Array.from({ length: count }, (_, index) => {
      const row = at + index;
      const cells = template[2].replace(/<c r="([A-Z]{1,3})\d+"( s="\d+")?[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (m, column, style) => `<c r="${column}${row}"${style || ""}/>`);
      return `<row r="${row}"${template[1]}>${cells}</row>`;
    }).join("");
    const anchor = new RegExp(`(<row r="${at + count}"[ >/])`);
    xml = anchor.test(xml) ? xml.replace(anchor, `${newRows}$1`) : xml.replace("</sheetData>", `${newRows}</sheetData>`);

    const merges = [];
    for (let index = 0; index < count; index += 1) {
      for (const [from, to] of extraMerges) merges.push(`<mergeCell ref="${from}${at + index}:${to}${at + index}"/>`);
    }
    if (merges.length) {
      xml = /<mergeCells /.test(xml)
        ? xml.replace(/<mergeCells count="(\d+)">/, (m, total) => `<mergeCells count="${Number(total) + merges.length}">`).replace("</mergeCells>", `${merges.join("")}</mergeCells>`)
        : xml.replace("</sheetData>", `</sheetData><mergeCells count="${merges.length}">${merges.join("")}</mergeCells>`);
    }
    if (dataFirst !== null) {
      const dataLast = at + count;
      xml = xml.replace(/(<conditionalFormatting\b[^>]*sqref=")([^"]+)"/g, (m, open, ref) => {
        const parts = ref.split(" ").map((part) => part.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/));
        if (parts.some((part) => !part || Number(part[2]) < dataFirst || Number(part[4] || part[2]) > dataLast)) return m;
        const columns = [...new Set(parts.flatMap((part) => [part[1], part[3] || part[1]]))];
        return `${open}${columns.map((column) => `${column}${dataFirst}:${column}${dataLast}`).join(" ")}"`;
      });
    }
    this.setSheet(sheetName, xml);
  }

  /**
   * 写单元格。value：{ str } 内联字符串、{ num } 数字、{ f, v } 公式与缓存值；style 不给时保留原样式。
   * 字符串用内联字符串，避免改动共享字符串表。
   */
  setCells(sheetName, cells) {
    let xml = this.sheet(sheetName);
    for (const [ref, value] of Object.entries(cells)) {
      const [, column, row] = ref.match(/^([A-Z]+)(\d+)$/);
      const rowPattern = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
      const rowMatch = xml.match(rowPattern);
      if (!rowMatch) throw new Error(`${sheetName} 没有第 ${row} 行`);
      const cellPattern = new RegExp(`<c r="${ref}"(?: s="(\\d+)")?[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      const existing = rowMatch[2].match(cellPattern);
      const style = value.style ?? existing?.[1];
      const styleAttr = style !== undefined && style !== null ? ` s="${style}"` : "";
      let cell;
      if (value.str !== undefined) {
        cell = value.str === ""
          ? `<c r="${ref}"${styleAttr}/>`
          : `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${encode(value.str)}</t></is></c>`;
      } else if (value.f !== undefined) {
        cell = `<c r="${ref}"${styleAttr}><f>${encode(value.f)}</f>${value.v === undefined ? "" : `<v>${value.v}</v>`}</c>`;
      } else {
        cell = `<c r="${ref}"${styleAttr}><v>${Number(value.num)}</v></c>`;
      }
      let body;
      if (existing) {
        body = rowMatch[2].replace(cellPattern, cell);
      } else {
        const after = [...rowMatch[2].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].find((match) => columnNumber(match[1]) > columnNumber(column));
        body = after ? rowMatch[2].replace(after[0], cell + after[0]) : rowMatch[2] + cell;
      }
      xml = xml.replace(rowPattern, (m, open, oldBody, close) => open + body + close);
    }
    this.setSheet(sheetName, xml);
  }

  /** 只更新公式单元格的缓存值，公式本身不动；不是公式的格子跳过。 */
  setCachedValues(sheetName, values) {
    let xml = this.sheet(sheetName);
    for (const [ref, value] of Object.entries(values)) {
      xml = xml.replace(new RegExp(`(<c r="${ref}"[^>]*>)(<f[^>]*>[^<]*</f>|<f[^>]*/>)(?:<v>[^<]*</v>)?`), (m, open, formula) => `${open.replace(/ t="[^"]*"/, "")}${formula}<v>${Number(value)}</v>`);
    }
    this.setSheet(sheetName, xml);
  }

  /** 克隆一个单元格样式并换数字格式，返回新样式序号（同一格式只加一次）。 */
  addNumberFormatStyle(baseStyle, formatCode) {
    this.styleCache ||= new Map();
    const key = `${baseStyle}|${formatCode}`;
    if (this.styleCache.has(key)) return this.styleCache.get(key);
    let styles = this.part("xl/styles.xml");
    const existingFormat = [...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"\/>/g)].find((match) => decode(match[2]) === formatCode);
    let formatId = existingFormat ? Number(existingFormat[1]) : Math.max(175, ...[...styles.matchAll(/numFmtId="(\d+)"/g)].map((match) => Number(match[1]))) + 1;
    if (!existingFormat) {
      const format = `<numFmt numFmtId="${formatId}" formatCode="${encode(formatCode)}"/>`;
      styles = /<numFmts /.test(styles)
        ? styles.replace(/<numFmts count="(\d+)">/, (m, total) => `<numFmts count="${Number(total) + 1}">${format}`)
        : styles.replace(/(<styleSheet[^>]*>)/, `$1<numFmts count="1">${format}</numFmts>`);
    }
    const block = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
    const xfs = [...block[2].matchAll(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match) => match[0]);
    const base = xfs[Number(baseStyle)] || xfs[0];
    const clone = base.replace(/numFmtId="\d+"/, `numFmtId="${formatId}"`).replace(/^<xf /, (m) => (/applyNumberFormat=/.test(base) ? m : "<xf applyNumberFormat=\"1\" "));
    styles = styles.replace(block[0], `<cellXfs count="${xfs.length + 1}">${block[2]}${clone}</cellXfs>`);
    this.setPart("xl/styles.xml", styles);
    this.styleCache.set(key, xfs.length);
    return xfs.length;
  }
}
