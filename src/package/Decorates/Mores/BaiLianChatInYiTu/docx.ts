/*
 * @Description: 生成 Word 文档（.docx）
 *
 * 两个预设：
 *   gongwen —— 党政机关公文格式（默认值，参数见 GONGWEN 那张表）：
 *              页边距上 3.5 / 下 2.9 / 左 2.55 / 右 2.55 cm，页眉 1.5 / 页脚 2.6 cm，
 *              正文方正仿宋_GBK 三号，行距**固定值 29.7 磅**，首行缩进 2 字符，
 *              标题方正小标宋_GBK 二号居中，标题与副标题**段前段后均 0 行**，
 *              页脚页码「— 1 —」宋体四号、行距固定值 15 磅、文本前后各空 1 字符，
 *              双面打印（单页居右、双页居左，见 footerXml）。
 *   plain   —— 普通文档：1 英寸页边距、小四宋体、1.5 倍行距。给"不想要公文壳子"的场景。
 *
 * ★ 字体分流：**只有数字和字母用西文字体（Times New Roman）**，其余（汉字、标点、
 *   符号）一律用"该层级的字体或正文字体"。用户原话：「只有数字和字母用 Times New Roman，
 *   其他的字体均用对应的层级或者正文字体（包括符号等）」。
 *   注意 Word 的字体是**按码位分流**的（ascii / hAnsi / eastAsia），光设 eastAsia 不够：
 *   `—`(U+2014)、`“”`(U+201C)、`…`、`·`、`-`、`(`、`.` 都在西文码位里，会被渲染成
 *   Times New Roman。所以每个 run 还要按脚本切开 —— 见 splitByScript / rPrXml / runXml。
 *   唯一的例外是**页码**：规范另外指定「页码字体为宋体四号」，那条是专门规定，
 *   优先于这条通则（整份页脚都用宋体，不拆）。
 *
 * ★ 公文正文的"层次"不是靠 Markdown 的 # 层级，而是靠**行首的序数**：
 *     一、        → 第一层，方正黑体_GBK
 *     （一）      → 第二层，方正楷体_GBK
 *     1.          → 第三层，方正仿宋_GBK（与正文同字体）
 *     （1）       → 第四层，方正仿宋_GBK
 *   序数**可以越级**（一、之后直接上（1）），所以只按行首前缀判断，不做顺序追踪。
 *   模型爱把这些写成普通段落（甚至和正文挤在同一个 Markdown 段落里），
 *   所以检测放在"块 → 段落"的**每一行**上，见 ordinalLevel()。
 *
 * ★ 缩进只有一条口径：**首行缩进 2 字符**（firstLineChars=200），而且**只此一条** ——
 *     不回退到"左缩进"、也不做悬挂。用户原话：「一二三四级标题和正文都不需要悬挂缩进，
 *     都是首行缩进 2 个字符就行了（不是文本之前空 2 字符）」。
 *     - 悬挂缩进会把首行顶到版心最左边、续行反而缩进 2 字，看上去就是"行首多一块空白"；
 *     - 左缩进（Word 里的"文本之前"）会把整段推右，同样不是公文的样子；
 *     - 列表项也照这一条走，**不生成项目符号**（公文不用「·」「-」，层次靠序数）；
 *       有序列表保留 `1.`，但序号后不留空格（`1.内容`）。
 *   ★ 因此全篇只有三类段落例外：封面居中块（标题/副标题/meta，缩进 0）、
 *     表格单元格（缩进 0）、代码块（保持左对齐，但仍给首行 2 字符）。
 *
 * ★ 标题块由三段拼成，而且**不一定排在文档第一行**：
 *     lead（标题之前的正文块，模型写的"以下是为…："）
 *     → 标题（二号小标宋居中）
 *     → 副标题（整行被圆括号包住的那块，如「（2025-2027年）」，三号楷体居中，见 isSubtitle）
 *     → meta（导出时间等信息行）
 *   模型常先写一句引语再上正文标题。早先这里把标题硬提到最前，那句引语就被挤到标题
 *   后面去了（用户反馈「顺序颠倒了」「这段话应该是在标题上面」）。现在标题留在它原本
 *   的位置，引语原位排在上面 —— 位置由调用方算好传进来（见 exporter.ts）。
 *
 * ★ 表后不留空段落：Markdown 表格后面本来就有个空行（表格语法要求），早先这里又补了
 *   一个空段，Word 里就是肉眼可见的一整行空白（用户截图圈的就是它）。表格自带边框，
 *   和下文自然分开，不需要空行隔开。
 * ★ 两个"看起来能跑、打开就露馅"的排版坑，都在这里被刻意规避：
 *   1. 手动换行符（Shift+Enter，↓）不能被两端对齐：模型很爱写"一句一行"的短句块，
 *      Markdown 里它们属于**同一个**段落（`para.text` 里的 \n）。若照直转成同一个
 *      <w:p> 里的 <w:br/>，Word 的两端对齐会把每一行都拉到版心宽度，排成
 *      「应　　急　　指　　挥　　部」—— 因为 both 只放过**段落最后一行**，
 *      而手动换行符只结束"行"、不结束"段落"。
 *      ★ 这里的选择是**把手动换行符换成回车**：每一行独立成段（splitLines），
 *        于是每行都是"最后一行"，既不会被打散字距，也保住了公文要的两端对齐。
 *      ★ 凡是新增"文本里可能带 \n"的块类型，都必须走 splitLines 拆段 ——
 *        别指望 Word 去纠正；自检里有一条"含 <w:br/> 的段落不得是 both"兜着。
 *   2. 分割线：`---` 在 Markdown 里是分割线，在公文里什么都不是。直接丢弃，
 *      不要转成"带下边框的空段落"（那会得到一条孤零零的横线，还占一行高度）。
 *
 * ★ 两个最容易写出"文件损坏"的地方，都在这里被刻意规避：
 *   1. 元素顺序：OOXML 的 w:pPr / w:rPr / w:tblPr 的**子元素顺序是 schema 规定的**，
 *      顺序错了 Word 直接报"内容有问题"。下面每一处都按 CT_* 的顺序拼。
 *   2. 非法字符：正文里混进控制字符或孤立代理项，整个 document.xml 就废了。
 *      所有文本都过 ooxml.ts 的 esc()（内含 cleanXmlText）。
 */

