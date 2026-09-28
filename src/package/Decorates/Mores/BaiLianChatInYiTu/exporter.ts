/*
 * @Description: 对话导出内容构造
 *
 * 四种形态：
 *   html —— 自包含单文件，标题/列表/表格/加粗都是真实排版，双击可看，也能直接粘进 Word
 *   txt  —— 去掉 Markdown 语法符号的纯文本（含 BOM，Windows 记事本不糊中文）
 *   md   —— 原始 Markdown 源码，给需要留档、二次加工的场景
 *   docx —— Word 文档，默认按党政机关公文格式（GB/T 9704—2012）排版，见 docx.ts
 *
 * 前三种是纯字符串（不碰 DOM / Blob），最后一种产出字节，方便在 Node 侧直接跑断言；
 * 落盘由调用方负责（download.ts）。
 */
import { Conversation, ChatAttachment } from './types'
import { renderMarkdown, renderMarkdownToText, escapeHtml, parseMarkdownBlocks } from './markdown'
import { buildDocx } from './docx'
import { MIME } from './ooxml'

export type ExportFormat = 'html' | 'txt' | 'md' | 'docx'

export interface ExportResult {
  fileName: string
  /** 文本格式的内容；docx 时为空串（内容在 bytes 里） */
  content: string
  mime: string
  /** 二进制格式（docx）的字节 */
  bytes?: Uint8Array
}

/** Office 导出的可调项，来自设置面板 */
export interface OfficeOptions {
  /** 文档大标题。不传则调用方自己决定（消息级导出默认取正文首个标题） */
  title?: string
  /** 'gongwen' 标准公文格式 | 'plain' 普通文档 */
  preset?: string
  /** 标题字体，留空用预设的（公文默认「方正小标宋_GBK」） */
  titleFont?: string
  /** 正文字体覆盖 */
  bodyFont?: string
  author?: string
  /** 文档副标题区要显示的若干行（导出时间、来源等） */
  meta?: string[]
  when?: Date
}

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n))

/** 文件名里的时间戳：同一天导出多次不会互相覆盖 */
export const fileStamp = (d: Date) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`

/** 文件名净化：这几个字符在 Windows 上非法，全换成下划线 */
export const safeFileName = (name: string) =>
  String(name || '对话记录')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '对话记录'

const roleLabel = (conv: Conversation, isUser: boolean) =>
  isUser ? '我' : conv.targetName || 'AI'

const attLine = (atts?: ChatAttachment[]) =>
  atts && atts.length ? `附件：${atts.map(a => a.name).join('、')}` : ''

/** 导出 HTML 里渲染结果的样式：照着运行组件的气泡内排版重写一份浅色版 */
const HTML_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 40px 24px 64px; max-width: 860px; color: #1f2430;
  font: 15px/1.78 "PingFang SC", "Microsoft YaHei", -apple-system, "Segoe UI", sans-serif; }
h1.doc-title { margin: 0 0 8px; font-size: 22px; }
p.doc-meta { margin: 0 0 28px; color: #6b7280; font-size: 12px; }
section.turn { border-top: 1px solid #e5e7eb; padding-top: 14px; margin-top: 22px; }
section.turn > h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #6b7280; }
section.turn.me > h2 { color: #2563eb; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { margin: 18px 0 8px; line-height: 1.35; }
.md h1 { font-size: 20px; } .md h2 { font-size: 18px; } .md h3 { font-size: 16px; }
.md h4, .md h5, .md h6 { font-size: 15px; }
.md p { margin: 8px 0; }
.md ul, .md ol { margin: 8px 0; padding-left: 26px; }
.md li { margin: 3px 0; }
.md blockquote { margin: 10px 0; padding: 6px 14px; border-left: 3px solid #d1d5db;
  background: #f9fafb; color: #4b5563; }
.md hr { border: 0; border-top: 1px dashed #d1d5db; margin: 18px 0; }
.md code { padding: 1px 5px; border-radius: 4px; background: #f3f4f6;
  font-family: Consolas, Monaco, "Courier New", monospace; font-size: 13px; }
.md pre { margin: 10px 0; padding: 12px 14px; border-radius: 8px; background: #f6f8fa; overflow: auto; }
.md pre code { background: none; padding: 0; }
.md table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 14px; }
.md th, .md td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; vertical-align: top; }
.md th { background: #f3f4f6; }
.md img { max-width: 100%; }
.md .ac-table-wrap { overflow-x: auto; }
p.doc-atts { margin: 4px 0 0; color: #6b7280; font-size: 12px; }
`

