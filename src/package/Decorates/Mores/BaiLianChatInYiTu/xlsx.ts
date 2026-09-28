/*
 * @Description: 生成 Excel 工作簿（.xlsx）
 *
 * 布局（两个理由：一是"通读"和"取数"是两种需求，二是 Excel 的列宽是**按列共享**的，
 * 正文和表格没法在同一列上同时好看）：
 *   sheet1「内容」   —— 单列逐行的文本视图，长句自动换行，用来通读
 *   sheetN「表格N」  —— 每个 Markdown 表格一个独立工作表，落成**真实单元格**
 *                        （表头加底色、冻结首行、列宽按内容自适应），可以直接排序、求和、
 *                        做透视——这才是把内容导成 Excel 的意义
 *
 * 字符串一律用 inlineStr（不建 sharedStrings.xml）：少一个 part、少一层索引，
 * 而导出这种体量根本吃不到共享字符串省下的体积。
 *
 * ★ 数字要写成数字：纯数字cell 走 `<v>`，否则 Excel 里全是被标记为"文本"的绿三角，
 *   没法直接求和 —— 这是最常见的"导出的 Excel 不能用"的原因。
 */

import { MdBlock, parseInlineRuns, runsToText } from './markdown'
import { buildZip, ZipEntry } from './zip'
import {
  XML_DECL,
  NS,
  esc,
  escAttr,
  contentTypesXml,
  rootRelsXml,
  relsXml,
  coreXml,
  appXml
} from './ooxml'

export interface XlsxOptions {
  /** 工作簿标题（写入文件属性） */
  title?: string
  /** 首个工作表的表名，默认「内容」 */
  sheetName?: string
  author?: string
  when?: Date
}

/* ------------------------------ 单元格样式表 ------------------------------ */

/**
 * cellXfs 索引。含义集中在这里，避免 magic number 散落在生成逻辑里。
 * 顺序任意，但一旦定下就不要插队 —— 插队会让所有引用错位。
 */
const S = {
  NORMAL: 0, // 默认
  TITLE: 1, // 大标题：加粗加大
  TEXT: 2, // 正文：顶端对齐 + 自动换行
  HEAD: 3, // 表格表头：加粗 + 底色 + 边框 + 居中
  CELL: 4, // 表格数据单元格：边框 + 自动换行
  CODE: 5, // 等宽字体
  IND2: 6, // 正文缩进 2 字符（列表一级）
  IND4: 7,
  IND6: 8,
  IND8: 9
}