import { MdBlock, MdRun, parseInlineRuns, runsToText } from './markdown'
import { buildZip, ZipEntry } from './zip'
import {
  XML_DECL,
  NS,
  esc,
  escAttr,
  mm,
  pt,
  FONT_SIZE,
  contentTypesXml,
  rootRelsXml,
  relsXml,
  coreXml,
  appXml
} from './ooxml'

export type DocxPreset = 'gongwen' | 'plain'

export interface DocxOptions {
  /** 文档大标题（居中，二号小标宋） */
  title?: string
  /** 副标题（`（2025-2027年）` 这类，居中，三号楷体，紧排在标题下方） */
  subtitle?: string
  /**
   * 标题**之前**的内容（正文标题出自正文中间时，它前面那些块）。
   *
   * 模型常先写一句"以下是为…编制的专项规划框架："再上正文标题。这句话是它的话、
   * 不属于公文正文，但也不该被丢掉 —— 原位排在标题上面，用正文字体字号（见 exporter）。
   */
  lead?: MdBlock[]
  preset?: DocxPreset | string
  /** 标题字体，默认随预设（公文=方正小标宋_GBK） */
  titleFont?: string
  /** 正文字体，默认随预设（公文=方正仿宋_GBK） */
  bodyFont?: string
  /** 标题下方的信息行（导出时间、来源等），每项一行 */
  meta?: string[]
  /** 是否加页脚页码，默认随预设（公文=true） */
  pageNumber?: boolean
  /** 写入文件属性的作者 */
  author?: string
  when?: Date
}

/* ==================================================================== *
 * 版式：把"公文的样子"集中成一张表，改版式不用翻生成逻辑
 * ==================================================================== */

interface Layout {
  page: { w: number; h: number }
  margin: { top: number; right: number; bottom: number; left: number; header: number; footer: number }
  /** 固定行距（1/20 磅）。0 表示用 auto 倍距 */
  line: number
  /** 正文。size 单位是半磅 */
  body: { font: string; size: number; firstLineChars: number }
  title: { font: string; size: number }
  /** 层次序数用的字体：公文的一级黑体、二级楷体、三/四级仿宋（与正文同） */
  h1: { font: string; size: number; bold: boolean }
  h2: { font: string; size: number; bold: boolean }
  h3: { font: string; size: number; bold: boolean }
  /** 表格字号（五号，比正文小一档才放得下） */
  table: { size: number }
  /** 表头字体（公文里沿用第一层的黑体，与正文的方正字族保持一致） */
  tableHead: string
  /** 代码字号 */
  code: { size: number }
  latin: string
  mono: string
  pageNumberSize: number
  /** 页脚里那个空段落的固定行距（1/20 磅）—— 规范：页脚行距固定值 8 磅 */
  footerLine: number
  /** 页码行的固定行距（1/20 磅）—— 规范：页码行距固定值 15 磅 */
  pageNumberLine: number
  /** 页码文本前后的缩进（百分之一字符）—— 规范：文本前后均为 1 字符 */
  pageNumberIndent: number
}

const GONGWEN: Layout = {
  // A4：210 × 297 mm
  page: { w: mm(210), h: mm(297) },
  // 页面设置：上 3.5 / 下 2.9 / 左 2.55 / 右 2.55 cm（版心 159 × 233 mm），
  // 页眉距边界 1.5 cm、页脚距边界 2.6 cm
  margin: { top: mm(35), right: mm(25.5), bottom: mm(29), left: mm(25.5), header: mm(15), footer: mm(26) },
  // 正文格式：行距**固定值 29.7 磅** = 594 二十分之一磅
  // （版心高 233mm ≈ 660.5pt，660.5 / 29.7 ≈ 22.2 → 一页正好排 22 行）
  line: 594,
  body: { font: '方正仿宋_GBK', size: FONT_SIZE.sanhao, firstLineChars: 200 },
  title: { font: '方正小标宋_GBK', size: FONT_SIZE.erhao },
  // 层次序数对应的字体：一、（黑体）→（一）（楷体）→ 1. /（1）（仿宋，与正文同）
  h1: { font: '方正黑体_GBK', size: FONT_SIZE.sanhao, bold: false },
  h2: { font: '方正楷体_GBK', size: FONT_SIZE.sanhao, bold: false },
  h3: { font: '方正仿宋_GBK', size: FONT_SIZE.sanhao, bold: false },
  table: { size: FONT_SIZE.wuhao },
  tableHead: '方正黑体_GBK',
  code: { size: FONT_SIZE.wuhao },
  latin: 'Times New Roman',
  mono: 'Consolas',
  pageNumberSize: FONT_SIZE.sihao,
  // 页脚：空段落行距固定值 8 磅；页码行距固定值 15 磅、前后各空 1 字符
  footerLine: pt(8),
  pageNumberLine: pt(15),
  pageNumberIndent: 100
}

const PLAIN: Layout = {
  page: { w: mm(210), h: mm(297) },
  margin: { top: mm(25.4), right: mm(25.4), bottom: mm(25.4), left: mm(25.4), header: mm(12.7), footer: mm(12.7) },
  line: 0, // 0 = 用 auto 倍距（下面给 1.5 倍）
  body: { font: '宋体', size: FONT_SIZE.xiaosi, firstLineChars: 200 },
  title: { font: '宋体', size: FONT_SIZE.sanhao },
  h1: { font: '宋体', size: FONT_SIZE.sihao, bold: true },
  h2: { font: '宋体', size: FONT_SIZE.sanhao, bold: true },
  h3: { font: '宋体', size: FONT_SIZE.xiaosi, bold: true },
  table: { size: FONT_SIZE.xiaosi },
  tableHead: '黑体',
  code: { size: FONT_SIZE.xiaosi },
  latin: 'Arial',
  mono: 'Consolas',
  pageNumberSize: FONT_SIZE.xiaosi,
  footerLine: pt(8),
  pageNumberLine: pt(15),
  pageNumberIndent: 100
}

/* ==================================================================== *
 * 层次序数 → 字体
 * ==================================================================== */

/** 层次序数里用的中文数字（含"两""〇"这类常见写法） */
const CN_NUM = '一二三四五六七八九十百零〇两'

/**
 * 层次序数前缀。顺序即优先级：带括号的先判，否则「（1）」会被当成裸数字那一档。
 *   （1）→ 4   （一）→ 2   1. → 3   一、→ 1
 * 序数后面跟数字的写法要排掉（「3.5 万元」是钱数不是第三层）：
 * 点号形式加 (?!\d)，顿号/括号形式本身就不会和数字连用。
 */