function buildHtml(conv: Conversation, stampText: string): string {
  const turns = conv.messages
    .map(m => {
      const isUser = m.role === 'user'
      const body = isUser
        ? `<p>${escapeHtml(m.content || '（空）').replace(/\n/g, '<br/>')}</p>`
        : renderMarkdown(m.content || '（空）')
      const atts = attLine(m.attachments)
      return (
        `<section class="turn${isUser ? ' me' : ' ai'}">` +
        `<h2>${escapeHtml(roleLabel(conv, isUser))}</h2>` +
        `<div class="md">${body}</div>` +
        (atts ? `<p class="doc-atts">${escapeHtml(atts)}</p>` : '') +
        `</section>`
      )
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(conv.targetName || '对话记录')}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<h1 class="doc-title">${escapeHtml(conv.targetName || '对话记录')}</h1>
<p class="doc-meta">导出时间：${escapeHtml(stampText)}　·　会话标识：${escapeHtml(
    conv.sessionId || '（未建立）'
  )}　·　共 ${conv.messages.length} 条消息</p>
${turns}
</body>
</html>`
}

function buildText(conv: Conversation, stampText: string): string {
  const lines: string[] = [
    conv.targetName || '对话记录',
    `导出时间：${stampText}`,
    `会话标识：${conv.sessionId || '（未建立）'}`,
    '',
    '----------------------------------------',
    ''
  ]
  conv.messages.forEach(m => {
    const isUser = m.role === 'user'
    const body = isUser ? m.content || '（空）' : renderMarkdownToText(m.content || '（空）')
    lines.push(`【${roleLabel(conv, isUser)}】`)
    lines.push(body)
    const atts = attLine(m.attachments)
    if (atts) lines.push(atts)
    lines.push('')
  })
  // BOM：Windows 记事本 / 部分公文工具对无 BOM 的 UTF-8 仍会显示成乱码；
  // 换行统一成 CRLF —— 消息正文里本来就带 \n，不统一会出现"一半 LF 一半 CRLF"。
  return '\ufeff' + lines.join('\n').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n')
}

function buildMarkdown(conv: Conversation, stampText: string): string {
  const lines: string[] = [
    `# ${conv.targetName || '对话记录'}`,
    '',
    `导出时间：${stampText}`,
    `会话标识：${conv.sessionId || '（未建立）'}`,
    '',
    '---',
    ''
  ]
  conv.messages.forEach(m => {
    const isUser = m.role === 'user'
    lines.push(isUser ? '**我：**' : `**${conv.targetName || 'AI'}：**`)
    lines.push('')
    lines.push(m.content || '（空）')
    const atts = attLine(m.attachments)
    if (atts) lines.push('', atts)
    lines.push('')
  })
  return lines.join('\n')
}

/**
 * 从正文里挑一个文档标题：**首个标题 > 首段前 24 字 > "文档"**。
 * 三条消息级导出链路（Word / TXT / MD）共用，保证同一个回答导出的文件名与文档标题一致。
 */
export function pickDocTitle(markdown: string): string {
  const blocks = parseMarkdownBlocks(markdown || '')
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'heading') return b.text
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'para' || b.type === 'item') {
      return b.text.replace(/\s+/g, ' ').trim().slice(0, 24)
    }
  }
  return '文档'
}

/**
 * 生成 Word 文档（.docx）。
 * 接收 **Markdown 文本**而不是 Conversation：消息级导出（单条回答）和会话级导出
 * 都走这里，前者传消息正文，后者传拼好的 Markdown，不必各写一遍。
 *
 * @param text 待转换的 Markdown 文本
 */
export function buildOfficeExport(text: string, o?: OfficeOptions): ExportResult {
  const opt: OfficeOptions = o || {}
  const when = opt.when || new Date()
  let blocks = parseMarkdownBlocks(text)

  /* 标题来源：调用方指定 > 正文首个标题 > 首段前若干字。
     从正文里取标题时要**把它从 blocks 里摘掉**，否则 Word 里同一句话
     会先以二号小标宋居中显示一次、下面又以层次字体显示一次，看着像出错。 */
  let title = opt.title || ''
  if (!title) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.type === 'heading') {
        title = b.text
        blocks = blocks.slice(0, i).concat(blocks.slice(i + 1))
        break
      }
    }
    if (!title) title = pickDocTitle(text)
  }

  const base = safeFileName(title)
  const name = `${base}_${fileStamp(when)}`

  return {
    fileName: `${name}.docx`,
    content: '',
    mime: MIME.docx,
    bytes: buildDocx(blocks, {
      title,
      preset: opt.preset,
      titleFont: opt.titleFont,
      bodyFont: opt.bodyFont,
      meta: opt.meta,
      author: opt.author,
      when
    })
  }
}

