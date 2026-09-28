/*
 * @Description: OOXML 公共工具（docx / xlsx 共用）
 *
 * 只放三件事：XML 转义与非法字符清理、Office 的长度/字号单位换算、包内 part 拼装约定。
 * 不涉及任何具体文档结构 —— 那些在 docx.ts / xlsx.ts 里。
 */

/* ------------------------------ XML ------------------------------ */

/**
 * XML 1.0 不允许的字符：C0 控制字符（除 \t \n \r）、\uFFFE \uFFFF，以及**孤立代理项**。
 *
 * 这一步不是可有可无的洁癖：模型输出里混进一个 \u0000 或落单的 emoji 代理项，
 * 整个 document.xml 就成了非法 XML，Word 打开会直接弹"此文件中的内容有问题"，
 * 而且报错完全指不到是哪个字符。所以在**所有文本进 XML 之前**统一清一遍。
 *
 * ★ 注意 \u0001 也是控制字符，会被清掉 —— 正好，那是 markdown 解析器内部的占位符，
 *   走到这一步本该已经全部展开成真实文本；没展开就会被清掉，不会泄漏到文档里。
 */
const INVALID_XML = [
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
  /[\uFFFE\uFFFF]/g,
  // 高位代理后面没跟低位代理（孤立的高位）
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g,
  // 低位代理前面没有高位（孤立的低位）
  /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g
]

export function cleanXmlText(s: string): string {
  let out = String(s == null ? '' : s)
  out = out.replace(INVALID_XML[0], '').replace(INVALID_XML[1], '')
  out = out.replace(INVALID_XML[2], '')
  // 这个分支带了前导字符的捕获组，用函数还原，避免把前一个正常字符一起吃掉
  out = out.replace(INVALID_XML[3], (_m, keep: string) => keep || '')
  return out
}

/** 文本节点转义（清非法字符 + 转义五个特殊字符） */
export function esc(s: string): string {
  return cleanXmlText(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' } as Record<string, string>)[c]
  )
}

/** 属性值转义：与文本节点同规则（双引号包属性，所以 `"` 必须转） */
export const escAttr = esc

/** XML 声明：standalone="yes" 是 Office 自己产出的形式，保持一致 */
export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

/* ------------------------------ 单位换算 ------------------------------ */

/**
 * 长度单位换算。OOXML 里到处都是 twip（二十分之一磅），1 磅 = 1/72 英寸 = 25.4/72 毫米。
 * 公文页边距是按毫米规定的（上 37 下 35 左 28 右 26），所以这里必须有 mm 入口。
 */
export const mm = (v: number) => Math.round((v * 1440) / 25.4)
export const cm = (v: number) => mm(v * 10)
export const pt = (v: number) => Math.round(v * 20)

/**
 * 字号：OOXML 的 w:sz / w:szCs 单位是**半磅**。
 * 中文公文习惯用"号"称呼，转换表（磅 → 号）：初号42 小初36 一号26 小一24 二号22 小二18
 * 三号16 小三15 四号14 小四12 五号10.5 小五9。
 * 这里直接给常用号数，避免调用点上到处写 44 / 32 / 28 这种魔数。
 */
export const FONT_SIZE = {
  chuhao: 84, // 初号 42pt
  xiaochu: 72, // 小初 36pt
  yihao: 52, // 一号 26pt
  xiaoyi: 48, // 小一 24pt
  erhao: 44, // 二号 22pt
  xiaoer: 36, // 小二 18pt
  sanhao: 32, // 三号 16pt
  xiaosan: 30, // 小三 15pt
  sihao: 28, // 四号 14pt
  xiaosi: 24, // 小四 12pt
  wuhao: 21, // 五号 10.5pt
  xiaowu: 18 // 小五 9pt
}

/* ------------------------------ 包内路径 ------------------------------ */

/** docx / xlsx 共用的 OOXML 命名空间 */
export const NS = {
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  core: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  ep: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  vt: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  ss: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
}