const ORDINAL_RULES: Array<{ re: RegExp; level: number }> = [
  { re: /^[（(]\d{1,3}[）)]/, level: 4 },
  { re: new RegExp(`^[（(][${CN_NUM}]{1,4}[）)]`), level: 2 },
  { re: /^\d{1,3}(?:[、)）]|[.．](?!\d))/, level: 3 },
  { re: new RegExp(`^[${CN_NUM}]{1,4}(?:、|[.．](?!\\d))`), level: 1 }
]

/**
 * 判断一行文字属于哪一层次（1~4），没有序数返回 0。
 *
 * 判断前把空白与 **加粗** 这类行内标记清掉，否则 `**一、总体要求**`
 * 会因为行首多出两个星号而漏检。序数可以越级使用，所以只看本行前缀，不记状态。
 */
export const ordinalLevel = (text: string): number => {
  const s = String(text == null ? '' : text).replace(/[*_`~\s]/g, '')
  for (let i = 0; i < ORDINAL_RULES.length; i++) {
    if (ORDINAL_RULES[i].re.test(s)) return ORDINAL_RULES[i].level
  }
  return 0
}

/** 层次 → 字体。第三、四层同为仿宋（与正文同字体，靠序数本身区分层次） */
const levelStyle = (layout: Layout, level: number): { font: string; bold: boolean } =>
  level <= 1 ? layout.h1 : level === 2 ? layout.h2 : layout.h3

/**
 * 副标题判定：**整行被圆括号包住**的那一块（`（2025-2027年）`、`（征求意见稿）`、`（试行）`）。
 *
 * 公文里这行就是标题下面的副标题，字号与正文同为三号、字体换成楷体。
 * 模型十有八九会把它写成标题下面紧挨着的一个普通段落，不认出来就会混在正文里
 * （用户反馈：「（2025-2027年）应该是副标题」，见 exporter 里的取用位置）。
 *
 * ★ 必须排掉层次序数：`（一）`、`（1）` 也是被括号包住的，但它们是层次不是副标题。
 */
export const isSubtitle = (text: string): boolean => {
  const s = String(text == null ? '' : text).replace(/[*_`~\s]/g, '')
  if (!/^[（(][^（）()]{1,24}[）)]$/.test(s)) return false
  return ordinalLevel(s) === 0
}

/* ==================================================================== *
 * XML 片段生成
 * ==================================================================== */

interface RunStyle {
  eastAsia: string
  latin: string
  size: number
  bold?: boolean
  italic?: boolean
  strike?: boolean
}

/**
 * 只有数字和字母走西文字体 —— 用户口径：「只有数字和字母用 Times New Roman，
 * 其他的字体均用对应的层级或者正文字体（包括符号等）」。
 *
 * 光把 `w:eastAsia` 设对是不够的：Word 的字体是**按码位分流**的，
 * `ascii` 管 U+0000–U+007F、`hAnsi` 管其余西文码位、汉字才走 `eastAsia`。
 * 而 `—`(U+2014)、`“”‘’`(U+201C–201D)、`…`、`·`、`-`、`(`、`.` 全落在西文码位里，
 * 于是"中文字体设对了、标点却渲染成 Times New Roman"。所以每个 run 还要再按脚本切开。
 */
const LATIN_CHAR = /[0-9A-Za-z]/

/**
 * 按脚本切段：`true` = 只有数字/字母（走西文字体），`false` = 其余（汉字、标点、符号）。
 *
 * ★ 空格是**中立**字符：跟前一个实字符同类（行首的空格跟后一个），
 *   否则「GB 18218」会被空格切成三段，白白多出两个 run。
 */
export function splitByScript(text: string): Array<{ text: string; latin: boolean }> {
  const s = String(text == null ? '' : text)
  if (!s) return []

  const cls: boolean[] = []
  let prev: boolean | null = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === ' ' || ch === '\t') {
      cls.push(prev === null ? false : prev)
    } else {
      prev = LATIN_CHAR.test(ch)
      cls.push(prev)
    }
  }
  // 行首连续空格的分类要跟它后面第一个实字符走
  let head = 0
  while (head < s.length && (s[head] === ' ' || s[head] === '\t')) head++
  if (head && head < s.length) for (let i = 0; i < head; i++) cls[i] = cls[head]

  const segs: Array<{ text: string; latin: boolean }> = []
  for (let i = 0; i < s.length; i++) {
    const last = segs[segs.length - 1]
    if (last && last.latin === cls[i]) last.text += s[i]
    else segs.push({ text: s[i], latin: cls[i] })
  }
  return segs
}

/**
 * w:rPr 子元素顺序（CT_RPr）：rStyle → rFonts → b → bCs → i → iCs → caps → smallCaps →
 * strike → dstrike → ... → color → spacing → w → kern → position → sz → szCs → ...
 * 顺序错了 Word 报"内容有问题"，所以这里按顺序 push，不做条件重排。
 *
 * @param latin `false` = 这一段是汉字/标点/符号 ⇒ `ascii`/`hAnsi` 也给中日韩字体；
 *              `true` = 数字/字母 ⇒ 给西文字体；
 *              不传（undefined）时沿用老口径（ascii/hAnsi = 西文字体）。
 */
const rPrXml = (s: RunStyle, latin?: boolean): string => {
  const west = latin === false ? s.eastAsia : s.latin
  let out = `<w:rFonts w:ascii="${escAttr(west)}" w:hAnsi="${escAttr(west)}" w:eastAsia="${escAttr(
    s.eastAsia
  )}" w:cs="${escAttr(west)}"/>`
  if (s.bold) out += '<w:b/><w:bCs/>'
  if (s.italic) out += '<w:i/><w:iCs/>'
  if (s.strike) out += '<w:strike/>'
  out += `<w:sz w:val="${s.size}"/><w:szCs w:val="${s.size}"/>`
  return `<w:rPr>${out}</w:rPr>`
}

/**
 * 一段文本 → **一个或多个** `<w:r>`（按脚本切，见 splitByScript）。
 *
 * ★ 返回值就是 `<w:r>` 的序列，调用方**不能**再在外面套 `<w:r>`。
 * ★ 换行自带一个 run：原来把 `<w:br/>` 直接拼在 `<w:t>` 前面，
 *   按脚本切开后 `<w:br/>` 就可能落在所有 `<w:r>` 之外 —— Word 会当它不存在，
 *   换行就丢了（代码块全靠这个 <w:br/>）。
 */