/**
 * 单条回答导出成纯文本（.txt）。
 *
 * 与 Word 那条链路刻意不同：**不做 Markdown 结构转换**，直接取渲染后的文字，
 * 所以它永远不会因为解析器漏了一种语法而丢内容 —— 这是"先复制出来再说"的兜底出口。
 * 收尾与 buildText 保持一致（BOM + CRLF），Windows 记事本 / 公文写作工具才不会糊中文。
 */
export function buildMessageText(markdown: string, o?: { title?: string; when?: Date }): ExportResult {
  const opt: { title?: string; when?: Date } = o || {}
  const d = opt.when || new Date()
  const body = renderMarkdownToText(markdown || '')
  const text = ('\ufeff' + body).replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n')
  return {
    fileName: `${safeFileName(opt.title || pickDocTitle(markdown))}_${fileStamp(d)}.txt`,
    content: text,
    mime: 'text/plain;charset=utf-8'
  }
}

/**
 * 单条回答导出成 Markdown **原文**（.md）。
 *
 * 与上面两条链路都不同：这里**一个字符都不改** —— 文件内容与模型返回的 Markdown
 * 源码逐字节一致（不转结构、不改换行、不加 BOM）。用途是留档和二次加工：
 * 想自己重排版、喂给别的工具、或者对两份回答做 diff 时，只有原文才是可信的。
 *
 * 换行保持原样是刻意的：加了 CRLF 或 BOM 就不再是"原数据"了，
 * diff 工具、Markdown 编辑器都能正确处理 UTF-8 + LF，不需要照顾。
 */
export function buildMessageMarkdown(markdown: string, o?: { title?: string; when?: Date }): ExportResult {
  const opt: { title?: string; when?: Date } = o || {}
  const d = opt.when || new Date()
  return {
    fileName: `${safeFileName(opt.title || pickDocTitle(markdown))}_${fileStamp(d)}.md`,
    content: String(markdown == null ? '' : markdown),
    mime: 'text/markdown;charset=utf-8'
  }
}

/**
 * 生成导出文件内容。
 * @param conv      当前会话
 * @param format    导出格式（来自 option.exportFormat）
 * @param stampText 导出时间展示文案，由调用方格式化（保持本函数纯净、可测）
 * @param office    Word 排版的选项（来自设置面板）
 */
export function buildExport(
  conv: Conversation,
  format: ExportFormat | string,
  stampText: string,
  office?: OfficeOptions
): ExportResult {
  const base = safeFileName(conv.title || conv.targetName)
  const raw = String(format)
  const known = ['html', 'txt', 'md', 'docx']
  const fmt = (known.indexOf(raw) >= 0 ? raw : 'html') as ExportFormat

  if (fmt === 'docx') {
    // 会话级 Word 导出：先把整个会话拼成 Markdown，再交给同一套转换
    const opt: OfficeOptions = {
      title: conv.title || conv.targetName || '对话记录',
      preset: office && office.preset,
      titleFont: office && office.titleFont,
      bodyFont: office && office.bodyFont,
      author: office && office.author
    }
    const meta: string[] = [`导出时间：${stampText}`]
    if (conv.sessionId) meta.push(`会话标识：${conv.sessionId}`)
    meta.push(`共 ${conv.messages.length} 条消息`)
    opt.meta = meta
    return buildOfficeExport(buildMarkdown(conv, stampText), opt)
  }

  if (fmt === 'md') {
    return { fileName: `${base}.md`, content: buildMarkdown(conv, stampText), mime: 'text/markdown;charset=utf-8' }
  }
  if (fmt === 'txt') {
    return { fileName: `${base}.txt`, content: buildText(conv, stampText), mime: 'text/plain;charset=utf-8' }
  }
  return { fileName: `${base}.html`, content: buildHtml(conv, stampText), mime: 'text/html;charset=utf-8' }
}