/** 关系项：组件 id → 目标路径，供各 part 的 .rels 复用 */
export interface Rel {
  id: string
  type: string
  target: string
  /** 外部目标（超链接）需要显式标记 TargetMode="External" */
  external?: boolean
}

export function relsXml(rels: Rel[]): string {
  const body = rels
    .map(
      r =>
        `<Relationship Id="${escAttr(r.id)}" Type="${escAttr(r.type)}" Target="${escAttr(r.target)}"${
          r.external ? ' TargetMode="External"' : ''
        }/>`
    )
    .join('')
  return `${XML_DECL}<Relationships xmlns="${NS.rel}">${body}</Relationships>`
}

/** [Content_Types].xml：Default 给扩展名兜底，Override 逐个声明 part 的 MIME */
export interface ContentType {
  part: string // 以 / 开头，如 /word/document.xml
  type: string
}

export function contentTypesXml(overrides: ContentType[], defaults?: Array<{ ext: string; type: string }>): string {
  const defs = defaults || [
    { ext: 'rels', type: 'application/vnd.openxmlformats-package.relationships+xml' },
    { ext: 'xml', type: 'application/xml' }
  ]
  const d = defs.map(x => `<Default Extension="${escAttr(x.ext)}" ContentType="${escAttr(x.type)}"/>`).join('')
  const o = overrides
    .map(x => `<Override PartName="${escAttr(x.part)}" ContentType="${escAttr(x.type)}"/>`)
    .join('')
  return `${XML_DECL}<Types xmlns="${NS.ct}">${d}${o}</Types>`
}

/** 包级 .rels：指向主文档 + 两个 docProps */
export function rootRelsXml(mainPart: string, mainType: string): string {
  return relsXml([
    { id: 'rId1', type: mainType, target: mainPart },
    {
      id: 'rId2',
      type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
      target: 'docProps/core.xml'
    },
    {
      id: 'rId3',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
      target: 'docProps/app.xml'
    }
  ])
}

/** docProps/core.xml：标题/作者/时间。缺了不影响打开，但文件属性里全是空白不好看 */
export function coreXml(title: string, creator: string, when: Date): string {
  const iso = when.toISOString().replace(/\.\d+Z$/, 'Z')
  return (
    `${XML_DECL}<cp:coreProperties xmlns:cp="${NS.core}" xmlns:dc="${NS.dc}" xmlns:dcterms="${NS.dcterms}" xmlns:xsi="${NS.xsi}">` +
    `<dc:title>${esc(title)}</dc:title>` +
    `<dc:creator>${esc(creator)}</dc:creator>` +
    `<cp:lastModifiedBy>${esc(creator)}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>` +
    `</cp:coreProperties>`
  )
}

/**
 * docProps/app.xml：产生该文件的应用程序名与"各部分标题"清单。
 * @param groupLabel 集合的称呼，Word 文档用「标题」、工作簿用「工作表」
 */
export function appXml(appName: string, titlesOfParts: string[], groupLabel?: string): string {
  const parts = titlesOfParts.map(t => `<vt:lpstr>${esc(t)}</vt:lpstr>`).join('')
  return (
    `${XML_DECL}<Properties xmlns="${NS.ep}" xmlns:vt="${NS.vt}">` +
    `<Application>${esc(appName)}</Application>` +
    `<DocSecurity>0</DocSecurity>` +
    `<ScaleCrop>false</ScaleCrop>` +
    `<HeadingPairs><vt:vector size="2" baseType="variant">` +
    `<vt:variant><vt:lpstr>${esc(groupLabel || '工作表')}</vt:lpstr></vt:variant>` +
    `<vt:variant><vt:i4>${titlesOfParts.length}</vt:i4></vt:variant>` +
    `</vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector size="${titlesOfParts.length}" baseType="lpstr">${parts}</vt:vector></TitlesOfParts>` +
    `<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>` +
    `<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>` +
    `</Properties>`
  )
}

/** Office MIME：给下载的 Blob 用。写错会导致浏览器把它当 zip 打开 */
export const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}