const runXml = (text: string, s: RunStyle): string => {
  const lines = String(text).split('\n')
  let out = ''
  for (let i = 0; i < lines.length; i++) {
    if (i) out += `<w:r>${rPrXml(s, true)}<w:br/></w:r>`
    const segs = splitByScript(lines[i])
    for (let k = 0; k < segs.length; k++) {
      out += `<w:r>${rPrXml(s, segs[k].latin)}<w:t xml:space="preserve">${esc(segs[k].text)}</w:t></w:r>`
    }
  }
  return out
}

/** 把一组行内片段转成 runs，样式按 run 自己的标记叠加基线样式 */
const runsXml = (runs: MdRun[], base: RunStyle, layout: Layout): string => {
  let out = ''
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (!r.text) continue
    const isCode = !!r.code
    out += runXml(r.text, {
      eastAsia: isCode ? '宋体' : base.eastAsia,
      latin: isCode ? layout.mono : base.latin,
      size: isCode ? layout.code.size : base.size,
      bold: base.bold || r.bold,
      italic: r.italic,
      strike: r.strike
    })
    // 链接：正文里在文字后面补出地址（Office 正文里做真超链接要额外 rel，
    // 而公文是打印件，地址写出来反而更有用）
    if (r.link) {
      out += runXml(`（${r.link}）`, {
        eastAsia: isCode ? '宋体' : base.eastAsia,
        latin: layout.latin,
        size: isCode ? layout.code.size : base.size,
        italic: true
      })
    }
  }
  return out
}

interface ParaOpts {
  /** 缩进：firstLineChars=首行缩进字符数，leftChars=左缩进字符数，hangingChars=悬挂字符数 */
  ind?: { firstLineChars?: number; leftChars?: number; rightChars?: number; hangingChars?: number }
  /** 对齐，默认两端对齐 */
  jc?: 'both' | 'center' | 'left' | 'right'
  /** 行距覆盖：固定值（1/20 磅） */
  line?: number
  /** 段前段后（百分之一行） */
  beforeLines?: number
  afterLines?: number
  /** 段落下边框（分割线） */
  bottomBorder?: boolean
  /** 段落默认 run 属性（让用户在段落标记上也继承字体） */
  rPr?: RunStyle
}

/**
 * 段落。w:pPr 子元素顺序（CT_PPr）：pStyle → keepNext → keepLines → pageBreakBefore →
 * framePr → widowControl → numPr → ... → pBdr → shd → tabs → ... → spacing → ind →
 * contextualSpacing → mirrorIndents → suppressOverlap → jc → ... → outlineLvl → rPr
 */
