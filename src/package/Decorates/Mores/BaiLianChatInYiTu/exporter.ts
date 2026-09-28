/*
 * @Description: 对话导出内容构造
 *
 * 三种形态，默认 html（就是"渲染后的样子"）：
 *   html —— 自包含单文件，标题/列表/表格/加粗都是真实排版，双击可看，也能直接粘进 Word
 *   txt  —— 去掉 Markdown 语法符号的纯文本（含 BOM，Windows 记事本不糊中文）
 *   md   —— 原始 Markdown 源码，给需要留档、二次加工的场景
 *
 * 这里全是纯函数（不碰 DOM / Blob），方便在 Node 侧直接跑断言；
 * 落盘由调用方负责。
 */
import { Conversation, ChatAttachment } from './types'
import { renderMarkdown, renderMarkdownToText, escapeHtml } from './markdown'

export type ExportFormat = 'html' | 'txt' | 'md'

export interface ExportResult {
  fileName: string
  content: string
  mime: string
}

/** 文件名净化：这几个字符在 Windows 上非法，全换成下划线 */
export const safeFileName = (name: string) =>
  String(name || '对话记录')
    .replace(/[\\/:*?"<>|]/g, '_')
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
 * 生成导出文件内容。
 * @param conv      当前会话
 * @param format    导出格式（来自 option.exportFormat）
 * @param stampText 导出时间展示文案，由调用方格式化（保持本函数纯净、可测）
 */
export function buildExport(
  conv: Conversation,
  format: ExportFormat | string,
  stampText: string
): ExportResult {
  const base = safeFileName(conv.title || conv.targetName)
  const fmt = (['html', 'txt', 'md'].indexOf(String(format)) >= 0 ? String(format) : 'html') as ExportFormat
  if (fmt === 'md') {
    return { fileName: `${base}.md`, content: buildMarkdown(conv, stampText), mime: 'text/markdown;charset=utf-8' }
  }
  if (fmt === 'txt') {
    return { fileName: `${base}.txt`, content: buildText(conv, stampText), mime: 'text/plain;charset=utf-8' }
  }
  return { fileName: `${base}.html`, content: buildHtml(conv, stampText), mime: 'text/html;charset=utf-8' }
}
