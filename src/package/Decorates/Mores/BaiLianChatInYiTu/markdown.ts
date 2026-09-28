/*
 * @Description: BaiLianChatInYiTu 轻量 Markdown 渲染
 *
 * 为什么自己写而不是引第三方库：运行组件要保持**零 UI/工具库依赖**（naive-ui 只在设置面板用），
 * 一个 marked + DOMPurify 进来就是几十 KB，而这里只需要渲染模型回答里最常见的那几种语法。
 *
 * 安全：**先转义、再套格式**，输出里不会有模型原文里的任何标签，<script>/<img onerror> 只会显示成文本。
 *      链接与图片同样只放行 http(s) 与 data:image。
 *
 * 流式友好：分片会让语法处于"半截"状态（``` 没闭合、`**` 只来了一半）。
 *      未闭合的代码块照样按代码块渲染、半截强调保持字面量，不会把语法符号当正文吐给用户。
 */

const escapeHtml = (s: string) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]
  )

/** 只放行绝对地址，避免 `javascript:` 之类被塞进 href/src */
const safeUrl = (u: string) => {
  const s = String(u == null ? '' : u).trim()
  return /^(https?:\/\/|data:image\/)/i.test(s) ? s : ''
}

/* ------------------------------ 行内语法 ------------------------------ */