const paraXml = (content: string, o?: ParaOpts): string => {
  const p: ParaOpts = o || {}
  let pPr = ''

  if (p.bottomBorder) {
    pPr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>'
  }

  // 行距
  const line = p.line == null ? undefined : p.line
  let spacing = ''
  /* 段前/段后：**0 也要显式写出来**（`!= null` 而不是真值判断）——
     规范要求「标题和副标题段前段后均为 0 行」，属性不写就等于"继承默认"，
     看不出是"明确设成 0"还是"忘了设"；自检也没法断言。 */
  if (p.beforeLines != null) spacing += ` w:beforeLines="${p.beforeLines}"`
  if (p.afterLines != null) spacing += ` w:afterLines="${p.afterLines}"`
  if (line != null) {
    // line === 0 表示用 auto（下面给 360 = 1.5 倍）
    if (line > 0) spacing += ` w:line="${line}" w:lineRule="exact"`
    else spacing += ' w:line="360" w:lineRule="auto"'
  }
  if (spacing) pPr += `<w:spacing${spacing}/>`

  // 缩进：firstLineChars / leftChars 单位是"百分之一字符"，同时给绝对值兜底
  // （WPS、Google Docs 对 chars 系属性的支持不如 Word 完整）
  if (p.ind) {
    const ind: string[] = []
    const fs = p.ind.firstLineChars
    const ls = p.ind.leftChars
    const rs = p.ind.rightChars
    const hs = p.ind.hangingChars
    if (ls) {
      ind.push(`w:leftChars="${ls}"`, `w:left="${Math.round((ls / 100) * (p.rPr ? p.rPr.size : 32) * 10)}"`)
    }
    if (rs) {
      ind.push(`w:rightChars="${rs}"`, `w:right="${Math.round((rs / 100) * (p.rPr ? p.rPr.size : 32) * 10)}"`)
    }
    if (hs) {
      ind.push(`w:hangingChars="${hs}"`, `w:hanging="${Math.round((hs / 100) * (p.rPr ? p.rPr.size : 32) * 10)}"`)
    }
    if (fs) {
      ind.push(`w:firstLineChars="${fs}"`, `w:firstLine="${Math.round((fs / 100) * (p.rPr ? p.rPr.size : 32) * 10)}"`)
    } else if (fs === 0 || ls || hs) {
      // 显式声明"不首行缩进"，否则会继承 docDefaults
      ind.push('w:firstLineChars="0"', 'w:firstLine="0"')
    }
    if (ind.length) pPr += `<w:ind ${ind.join(' ')}/>`
  }

  /* 这里**不**再为软换行降级对齐方式：手动换行符在上一层的 splitLines 里
     就已经被换成了回车（每行独立成段），能走到这儿的 <w:br/> 只剩代码块和表格单元格，
     两者都不是两端对齐。若日后有人放进"带 \n 又要求 both"的段落，Word 会重新
     把短行拉成「应　　急　　指　　挥　　部」—— 自检里的那条断言就是用来抓这个的。 */
  if (p.jc) pPr += `<w:jc w:val="${p.jc}"/>`
  // 段落标记的字体：按"符号用中日韩字体"的口径给（传 false），别留成西文字体
  if (p.rPr) pPr += rPrXml(p.rPr, false)

  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`
}

/** 空段：用于标题与正文之间、表格之后留白 */
const emptyParaXml = (style: RunStyle, layout: Layout, line?: number): string =>
  paraXml('', {
    ind: { firstLineChars: 0 },
    line: line == null ? layout.line : line,
    rPr: style
  })

/* ------------------------------ 表格 ------------------------------ */

/** 视觉宽度：中日韩字符按 2 个西文字符宽算，用来分配列宽 */
const visualLen = (s: string): number => {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    n += c > 0x2e7f && c < 0xffe7 ? 2 : 1
  }
  return n
}

const TABLE_BORDERS =
  '<w:tblBorders>' +
  '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '</w:tblBorders>'

/** 单元格段落：表格里没有首行缩进，行距给单倍（表里用 28.8 磅固定行距会撑得很高） */
const cellParaXml = (runs: MdRun[], align: string, base: RunStyle, layout: Layout): string =>
  paraXml(runsXml(runs, base, layout), {
    ind: { firstLineChars: 0 },
    jc: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
    line: -1, // 单倍行距
    rPr: base
  })

function tableXml(block: Extract<MdBlock, { type: 'table' }>, layout: Layout): string {
  const cols = Math.max(block.head.length, 1)
  const contentWidth = layout.page.w - layout.margin.left - layout.margin.right

  /* 列宽按"该列最长单元格的视觉宽度"加权，最短也给 1 份，
     否则全是空单元格的列会被压成 0 宽，Word 里就看不见那一列了 */
  const weights: number[] = []
  for (let c = 0; c < cols; c++) {
    let w = visualLen(runsToText(parseInlineRuns(block.head[c] || '')))
    for (let r = 0; r < block.rows.length; r++) {
      const cell = block.rows[r][c] == null ? '' : block.rows[r][c]
      w = Math.max(w, visualLen(runsToText(parseInlineRuns(cell))))
    }
    weights.push(Math.max(w, 1))
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const widths = weights.map(w => Math.max(400, Math.round((contentWidth * w) / totalWeight)))
  // 取整会有零头，全塞给最后一列，保证总宽正好等于版心
  const used = widths.reduce((a, b) => a + b, 0)
  widths[widths.length - 1] += contentWidth - used

  const grid = widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')

  const cellStyle: RunStyle = {
    eastAsia: layout.body.font,
    latin: layout.latin,
    size: layout.table.size
  }

  const cellXml = (text: string, width: number, isHead: boolean, align: string): string => {
    const headStyle: RunStyle = isHead
      ? { eastAsia: layout.tableHead, latin: layout.latin, size: layout.table.size, bold: false }
      : cellStyle
    const runs = parseInlineRuns(text)
    // 空单元格也要有一个空段落，否则 <w:tc> 里没有 <w:p> 是非法结构
    const content = runs.length ? cellParaXml(runs, isHead ? 'center' : align, headStyle, layout) : cellParaXml([], align, headStyle, layout)
    return (
      `<w:tc><w:tcPr>` +
      `<w:tcW w:w="${width}" w:type="dxa"/>` +
      `<w:vAlign w:val="${isHead ? 'center' : 'top'}"/>` +
      `</w:tcPr>${content}</w:tc>`
    )
  }

  // 表头行：tblHeader 让它在跨页时自动重复
  const headRow =
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>` +
    block.head.map((c, i) => cellXml(c, widths[i], true, 'center')).slice(0, cols).join('') +
    // head 比 cols 短时补齐，保证行内单元格数一致（不一致的 row 在 Word 里会错位）
    (block.head.length < cols
      ? widths.slice(block.head.length).map((w, i) => cellXml('', w, true, 'center')).join('')
      : '') +
    `</w:tr>`

  const bodyRows = block.rows
    .map(
      r =>
        `<w:tr>` +
        widths
          .map((w, i) => {
            const align = block.aligns[i] || 'left'
            return cellXml(r[i] == null ? '' : r[i], w, false, align)
          })
          .join('') +
        `</w:tr>`
    )
    .join('')

  return (
    `<w:tbl><w:tblPr>` +
    `<w:tblW w:w="${contentWidth}" w:type="dxa"/>` +
    `<w:jc w:val="center"/>` +
    TABLE_BORDERS +
    // fixed 布局才不会因为单元格内容长而自动改列宽（表格宽度就更可预测）
    `<w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:top w:w="28" w:type="dxa"/><w:left w:w="85" w:type="dxa"/>` +
    `<w:bottom w:w="28" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar>` +
    `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>` +
    `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headRow}${bodyRows}</w:tbl>`
  )
}

/* ==================================================================== *
 * 块 → 段落
 * ==================================================================== */

/**
 * 拆行：把手动换行符换成**回车**。
 *
 * Word 里「回车（¶）」和「手动换行符（Shift+Enter，↓）」是两种东西：
 *   ¶ 结束**段落**，↓ 只结束**行**。
 * 而两端对齐只放过每段的**最后一行** —— 所以 ↓ 前面那些短行会被硬拉到版心宽度，
 * 排成「应　　急　　指　　挥　　部」。模型写"一句一行"的短句块（`泄漏： / 小量： / 大量：`
 * 这种）时用的就是 \n，在我们这儿等价于 ↓。
 *
 * 于是这里统一按 ¶ 处理 —— 每一行独立成段，每行都是各自段落的"最后一行"，
 * 既不会被打散字距，又保住了公文要的两端对齐。
 *
 * 尾部的空行丢掉（段落末尾那个 \n 不该多造一个空段）；中间的空行保留成空段。
 * 代码块例外：它的换行是代码本身的结构，必须留在同一个段落里（见 code 分支）。
 */
const splitLines = (text: string): string[] => {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop()
  return lines
}

/**
 * 去掉行首残留的列表项目符号（`- `、`* `、`+ `、`· `、`• ` 以及 `-- `）。
 *
 * 公文正文**不用项目符号**：层次靠行首序数（`一、`/`（一）`/`1.`/`（1）`）和字体区分。
 * 但列表项有两种来路，符号的处理方式不一样：
 *   - 顶层列表项：块解析已经把符号摘掉、只把内容交给 item 块，我们**不再补符号**；
 *   - 引用块（`>`）里的列表：整行是"原样透传"进来的，`> - **长寿湖渔政AI预警**：…`
 *     里的 `- ` 会跟着内容一起进正文；而且 `-` 不是汉字，`squeezeSpaces` 只清"中文旁边"
 *     的空格，管不到它 —— 于是正文里就留下「横杠 + 一个空格」。
 *
 * ★ 只认「符号 + 空白」：`-10℃`、`2025-2027年` 不是列表，不能被误剥。
 * ★ 剥完什么都不剩时原样返回 —— 别把一条只有符号的行变成空段落。
 */