const xf = (opts: {
  font?: number
  fill?: number
  border?: number
  align?: string
}): string => {
  const o = opts || {}
  const fontId = o.font || 0
  const fillId = o.fill || 0
  const borderId = o.border || 0
  const attrs =
    `numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
    (fontId ? ' applyFont="1"' : '') +
    (fillId ? ' applyFill="1"' : '') +
    (borderId ? ' applyBorder="1"' : '')
  return `<xf ${attrs}${o.align ? ' applyAlignment="1"' : ''}>${o.align || ''}</xf>`
}

const ALIGN_WRAP_TOP = '<alignment vertical="top" wrapText="1"/>'
const ALIGN_CENTER = '<alignment horizontal="center" vertical="center" wrapText="1"/>'
const indAlign = (n: number) => `<alignment vertical="top" wrapText="1" indent="${n}"/>`

function stylesXml(): string {
  // CT_Font 子元素顺序：b → i → strike → ... → sz → color → name → family → charset
  const fonts =
    '<fonts count="5">' +
    '<font><sz val="11"/><color rgb="FF000000"/><name val="宋体"/><charset val="134"/></font>' +
    '<font><b/><sz val="13"/><color rgb="FF1F2430"/><name val="黑体"/><charset val="134"/></font>' +
    '<font><sz val="10"/><color rgb="FF000000"/><name val="宋体"/><charset val="134"/></font>' +
    '<font><sz val="10"/><color rgb="FF333333"/><name val="Consolas"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF000000"/><name val="宋体"/><charset val="134"/></font>' +
    '</fonts>'

  // fill 0 / 1 必须固定是 none 与 gray125，Excel 对此有硬性约定
  const fills =
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>'

  // CT_Border 顺序：left → right → top → bottom → diagonal
  const side = (tag: string) => `<${tag} style="thin"><color rgb="FF9AA5B1"/></${tag}>`
  const borders =
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>` +
    '</borders>'

  const cellXfs =
    '<cellXfs count="10">' +
    xf({}) +
    xf({ font: 1, align: ALIGN_WRAP_TOP }) +
    xf({ align: ALIGN_WRAP_TOP }) +
    xf({ font: 4, fill: 2, border: 1, align: ALIGN_CENTER }) +
    xf({ font: 2, border: 1, align: ALIGN_WRAP_TOP }) +
    xf({ font: 3, align: ALIGN_WRAP_TOP }) +
    xf({ align: indAlign(2) }) +
    xf({ align: indAlign(4) }) +
    xf({ align: indAlign(6) }) +
    xf({ align: indAlign(8) }) +
    '</cellXfs>'

  return (
    `${XML_DECL}<styleSheet xmlns="${NS.ss}">` +
    fonts +
    fills +
    borders +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    cellXfs +
    '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  )
}

/* ------------------------------ 工作表模型 ------------------------------ */

interface Cell {
  text: string
  style?: number
}

interface Row {
  cells: Array<Cell | null>
  height?: number
}

interface SheetSpec {
  name: string
  rows: Row[]
  /** 冻结前 N 行（表格 sheet 用来固定表头） */
  freezeRows?: number
  cols?: Array<{ width: number }>
}

/** 0 → A、25 → Z、26 → AA */
const colName = (n: number): string => {
  let s = ''
  let v = n + 1
  while (v > 0) {
    const r = (v - 1) % 26
    s = String.fromCharCode(65 + r) + s
    v = Math.floor((v - 1) / 26)
  }
  return s
}

/** 只有"看起来就是数字"的才写数值：开头的 0 是有意义的（编号 007），不能变 7 */
const NUMERIC_RE = /^-?(?:0|[1-9]\d{0,13})(?:\.\d+)?$/

function cellXml(cell: Cell, col: number, row: number): string {
  const ref = `${colName(col)}${row + 1}`
  const styleAttr = cell.style ? ` s="${cell.style}"` : ''
  const t = cell.text
  if (!t) return ''
  if (NUMERIC_RE.test(t)) {
    const n = Number(t)
    if (isFinite(n)) return `<c r="${ref}"${styleAttr}><v>${t}</v></c>`
  }
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`
}

function rowsXml(rows: Row[]): { xml: string; lastRow: number; lastCol: number } {
  let lastRow = 0
  let lastCol = 0
  const out: string[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue
    let cells = ''
    let used = 0
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c]
      if (!cell) continue
      const x = cellXml(cell, c, r)
      if (!x) continue
      cells += x
      used = c + 1
    }
    if (used > lastCol) lastCol = used
    if (cells) {
      lastRow = r + 1
      const h = row.height ? ` ht="${row.height}" customHeight="1"` : ''
      out.push(`<row r="${r + 1}"${h}>${cells}</row>`)
    } else {
      // 空行也要写出来：内容 sheet 靠它分隔段落，dimension 也才对得上
      out.push(`<row r="${r + 1}"/>`)
    }
  }
  return { xml: out.join(''), lastRow, lastCol: Math.max(1, lastCol) }
}

function sheetXml(sheet: SheetSpec, tabSelected: boolean): string {
  const { xml: sheetData, lastRow, lastCol } = rowsXml(sheet.rows)
  const dim = `A1:${colName(Math.max(0, lastCol - 1))}${Math.max(1, lastRow)}`

  const freeze = sheet.freezeRows
    ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="A${sheet.freezeRows + 1}" sqref="A${sheet.freezeRows + 1}"/>`
    : ''

  const cols =
    sheet.cols && sheet.cols.length
      ? '<cols>' +
        sheet.cols
          .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
          .join('') +
        '</cols>'
      : ''

  // CT_Worksheet 顺序：sheetViews → sheetFormatPr → cols → sheetData → mergeCells → pageMargins
  return (
    `${XML_DECL}<worksheet xmlns="${NS.ss}" xmlns:r="${NS.r}">` +
    `<dimension ref="${dim}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${tabSelected ? ' tabSelected="1"' : ''}>${freeze}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="16.5"/>` +
    cols +
    `<sheetData>${sheetData}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  )
}

function workbookXml(sheets: SheetSpec[]): string {
  const list = sheets
    .map((s, i) => `<sheet name="${escAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')
  return (
    `${XML_DECL}<workbook xmlns="${NS.ss}" xmlns:r="${NS.r}">` +
    `<workbookPr/>` +
    `<bookViews><workbookView activeTab="0"/></bookViews>` +
    `<sheets>${list}</sheets>` +
    `<calcPr calcId="191029"/>` +
    `</workbook>`
  )
}

/* ------------------------------ 内容布局 ------------------------------ */

const visualLen = (s: string): number => {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    n += c > 0x2e7f && c < 0xffe7 ? 2 : 1
  }
  return n
}

/** 缩进样式随列表层级：0→IND2、1→IND4、2→IND6、3→IND8 */
const indentStyle = (level: number) => [S.IND2, S.IND4, S.IND6, S.IND8][Math.min(3, Math.max(0, level))]

/** 表名净化：Excel 禁止这几个字符，且长度上限 31 */
const safeSheetName = (name: string, fallback: string): string => {
  const n = String(name || '')
    .replace(/[\\/?*[\]:]/g, '_')
    .replace(/^'+|'+$/g, '')
    .trim()
  return (n || fallback).slice(0, 31)
}

/** 内容 sheet：整条消息逐块落成一行行文本 */
function contentRows(blocks: MdBlock[]): Row[] {
  const rows: Row[] = []
  const push = (text: string, style?: number, height?: number) => {
    const row: Row = { cells: [{ text, style }] }
    if (height) row.height = height
    rows.push(row)
  }
  const blank = () => rows.push({ cells: [] })

  let tableNo = 0
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'heading') {
      if (rows.length) blank()
      push(runsToText(parseInlineRuns(b.text)), S.TITLE)
      continue
    }
    if (b.type === 'para') {
      // 段落内部的软换行拆成多行，Excel 里一个单元格塞多行换行符只会更难编辑
      const lines = b.text.split('\n')
      for (let k = 0; k < lines.length; k++) push(runsToText(parseInlineRuns(lines[k])))
      continue
    }
    if (b.type === 'item') {
      const marker = b.ordered ? `${b.index}. ` : '· '
      push(marker + runsToText(parseInlineRuns(b.text)), indentStyle(b.level))
      continue
    }
    if (b.type === 'quote') {
      const lines = b.text.split('\n')
      for (let k = 0; k < lines.length; k++) push(runsToText(parseInlineRuns(lines[k])), indentStyle(1))
      continue
    }
    if (b.type === 'code') {
      const lines = b.code.split('\n')
      for (let k = 0; k < lines.length; k++) push(lines[k], S.CODE)
      continue
    }
    if (b.type === 'hr') {
      push('————————————————')
      continue
    }
    if (b.type === 'table') {
      tableNo++
      push(`【表 ${tableNo}】${b.head.length} 列 × ${b.rows.length} 行，数据见工作表「表格${tableNo}」`, S.TEXT)
      // 同时给一份速览：单元格用 | 连，方便在内容页直接看
      push(b.head.map(c => runsToText(parseInlineRuns(c))).join(' | '))
      for (let r = 0; r < b.rows.length; r++) {
        push(b.rows[r].map(c => runsToText(parseInlineRuns(c == null ? '' : c))).join(' | '))
      }
      continue
    }
  }
  return rows
}