const inline = (s: string) => {
  // ★ 必须先整体转义，再套格式：v-html 不认"这是模型输出"，
  //   少了这一步，正文里一个 <img onerror> 就能在页面上执行脚本。
  let out = escapeHtml(s)
  // 图片必须排在链接前面，否则 `![alt](url)` 会被链接规则吃掉前半截
  out = out.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g, (_m, alt, url) => {
    const u = safeUrl(url)
    if (u) return `<img class="ac-img" src="${u}" alt="${alt}" />`
    return alt ? `<span>${alt}</span>` : ''
  })
  out = out.replace(/\[([^\]\n]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g, (_m, txt, url) => {
    const u = safeUrl(url)
    return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${txt}</a>` : txt
  })
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  // 斜体的前后必须是"非词字符"，否则 snake_case 里的下划线会被误伤
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>')
  return out
}

/* ------------------------------ 块级语法 ------------------------------ */

/** 代码块占位符：先整块摘出去，避免后续行内规则动到代码内容 */
const TOKEN_RE = /^\u0001ac-code-(\d+)\u0001$/
const token = (n: number) => `\u0001ac-code-${n}\u0001`

const codeBlockHtml = (code: string, lang: string) => {
  const cls = lang ? ` class="ac-lang-${lang.replace(/[^\w+#.-]/g, '')}"` : ''
  return `<pre class="ac-pre"><code${cls}>${escapeHtml(code)}</code></pre>`
}

const splitCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())

/** 分隔行：`| --- | :--: |`、`--- | ---` 都算 */
const isTableSep = (line: string) => {
  const s = line.trim()
  return s.indexOf('|') >= 0 && s.indexOf('-') >= 0 && /^[\s|:-]+$/.test(s)
}

interface ListItem {
  ordered: boolean
  level: number
  text: string
}

const itemHtml = (t: string) => inline(t).replace(/\n/g, '<br/>')

/** 把「带层级的扁平列表项」拼成嵌套的 <ul>/<ol> */
const buildList = (items: ListItem[]) => {
  let out = ''
  const stack: boolean[] = []
  /** 关掉比 depth 更深的层：每关一层就是「收尾项 + 收列表」 */
  const unwindTo = (depth: number) => {
    while (stack.length > depth) {
      const ordered = stack.pop() as boolean
      out += `</li></${ordered ? 'ol' : 'ul'}>`
    }
  }
  for (const it of items) {
    const depth = Math.max(1, it.level + 1)
    if (!stack.length) {
      out += it.ordered ? '<ol>' : '<ul>'
      stack.push(it.ordered)
    } else if (depth > stack.length) {
      // 更深：新列表直接嵌在当前 <li> 内部，不先收尾
      while (stack.length < depth) {
        out += it.ordered ? '<ol>' : '<ul>'
        stack.push(it.ordered)
      }
    } else {
      unwindTo(depth)
      out += '</li>'
    }
    out += `<li>${itemHtml(it.text)}`
  }
  unwindTo(0)
  return out
}

/**
 * 渲染 Markdown 为 HTML 字符串。
 * 覆盖：标题 / 段落 / 无序·有序列表（可嵌套）/ 引用 / 分割线 / 代码块 /
 *       表格 / 加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 图片。
 */
export function renderMarkdown(raw: string): string {
  const src = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n')
  const lines = src.split('\n')

  /* ---- 第一遍：摘出代码块（含流式下未闭合的那种）---- */
  const blocks: string[] = []
  const rest: string[] = []
  let fence: string[] | null = null
  let fenceLang = ''
  for (const ln of lines) {
    if (fence) {
      if (/^ {0,3}(?:`{3,}|~{3,})\s*$/.test(ln)) {
        blocks.push(codeBlockHtml(fence.join('\n'), fenceLang))
        rest.push(token(blocks.length - 1))
        fence = null
        fenceLang = ''
      } else {
        fence.push(ln)
      }
      continue
    }
    const open = /^ {0,3}(?:`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(ln)
    if (open) {
      fence = []
      fenceLang = open[1] || ''
      continue
    }
    rest.push(ln)
  }
  if (fence) {
    blocks.push(codeBlockHtml(fence.join('\n'), fenceLang))
    rest.push(token(blocks.length - 1))
  }

  /* ---- 第二遍：逐块组装 ---- */
  const html: string[] = []
  let para: string[] = []
  const flushPara = () => {
    if (!para.length) return
    html.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br/>')}</p>`)
    para = []
  }

  let i = 0
  while (i < rest.length) {
    const ln = rest[i]

    const code = TOKEN_RE.exec(ln)
    if (code) {
      flushPara()
      html.push(blocks[Number(code[1])] || '')
      i++
      continue
    }

    const t = ln.trim()
    if (!t) {
      flushPara()
      i++
      continue
    }

    // 分割线（--- / *** / ___）：必须先于列表判断，否则 `---` 会被当成空列表项
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(ln)) {
      flushPara()
      html.push('<hr/>')
      i++
      continue
    }

    // 标题
    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln)
    if (h) {
      flushPara()
      const lv = h[1].length
      html.push(`<h${lv}>${inline(h[2])}</h${lv}>`)
      i++
      continue
    }

    // 引用
    if (/^ {0,3}>/.test(ln)) {
      flushPara()
      const buf: string[] = []
      while (i < rest.length && /^ {0,3}>/.test(rest[i])) {
        buf.push(rest[i].replace(/^ {0,3}>\s?/, ''))
        i++
      }
      html.push(`<blockquote>${inline(buf.join('\n')).replace(/\n/g, '<br/>')}</blockquote>`)
      continue
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (t.indexOf('|') >= 0 && i + 1 < rest.length && isTableSep(rest[i + 1])) {
      flushPara()
      const head = splitCells(ln)
      const aligns = splitCells(rest[i + 1]).map(c =>
        /^:-+:$/.test(c) ? 'center' : /^:-+/.test(c) ? 'left' : /-+:$/.test(c) ? 'right' : ''
      )
      i += 2
      const rows: string[][] = []
      while (i < rest.length && rest[i].trim() && rest[i].indexOf('|') >= 0) {
        rows.push(splitCells(rest[i]))
        i++
      }
      const attr = (n: number) => (aligns[n] ? ` style="text-align:${aligns[n]}"` : '')
      const th = head.map((c, n) => `<th${attr(n)}>${inline(c)}</th>`).join('')
      const tb = rows
        .map(r => `<tr>${head.map((_c, n) => `<td${attr(n)}>${inline(r[n] || '')}</td>`).join('')}</tr>`)
        .join('')
      html.push(`<div class="ac-table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`)
      continue
    }

    // 列表（支持按缩进嵌套，续行缩进 ≥2 空格算同一项）
    const li = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(ln)
    if (li) {
      flushPara()
      const items: ListItem[] = []
      let base = -1
      while (i < rest.length) {
        const m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(rest[i])
        if (m) {
          const indent = m[1].replace(/\t/g, '    ').length
          if (base < 0) base = indent
          const level = indent <= base ? 0 : Math.min(3, Math.max(1, Math.floor((indent - base) / 2)))
          items.push({ ordered: /\d/.test(m[2]), level, text: m[3] })
          i++
          continue
        }
        if (items.length && rest[i].trim() && /^\s{2,}/.test(rest[i])) {
          items[items.length - 1].text += '\n' + rest[i].trim()
          i++
          continue
        }
        break
      }
      html.push(buildList(items))
      continue
    }

    para.push(t)
    i++
  }
  flushPara()

  return html.join('')
}

export default renderMarkdown