const stripListMark = (line: string): string => {
  const s = String(line == null ? '' : line)
  const m = /^[^\S\n]*(?:[-*+•‣◦▪∙][^\S\n]+|·[^\S\n]*|[-–—]{2,}[^\S\n]*)/.exec(s)
  if (!m) return s
  const rest = s.slice(m[0].length)
  return rest.trim() ? rest : s
}

function blocksToBody(blocks: MdBlock[], layout: Layout, preset: 'gongwen' | 'plain'): string {
  const body: RunStyle = {
    eastAsia: layout.body.font,
    latin: layout.latin,
    size: layout.body.size
  }
  const out: string[] = []

  /**
   * 正文段落。**一行一段**：文本里若带手动换行符，先按回车拆成多段再逐段铺出去
   * （见 splitLines 的说明），所以每段都恰好是一行，两端对齐不会拉伸任何一行。
   */
  const textPara = (line: string, st: RunStyle, extra?: ParaOpts) => {
    const o: ParaOpts = { ind: { firstLineChars: layout.body.firstLineChars }, line: layout.line, jc: 'both', rPr: st }
    if (extra) {
      if (extra.ind) o.ind = extra.ind
      if (extra.jc) o.jc = extra.jc
      if (extra.line != null) o.line = extra.line
      if (extra.beforeLines != null) o.beforeLines = extra.beforeLines
      if (extra.afterLines != null) o.afterLines = extra.afterLines
      if (extra.bottomBorder) o.bottomBorder = extra.bottomBorder
    }
    return paraXml(runsXml(parseInlineRuns(line), st, layout), o)
  }

  /**
   * 这一行该用什么字体：公文预设下先看行首的层次序数（一、/（一）/1./（1）），
   * 认出序数就按层次换字体，认不出才用调用方给的默认样式。
   *
   * 只认序数、不认 Markdown 的 # 层级 —— 模型经常把「一、」写成普通段落、
   * 或者写成 `## 一、` 这种层级错位的形式，序数才是编排者真实表达的层次。
   * 序数可以越级使用，所以逐行独立判断，不记状态。
   */
  const lineStyle = (line: string, def: RunStyle): RunStyle => {
    if (preset !== 'gongwen') return def
    const lv = ordinalLevel(line)
    if (!lv) return def
    const pick = levelStyle(layout, lv)
    return { eastAsia: pick.font, latin: def.latin, size: def.size, bold: pick.bold }
  }

  /** 把一段可能带手动换行符的文本铺成多个段落（每个换行符 = 一个回车） */
  const pushLines = (text: string, def: RunStyle, extra?: ParaOpts) => {
    const lines = splitLines(text)
    for (let k = 0; k < lines.length; k++) out.push(textPara(lines[k], lineStyle(lines[k], def), extra))
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]

    if (b.type === 'heading') {
      // 公文没有 Markdown 那种"层级字号递增"，而是同一字号换字体：
      //   一级黑体 / 二级楷体 / 三级及以下仿宋
      // 这里给的是"按 # 层级"的兜底，行首带序数时由 lineStyle 覆盖成序数对应的那档。
      const pick = b.level <= 1 ? layout.h1 : b.level === 2 ? layout.h2 : layout.h3
      pushLines(
        b.text,
        { eastAsia: pick.font, latin: layout.latin, size: layout.body.size, bold: pick.bold },
        { beforeLines: preset === 'gongwen' ? 0 : 25 }
      )
      continue
    }

    if (b.type === 'para') {
      pushLines(b.text, body)
      continue
    }

    if (b.type === 'item') {
      /* 列表 → 公文正文段落：**不加项目符号、不做悬挂缩进**。
         ★ 不加符号：公文正文不用「·」「-」这类项目符号，层次靠行首序数
           （一、/（一）/1./（1））和字体区分。模型爱写 `- **民生直达**：…`，
           渲染成「· 民生直达：…」就等于凭空多出一枚符号 + 一个空格
           （用户截图里圈住的那个灰点就是它）。
         ★ 有序列表保留序号，但序号后**不留空格**：公文第三层写作「1.内容」——
           那个空格是 Markdown 列表语法的分隔符，不是内容的一部分。
         ★ 缩进一律「首行空 2 字」：不设左缩进、不设悬挂缩进。悬挂缩进会把首行顶到
           版心最左边、续行反而缩进 2 字（用户看到的"首行少一块、续行多一块"），
           公文里所有段落都是首行缩进 2 字符，不分层次。
           续行是**独立段落**（手动换行符已换成回车），所以它同样首行缩进 2 字符。 */
      const lines = splitLines(b.text)
      // 续行与首行同字体：续行是这一条的内容，不该因为它没有序数就换回正文字体
      const st = lineStyle(lines[0], body)
      for (let k = 0; k < lines.length; k++) {
        const prefix = k === 0 && b.ordered ? `${b.index}.` : ''
        out.push(textPara(prefix + stripListMark(lines[k]), st))
      }
      continue
    }

    if (b.type === 'quote') {
      /* 引用：楷体（公文里第二层的字体；普通文档预设退回系统楷体），
         缩进与其他段落完全一致 —— 首行 2 字符，既不左缩进也不右缩进。
         ★ 引用块是"原样透传"进来的：`> - **长寿湖渔政AI预警**：…` 里的 `- ` 会跟着
           内容进正文，这里补一刀 stripListMark()，否则正文里就留下「横杠 + 空格」。 */
      const st: RunStyle = {
        eastAsia: preset === 'gongwen' ? layout.h2.font : '楷体',
        latin: layout.latin,
        size: body.size
      }
      const lines = splitLines(b.text)
      for (let k = 0; k < lines.length; k++) out.push(textPara(stripListMark(lines[k]), st))
      continue
    }

    if (b.type === 'code') {
      /* 代码：等宽小一号，单倍行距（固定行距配小字号会很难看）。
         ★ 代码块**不拆**：它的换行是内容本身的结构（少一个 \n 代码就变了），
           必须留在同一个段落里用 <w:br/>。它本来就是左对齐，也不存在拉伸问题。
         ★ 缩进仍用首行 2 字符（不设左缩进）—— 全篇统一"首行空 2 字"这一条口径，
           免得又冒出一个"文本之前空 2 字符"的段落。 */
      const runs: MdRun[] = [{ text: b.code, code: true }]
      const st: RunStyle = { eastAsia: '宋体', latin: layout.mono, size: layout.code.size }
      out.push(
        paraXml(runsXml(runs, st, layout), {
          ind: { firstLineChars: layout.body.firstLineChars },
          line: -1,
          jc: 'left',
          rPr: st
        })
      )
      continue
    }

    if (b.type === 'table') {
      /* ★ 表后**不留空段落**。Markdown 表格语法本来就要求后面空一行，解析时那行已经
         被丢掉了；这里再补一个空段，Word 里就是肉眼可见的一整行空白
         （用户截图圈的就是它）。表格自带边框、和下文自然分开，不需要空行隔开。 */
      out.push(tableXml(b, layout))
      continue
    }

    /* 分割线（--- / *** / ___）：整块丢掉。
       公文里没有这种东西（层次靠"一、（一）1."和字体区分），画一条横线只会让版面
       显得松散；而且它容易和"页脚页码的一字线"、"表格上边框"混成同一种观感。 */
    if (b.type === 'hr') continue
  }

  return out.join('')
}