/** 表格 sheet：表头 + 数据落成真实单元格，列宽按内容自适应 */
function tableSheet(block: Extract<MdBlock, { type: 'table' }>, index: number, baseName: string): SheetSpec {
  const cols = Math.max(block.head.length, 1)
  const rows: Row[] = []

  const head: Row = { cells: [], height: 20 }
  for (let c = 0; c < cols; c++) {
    head.cells.push({ text: runsToText(parseInlineRuns(block.head[c] || '')), style: S.HEAD })
  }
  rows.push(head)

  for (let r = 0; r < block.rows.length; r++) {
    const src = block.rows[r]
    const row: Row = { cells: [] }
    for (let c = 0; c < cols; c++) {
      row.cells.push({ text: runsToText(parseInlineRuns(src[c] == null ? '' : src[c])), style: S.CELL })
    }
    rows.push(row)
  }

  // 列宽：取该列最宽内容，限制在 8~50 之间；中文按 2 个字符宽算
  const widths: number[] = []
  for (let c = 0; c < cols; c++) {
    let w = 0
    for (let r = 0; r < rows.length; r++) {
      const cell = rows[r].cells[c]
      if (cell) w = Math.max(w, visualLen(cell.text))
    }
    widths.push(Math.min(50, Math.max(8, Math.round(w * 1.1 + 2))))
  }

  return {
    name: safeSheetName(`${baseName}${index}`, `表格${index}`),
    rows,
    freezeRows: 1,
    cols: widths.map(w => ({ width: w }))
  }
}