/* ==================================================================== *
 * 各部分 part
 * ==================================================================== */

const W_NS = `xmlns:w="${NS.w}" xmlns:r="${NS.r}"`

function documentXml(blocks: MdBlock[], layout: Layout, preset: 'gongwen' | 'plain', opts: DocxOptions): string {
  const body: RunStyle = { eastAsia: layout.body.font, latin: layout.latin, size: layout.body.size }
  const parts: string[] = []

  /* 标题之前的内容（模型写的那句"以下是…"）：原位排在标题上面，用正文字体字号。
     没有它时（标题本就在正文最前）这一段什么都不做。 */
  if (opts.lead && opts.lead.length) parts.push(blocksToBody(opts.lead, layout, preset))

  /* 标题（二号小标宋居中）与信息行 */
  if (opts.title) {
    const titleStyle: RunStyle = {
      eastAsia: opts.titleFont || layout.title.font,
      latin: layout.latin,
      size: layout.title.size
    }
    /* 规范：「标题和副标题段前段后均为 0 行」⇒ 公文预设下显式写 0（不是"不写属性"）。
       普通文档预设保留原来的上方不留白、下方留一行。 */
    parts.push(
      paraXml(runXml(opts.title, titleStyle), {
        jc: 'center',
        ind: { firstLineChars: 0 },
        line: layout.line,
        beforeLines: 0,
        afterLines: preset === 'gongwen' ? 0 : opts.subtitle ? 0 : 50,
        rPr: titleStyle
      })
    )
  }

  /* 副标题：紧排在大标题下面，居中、三号楷体（与「（一）」同一档字体，但字号随正文）。
     段前段后同样 0 行 —— 副标题要**贴着**标题，中间不能空出一行。 */
  if (opts.subtitle) {
    const subStyle: RunStyle = {
      eastAsia: preset === 'gongwen' ? layout.h2.font : '楷体',
      latin: layout.latin,
      size: layout.body.size
    }
    parts.push(
      paraXml(runXml(opts.subtitle, subStyle), {
        jc: 'center',
        ind: { firstLineChars: 0 },
        line: layout.line,
        beforeLines: 0,
        afterLines: preset === 'gongwen' ? 0 : 50,
        rPr: subStyle
      })
    )
  }

  if (opts.meta && opts.meta.length) {
    const metaStyle: RunStyle = {
      eastAsia: opts.bodyFont || layout.body.font,
      latin: layout.latin,
      size: layout.table.size
    }
    for (let i = 0; i < opts.meta.length; i++) {
      parts.push(
        paraXml(runXml(opts.meta[i], metaStyle), {
          jc: 'center',
          ind: { firstLineChars: 0 },
          line: layout.line,
          rPr: metaStyle
        })
      )
    }
    parts.push(emptyParaXml(body, layout, layout.line))
  }

  parts.push(blocksToBody(blocks, layout, preset))

  // 文档末尾必须有至少一个段落（body 不能直接以表格或 sectPr 开头之外的东西收尾时结构才算完整）
  if (!parts.length) parts.push(emptyParaXml(body, layout, layout.line))

  const showPageNumber = opts.pageNumber == null ? preset === 'gongwen' : !!opts.pageNumber
  /* 双面打印：奇数页（单页）页码居右、偶数页（双页）页码居左 ⇒ 两份页脚。
     `default` 在开启奇偶页不同时代表**奇数页**，`even` 代表偶数页
     （settings.xml 里的 <w:evenAndOddHeaders/> 是开关，两个必须配套）。 */
  const footerRefs = showPageNumber
    ? `<w:footerReference w:type="default" r:id="rId3"/><w:footerReference w:type="even" r:id="rId4"/>`
    : ''

  // CT_SectPr 顺序：footerReference* → pgSz → pgMar → cols → docGrid
  const sectPr =
    `<w:sectPr>${footerRefs}` +
    `<w:pgSz w:w="${layout.page.w}" w:h="${layout.page.h}"/>` +
    `<w:pgMar w:top="${layout.margin.top}" w:right="${layout.margin.right}" w:bottom="${layout.margin.bottom}"` +
    ` w:left="${layout.margin.left}" w:header="${layout.margin.header}" w:footer="${layout.margin.footer}" w:gutter="0"/>` +
    `<w:cols w:space="425"/>` +
    (layout.line > 0 ? `<w:docGrid w:type="lines" w:linePitch="${layout.line}"/>` : '<w:docGrid w:type="lines"/>') +
    `</w:sectPr>`

  return `${XML_DECL}<w:document ${W_NS}><w:body>${parts.join('')}${sectPr}</w:body></w:document>`
}

/**
 * styles.xml：只定义文档默认值和一个 Normal 样式。
 * 公文的所有格式都写在段落/run 的属性上（因为要精确控制每一处的字体字号），
 * 不依赖命名样式 —— 这样文件被拷到别的机器上也不会因为样式表缺失而跑版。
 */
function stylesXml(layout: Layout): string {
  return (
    `${XML_DECL}<w:styles ${W_NS}>` +
    `<w:docDefaults>` +
    `<w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${escAttr(layout.latin)}" w:hAnsi="${escAttr(layout.latin)}"` +
    ` w:eastAsia="${escAttr(layout.body.font)}" w:cs="${escAttr(layout.latin)}"/>` +
    `<w:sz w:val="${layout.body.size}"/><w:szCs w:val="${layout.body.size}"/>` +
    `</w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr>` +
    // 关闭孤行控制 + 允许标点溢出边界：中文排版的常规设置
    `<w:widowControl w:val="0"/>` +
    `<w:jc w:val="both"/>` +
    (layout.line > 0 ? `<w:spacing w:line="${layout.line}" w:lineRule="exact"/>` : '') +
    `</w:pPr></w:pPrDefault>` +
    `</w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">` +
    `<w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/>` +
    `</w:style>` +
    `</w:styles>`
  )
}