/* ------------------------------ 入口 ------------------------------ */

/**
 * 生成 .xlsx 字节。调用方负责存盘（见 download.ts）。
 * @param blocks parseMarkdownBlocks 的产物
 */
export function buildXlsx(blocks: MdBlock[], opts: XlsxOptions): Uint8Array {
  const when = opts.when || new Date()
  const author = opts.author || 'BaiLianChatInYiTu'
  const title = opts.title || '文档'

  const sheets: SheetSpec[] = []
  const content: SheetSpec = {
    name: safeSheetName(opts.sheetName || '内容', '内容'),
    rows: contentRows(blocks),
    cols: [{ width: 100 }]
  }
  sheets.push(content)

  // 收集表格，每个一个工作表
  let n = 0
  const tables: Array<Extract<MdBlock, { type: 'table' }>> = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'table') tables.push(b)
  }
  for (let i = 0; i < tables.length; i++) {
    n++
    sheets.push(tableSheet(tables[i], n, '表格'))
  }

  const mainType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'

  const overrides = [
    {
      part: '/xl/workbook.xml',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
    },
    { part: '/xl/styles.xml', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml' },
    { part: '/docProps/core.xml', type: 'application/vnd.openxmlformats-package.core-properties+xml' },
    {
      part: '/docProps/app.xml',
      type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml'
    }
  ]
  for (let i = 0; i < sheets.length; i++) {
    overrides.push({
      part: `/xl/worksheets/sheet${i + 1}.xml`,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
    })
  }

  const wbRels = sheets.map((_s, i) => ({
    id: `rId${i + 1}`,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
    target: `worksheets/sheet${i + 1}.xml`
  }))
  wbRels.push({
    id: `rId${sheets.length + 1}`,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
    target: 'styles.xml'
  })

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: contentTypesXml(overrides) },
    { name: '_rels/.rels', data: rootRelsXml('xl/workbook.xml', mainType) },
    { name: 'docProps/core.xml', data: coreXml(title, author, when) },
    { name: 'docProps/app.xml', data: appXml('BaiLianChatInYiTu', sheets.map(s => s.name)) },
    { name: 'xl/workbook.xml', data: workbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', data: relsXml(wbRels) },
    { name: 'xl/styles.xml', data: stylesXml() }
  ]
  for (let i = 0; i < sheets.length; i++) {
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheets[i], i === 0) })
  }

  return buildZip(entries, when)
}

export default buildXlsx