/**
 * settings.xml：compat 里声明以 Word 2013 模式打开，避免 Word 用兼容排版重算行距。
 *
 * ★ `w:evenAndOddHeaders` 是"奇偶页页脚不同"的总开关：不开它，Word 会对所有页
 *   只用 `default` 那份页脚，`even` 那份会被完全忽略（页码就不是"单页右、双页左"了）。
 *   位置放在 `defaultTabStop` 之后 —— CT_Settings 是一串**有序**的可选元素，
 *   这个元素在 schema 里就排在 defaultTabStop 和 drawingGrid* 之间。
 */
function settingsXml(showPageNumber: boolean): string {
  return (
    `${XML_DECL}<w:settings ${W_NS}>` +
    `<w:zoom w:percent="100"/>` +
    `<w:defaultTabStop w:val="420"/>` +
    (showPageNumber ? '<w:evenAndOddHeaders/>' : '') +
    `<w:characterSpacingControl w:val="compressPunctuation"/>` +
    `<w:compat><w:compatSetting w:name="compatibilityMode"` +
    ` w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
    `<w:themeFontLang w:val="en-US" w:eastAsia="zh-CN"/>` +
    `</w:settings>`
  )
}

/**
 * 页脚页码。公文要求「— 1 —」（数字左右各一条一字线），本文件的口径：
 *   - 字体：宋体四号（规范：「页码字体为宋体四号」）—— 整份页脚都用宋体，
 *     不做"数字换 Times New Roman"的分流，这条是**针对页码的专门规定**，优先于通则；
 *   - 行距：页码行固定值 15 磅；它上面那个空段落是页脚自身的行距，固定值 8 磅；
 *   - 文本前后各空 1 字符（`w:ind` 的 leftChars/rightChars = 100）；
 *   - 双面打印：奇数页（单页）居右、偶数页（双页）居左。
 *
 * 页码用 PAGE 域，Word 会自动算 —— 但 fldSimple 里必须放一个占位 run，
 * 否则某些解析器（WPS）会显示成空。
 *
 * @param jc 奇偶页的对齐方式（'right' = 单页、'left' = 双页）
 */
function footerXml(layout: Layout, jc: 'left' | 'right'): string {
  const st: RunStyle = { eastAsia: '宋体', latin: '宋体', size: layout.pageNumberSize }
  const rpr = rPrXml(st, false)
  const dash = (t: string) => `<w:r>${rpr}<w:t xml:space="preserve">${t}</w:t></w:r>`
  // 页脚第一行：只用来摆纵向位置（固定行距 8 磅），看不见
  const spacer = paraXml('', { ind: { firstLineChars: 0 }, line: layout.footerLine, rPr: st })
  const number = paraXml(
    dash('— ') +
      `<w:fldSimple w:instr=" PAGE "><w:r>${rpr}<w:t>1</w:t></w:r></w:fldSimple>` +
      dash(' —'),
    {
      ind: { leftChars: layout.pageNumberIndent, rightChars: layout.pageNumberIndent },
      jc,
      line: layout.pageNumberLine,
      rPr: st
    }
  )
  return `${XML_DECL}<w:ftr ${W_NS}>${spacer}${number}</w:ftr>`
}

/* ==================================================================== *
 * 入口
 * ==================================================================== */

/**
 * 生成 .docx 字节。调用方负责存盘（见 download.ts）。
 * @param blocks parseMarkdownBlocks 的产物
 */
export function buildDocx(blocks: MdBlock[], opts: DocxOptions): Uint8Array {
  const preset: 'gongwen' | 'plain' = String(opts.preset) === 'plain' ? 'plain' : 'gongwen'
  const layout: Layout = preset === 'plain' ? PLAIN : GONGWEN
  const when = opts.when || new Date()
  const author = opts.author || 'BaiLianChatInYiTu'
  const title = opts.title || '文档'
  const showPageNumber = opts.pageNumber == null ? preset === 'gongwen' : !!opts.pageNumber

  const mainType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'

  const overrides = [
    {
      part: '/word/document.xml',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    },
    { part: '/word/styles.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml' },
    { part: '/word/settings.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml' }
  ]
  if (showPageNumber) {
    /* 双面打印要两份页脚：footer1 = 奇数页（default）、footer2 = 偶数页（even） */
    const footerType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'
    overrides.push({ part: '/word/footer1.xml', type: footerType })
    overrides.push({ part: '/word/footer2.xml', type: footerType })
  }
  overrides.push({ part: '/docProps/core.xml', type: 'application/vnd.openxmlformats-package.core-properties+xml' })
  overrides.push({
    part: '/docProps/app.xml',
    type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml'
  })

  const docRels: Array<{ id: string; type: string; target: string }> = [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
      target: 'styles.xml'
    },
    {
      id: 'rId2',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
      target: 'settings.xml'
    }
  ]
  if (showPageNumber) {
    const footerType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer'
    docRels.push({ id: 'rId3', type: footerType, target: 'footer1.xml' })
    docRels.push({ id: 'rId4', type: footerType, target: 'footer2.xml' })
  }

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: contentTypesXml(overrides) },
    { name: '_rels/.rels', data: rootRelsXml('word/document.xml', mainType) },
    { name: 'docProps/core.xml', data: coreXml(title, author, when) },
    { name: 'docProps/app.xml', data: appXml('BaiLianChatInYiTu', [title], '标题') },
    { name: 'word/document.xml', data: documentXml(blocks, layout, preset, opts) },
    { name: 'word/_rels/document.xml.rels', data: relsXml(docRels) },
    { name: 'word/styles.xml', data: stylesXml(layout) },
    { name: 'word/settings.xml', data: settingsXml(showPageNumber) }
  ]
  if (showPageNumber) {
    // rId3 = 奇数页（单页，居右）、rId4 = 偶数页（双页，居左）
    entries.push({ name: 'word/footer1.xml', data: footerXml(layout, 'right') })
    entries.push({ name: 'word/footer2.xml', data: footerXml(layout, 'left') })
  }

  return buildZip(entries, when)
}

export default buildDocx
