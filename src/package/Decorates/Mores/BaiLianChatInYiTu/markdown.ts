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
 *
 * 空白清理：模型爱用空格摆版式（`总指挥：   企业主要负责人`、`一、 总体要求`），
 *      网页上还看得过去，导出成 Word 就是满篇多余空格。三条渲染链路都在取"内容"的地方
 *      统一过 squeezeSpaces()（只清内容，不动行首缩进 —— 那是列表的层级）。
 */

/** 导出 HTML 时也要转义用户输入，共用同一份实现 */
export const escapeHtml = (s: string) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]
  )

/** 只放行绝对地址，避免 `javascript:` 之类被塞进 href/src */
const safeUrl = (u: string) => {
  const s = String(u == null ? '' : u).trim()
  return /^(https?:\/\/|data:image\/)/i.test(s) ? s : ''
}

/* ------------------------------ 空白清理 ------------------------------ */

/** 中日韩文字与全角标点（含全角空格 U+3000） */
const CJK = '\\u3000-\\u303F\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFFEF'

/**
 * 清理一行**内容**里多余的空格。
 *
 * 模型很爱用空格摆版式：`总指挥：   企业主要负责人`（靠空格对齐）、
 * `一、 总体要求`、`第一章　　总则`。这些空格在网页上还能当视觉提示，
 * 到了 Word 里就是满篇多余空格（两端对齐本来就会把行铺满），必须去掉。
 *
 * ★ 只传"内容"进来，**不要拿它处理整行 Markdown** —— 行首缩进是列表嵌套的层级，
 *   清掉就把层级弄丢了。列表项要先用正则取出正文（m[3]）再传给这里。
 *
 * 规则：
 *   1. 行内代码里的空格是内容本身，先摘成占位符，清完再原样还原；
 *   2. 全角空格归一成半角，连续空白收成一个；
 *   3. 中文与中文（含全角标点）之间的空格一律去掉。中英文之间、数字前后的空格是
 *      正常写法（「依据 GB/T 9704 标准」「共 30 人」），一律不动；
 *   4. 首尾去空白。
 */
export function squeezeSpaces(line: string): string {
  let s = String(line == null ? '' : line)
  if (!s) return ''

  const codes: string[] = []
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c)
    return `\u0002${codes.length - 1}\u0002`
  })

  s = s.replace(/\u3000/g, ' ').replace(/[ \t]{2,}/g, ' ')

  /* 空格两侧允许夹着强调标记（`**一、** 总体要求`、`混排 **加粗** 与`），否则这一条会漏。
     ★ 标记必须**原样还回去**（$1$2$3）：只写 $1 会把开头的 `**` 一起吃掉，
       加粗标记没了、只剩一个孤零零的收尾星号，比空格本身更糟。
     代码占位符 \u0002 不在这个字符集里 —— 「中文 `code` 中文」两侧的空格会被保留。 */
  const mark = '([*_`~]{0,4})'
  s = s.replace(new RegExp(`([${CJK}])${mark}[ \\t]+${mark}(?=[${CJK}])`, 'g'), '$1$2$3')

  s = s.trim()
  s = s.replace(/\u0002(\d+)\u0002/g, (_m, n: string) => {
    const c = codes[Number(n)]
    return c == null ? '' : '`' + c + '`'
  })
  return s
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
      html.push(`<h${lv}>${inline(squeezeSpaces(h[2]))}</h${lv}>`)
      i++
      continue
    }

    // 引用
    if (/^ {0,3}>/.test(ln)) {
      flushPara()
      const buf: string[] = []
      while (i < rest.length && /^ {0,3}>/.test(rest[i])) {
        buf.push(squeezeSpaces(rest[i].replace(/^ {0,3}>\s?/, '')))
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
      const th = head.map((c, n) => `<th${attr(n)}>${inline(squeezeSpaces(c))}</th>`).join('')
      const tb = rows
        .map(r => `<tr>${head.map((_c, n) => `<td${attr(n)}>${inline(squeezeSpaces(r[n] || ''))}</td>`).join('')}</tr>`)
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
          items.push({ ordered: /\d/.test(m[2]), level, text: squeezeSpaces(m[3]) })
          i++
          continue
        }
        if (items.length && rest[i].trim() && /^\s{2,}/.test(rest[i])) {
          items[items.length - 1].text += '\n' + squeezeSpaces(rest[i].trim())
          i++
          continue
        }
        break
      }
      html.push(buildList(items))
      continue
    }

    para.push(squeezeSpaces(t))
    i++
  }
  flushPara()

  return html.join('')
}

export default renderMarkdown

/* ==================================================================== *
 * 纯文本渲染：复制到剪贴板的 text/plain 片段、导出 .txt
 *
 * 为什么单独写一遍而不是"渲染 HTML 再扒标签"：
 *   运行组件零依赖，没有 DOM 解析器可用（Node 侧测试也跑不起来）。
 * 代价是要和 renderMarkdown 保持同一套块级判定，所以这里**逐块对照**着上面写，
 * 两边改动要同步 —— 语法集合是固定的（就下面这几类），维护成本可控。
 *
 * 约定：**去掉语法符号，保留阅读结构**。
 *   列表保留 `- ` / `1. ` 前缀（去掉反而读不出层级），引用去掉 `>`，
 *   表格去掉分隔行、单元格用 ` | ` 连接（各占一行，粘到哪都还能看出是几列）。
 * ==================================================================== */

/** 行内：剥掉强调/代码/链接等语法符号，只留文字 */
export const stripInline = (s: string) => {
  let out = String(s == null ? '' : s)
  // 图片：正文里是我们自己生成的 ![图片](url)，纯文本给个占位，别把 url 摊在正文里
  out = out.replace(/!\[([^\]]*)\]\(\s*[^)\s]*(?:\s+["'][^"']*["'])?\s*\)/g, (_m, alt) =>
    alt ? `[${alt}]` : '[图片]'
  )
  // 链接：文字和地址不同才把地址附在后面，相同（裸链）就只留一份
  out = out.replace(/\[([^\]\n]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g, (_m, txt, url) =>
    !txt || txt === url ? url : `${txt}（${url}）`
  )
  out = out.replace(/`([^`]+)`/g, '$1')
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  out = out.replace(/__([^_]+)__/g, '$1')
  out = out.replace(/~~([^~]+)~~/g, '$1')
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1$2')
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1$2')
  return out
}

/**
 * 把 Markdown 渲染成"给人读的纯文本"。
 * 与 renderMarkdown 同一套块级规则：标题 / 列表（可嵌套）/ 引用 / 分割线 /
 * 代码块（原样保留）/ 表格 / 段落。
 * 与 HTML 版唯一的差别是分割线：**不输出横杠**，只留一个空行（见下面 hr 分支）。
 */
export function renderMarkdownToText(raw: string): string {
  const src = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n')
  const lines = src.split('\n')
  const out: string[] = []
  /** 空行统一收口：连续空行只留一个，末尾不补 */
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('')
  }

  let i = 0
  /* 保险丝：每个分支都必须自己推进 i，漏一个就是死循环（数组会一直长到 RangeError 崩掉页面）。
     这里兜住 —— 解析的是模型流式输出，宁可少渲染一行也不能把大屏卡死。 */
  let guard = 0
  while (i < lines.length) {
    if (++guard > lines.length * 4 + 64) break
    const ln = lines[i]
    const t = ln.trim()

    if (!t) {
      blank()
      i++
      continue
    }

    /* 分割线（先于列表判断，否则 `---` 会被当成空列表项）：
       文字版里**不画**那排横杠 —— 粘贴到微信 / Word / 公文里，"----------" 是纯噪音，
       段落之间的空行已经把层次说清楚了。这一行仍然要吃掉，不能落到列表分支去。 */
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(ln)) {
      blank()
      i++
      continue
    }

    // 代码块：内容原样保留，不做行内剥离（代码里的 `**` 就是两个星号）
    const fenceOpen = /^ {0,3}(?:`{3,}|~{3,})\s*[\w+#.-]*\s*$/.exec(ln)
    if (fenceOpen) {
      blank()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^ {0,3}(?:`{3,}|~{3,})\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // 吃掉收尾的 ```
      out.push(buf.join('\n'))
      continue
    }

    // 标题：去掉 #，文字照旧
    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln)
    if (h) {
      blank()
      out.push(stripInline(squeezeSpaces(h[2])))
      i++
      continue
    }

    // 引用：去掉 >，内容照旧
    if (/^ {0,3}>/.test(ln)) {
      blank()
      const buf: string[] = []
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        buf.push(stripInline(squeezeSpaces(lines[i].replace(/^ {0,3}>\s?/, ''))))
        i++
      }
      out.push(buf.join('\n'))
      continue
    }

    // 表格：去掉分隔行，单元格用 ` | ` 连
    if (t.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      blank()
      out.push(splitCells(ln).map(c => stripInline(squeezeSpaces(c))).join(' | '))
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) {
        out.push(splitCells(lines[i]).map(c => stripInline(squeezeSpaces(c))).join(' | '))
        i++
      }
      continue
    }

    // 列表：保留缩进与 `- `/`N. ` 前缀，层级用两空格缩进表达
    const li = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(ln)
    if (li) {
      blank()
      let base = -1
      /** 每层的序号计数（有序列表自己重排，避免模型写的序号跳号） */
      const counters: number[] = []
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[i])
        if (m) {
          const indent = m[1].replace(/\t/g, '    ').length
          if (base < 0) base = indent
          const level = indent <= base ? 0 : Math.min(3, Math.max(1, Math.floor((indent - base) / 2)))
          const ordered = /\d/.test(m[2])
          counters.length = level + 1
          counters[level] = (counters[level] || 0) + 1
          const marker = ordered ? `${counters[level]}. ` : '- '
          out.push('  '.repeat(level) + marker + stripInline(squeezeSpaces(m[3])))
          i++
          continue
        }
        // 续行（缩进 ≥2 空格）：并进上一项
        if (out.length && lines[i].trim() && /^\s{2,}/.test(lines[i])) {
          out[out.length - 1] += '\n' + stripInline(squeezeSpaces(lines[i].trim()))
          i++
          continue
        }
        break
      }
      continue
    }

    // 段落：整段里的换行保留
    blank()
    const buf: string[] = []
    while (i < lines.length && lines[i].trim()) {
      const cur = lines[i]
      if (isBlockStart(cur)) break
      // 表格首行要留给主循环 —— 只有它才知道下一行是不是分隔行
      if (cur.trim().indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) break
      buf.push(stripInline(squeezeSpaces(cur.trim())))
      i++
    }
    out.push(buf.join('\n'))
  }

  // 收口：去掉尾部空行
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/** 段落收集的终止判定：遇到任何一种块级起点就交给主循环处理 */
const isBlockStart = (ln: string): boolean => {
  if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(ln)) return true
  if (/^ {0,3}(?:`{3,}|~{3,})\s*[\w+#.-]*\s*$/.test(ln)) return true
  if (/^ {0,3}#{1,6}\s+/.test(ln)) return true
  if (/^ {0,3}>/.test(ln)) return true
  if (/^(\s*)([-*+]|\d{1,9}[.)])\s+/.test(ln)) return true
  return false
}

/* ==================================================================== *
 * 结构化解析：给 Word 导出用
 *
 * 上面两个渲染器输出的是 **字符串**（HTML / 纯文本），而生成 Office 文档需要的是
 * **结构**：段落是什么级别、哪些文字加粗、表格有几行几列。
 * 所以这里第三遍实现同一套块级判定 —— 这是本文件里唯一"重复"的地方，代价明确，
 * 换来的是导出模块不必去解析 HTML（运行组件没有 DOM 解析器可用）。
 *
 * ★ 三份实现的语法集合必须同步。为了防漂移，自检里有一条交叉断言：
 *   同一批样本喂给 renderMarkdown 和 parseMarkdownBlocks，
 *   顶层标签序列必须与块类型序列一一对应（tools/verify-office-export.cjs 第 1 组）。
 * ==================================================================== */

export type MdBlock =
  /** 标题（# 的数量 = level），公文里映射成黑体/楷体/仿宋的层级 */
  | { type: 'heading'; level: number; text: string }
  /** 普通段落，内部软换行保留在 text 的 \n 里 */
  | { type: 'para'; text: string }
  /** 列表项：已按 level 展开成扁平的项，ordered 决定用序号还是圆点，index 是本层内从 1 开始的序号 */
  | { type: 'item'; ordered: boolean; level: number; index: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'table'; head: string[]; rows: string[][]; aligns: string[] }
  | { type: 'hr' }

/** 行内片段：一段连续文字 + 它的修饰。表格单元格、段落都由它拼出来 */
export interface MdRun {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  /** 链接地址。图片没有地址（Office 正文里嵌图要额外 part，这里只留 alt 文字） */
  link?: string
}

/** 每个语法分支只声明：怎么匹配、正文取第几组、有没有需要"还回去"的前导字符 */
interface InlineSyntax {
  re: RegExp
  /** 取出可读文字（图片转成 [alt]） */
  text: (m: RegExpExecArray) => string
  /** 匹配里被顺手吃进来的前一个正常字符（只有"前后必须非词字符"的斜体规则需要） */
  keep?: (m: RegExpExecArray) => string
  /** 链接地址 / 是否安全由 safeUrl 判定，返回空串表示降级成纯文字 */
  url?: (m: RegExpExecArray) => string
  style?: Partial<MdRun>
}

const INLINE_SYNTAX: InlineSyntax[] = [
  {
    // 图片必须在链接前面，否则 ![alt](url) 会被链接规则吃掉前半截
    re: /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/,
    text: m => (m[1] ? `[${m[1]}]` : '[图片]')
  },
  {
    re: /\[([^\]\n]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/,
    text: m => m[1] || m[2],
    url: m => safeUrl(m[2])
  },
  { re: /\*\*([^*]+)\*\*/, text: m => m[1], style: { bold: true } },
  { re: /__([^_]+)__/, text: m => m[1], style: { bold: true } },
  { re: /~~([^~]+)~~/, text: m => m[1], style: { strike: true } },
  {
    // 斜体的前后必须是"非词字符"，否则 snake_case 里的下划线会被误伤
    re: /(^|[^*\w])\*([^*\n]+)\*(?![*\w])/,
    text: m => m[2],
    keep: m => m[1],
    style: { italic: true }
  },
  {
    re: /(^|[^_\w])_([^_\n]+)_(?![_\w])/,
    text: m => m[2],
    keep: m => m[1],
    style: { italic: true }
  }
]

const CODE_SPAN_RE = /`([^`]+)`/g
const codeToken = (n: number) => `\u0001c${n}\u0001`

/**
 * 把一行行内文本拆成带修饰的片段序列。
 *
 * 实现是"**每轮取最早出现的那个语法**"，而不是像 inline() 那样逐个 replace ——
 * replace 链的顺序即优先级，写错了会互相吃（`![` 被 `[` 抢走之类）；
 * 取最早匹配则天然按位置决定，语义只取决于"哪个语法先出现"。
 *
 * 反引号里的代码最先被摘成占位符：代码内容不参与任何强调解析
 * （`` `a**b**` `` 里那两个星号就是两个星号）。
 */
export function parseInlineRuns(src: string): MdRun[] {
  const codes: string[] = []
  const stripped = String(src == null ? '' : src).replace(CODE_SPAN_RE, (_m, c: string) => {
    codes.push(c)
    return codeToken(codes.length - 1)
  })

  const out: MdRun[] = []

  /** 追加一段纯文本，样式相同的相邻片段自动合并（减少 run 数量，Word 里更好编辑） */
  const push = (text: string, style: Partial<MdRun>) => {
    if (!text) return
    const last = out.length ? out[out.length - 1] : null
    if (
      last &&
      !!last.bold === !!style.bold &&
      !!last.italic === !!style.italic &&
      !!last.strike === !!style.strike &&
      !!last.code === !!style.code &&
      (last.link || '') === (style.link || '')
    ) {
      last.text += text
      return
    }
    out.push({
      text,
      bold: style.bold,
      italic: style.italic,
      strike: style.strike,
      code: style.code,
      link: style.link
    })
  }

  const scan = (s: string, style: Partial<MdRun>, depth: number) => {
    if (!s) return
    // 深度兜底：嵌套强调最多 6 层，再多就原样输出，别把病态输入变成栈溢出
    if (depth > 6) {
      push(s, style)
      return
    }

    /* 代码占位符与行内语法**按位置竞争**，谁先出现谁先处理。
       不能把占位符事先 split 掉 —— `**\u0001c0\u0001**` 会被切成
       ['**', '0', '**']，两个星号就成了字面量，加粗丢了。 */
    const cRe = /\u0001c(\d+)\u0001/g
    const cm = cRe.exec(s)

    let best: { syn: InlineSyntax; m: RegExpExecArray } | null = null
    for (let i = 0; i < INLINE_SYNTAX.length; i++) {
      const syn = INLINE_SYNTAX[i]
      const m = syn.re.exec(s)
      if (m && (!best || m.index < best.m.index)) best = { syn, m }
    }

    // 代码在最前：整段取出，带 code 标记（继承外层样式，让加粗里的代码仍然加粗）
    if (cm && (!best || cm.index <= (best as { m: RegExpExecArray }).m.index)) {
      push(s.slice(0, cm.index), style)
      const n = Number(cm[1])
      push(codes[n] == null ? '' : codes[n], {
        bold: style.bold,
        italic: style.italic,
        strike: style.strike,
        link: style.link,
        code: true
      })
      scan(s.slice(cm.index + cm[0].length), style, depth)
      return
    }

    if (!best) {
      push(s, style)
      return
    }

    const before = s.slice(0, best.m.index) + (best.syn.keep ? best.syn.keep(best.m) : '')
    const inner = best.syn.text(best.m)
    const after = s.slice(best.m.index + best.m[0].length)

    push(before, style)
    const url = best.syn.url ? best.syn.url(best.m) : ''
    const innerStyle: Partial<MdRun> = {
      bold: style.bold || !!(best.syn.style && best.syn.style.bold),
      italic: style.italic || !!(best.syn.style && best.syn.style.italic),
      strike: style.strike || !!(best.syn.style && best.syn.style.strike),
      link: url || style.link
    }
    if (inner) scan(inner, innerStyle, depth + 1)
    if (after) scan(after, style, depth)
  }

  scan(stripped, {}, 0)
  return out
}

/** runs → 一行纯文字（表格列宽估算、不需要保留结构时的兜底） */
export const runsToText = (runs: MdRun[]): string => runs.map(r => r.text).join('')

/** 块级解析：与 renderMarkdownToText 同一套规则，只把结果留成结构 */
export function parseMarkdownBlocks(raw: string): MdBlock[] {
  const src = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n')
  const lines = src.split('\n')
  const out: MdBlock[] = []
  let i = 0
  /* 保险丝：与 renderMarkdownToText 同理 —— 吃的是模型输出，宁可少一块也不能死循环 */
  let guard = 0

  while (i < lines.length) {
    if (++guard > lines.length * 4 + 64) break
    const ln = lines[i]
    const t = ln.trim()

    if (!t) {
      i++
      continue
    }

    // 分割线（先于列表判断，否则 `---` 会被当成空列表项）
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(ln)) {
      out.push({ type: 'hr' })
      i++
      continue
    }

    // 代码块：内容原样保留（流式下未闭合的也按代码块收）
    const fenceOpen = /^ {0,3}(?:`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(ln)
    if (fenceOpen) {
      const lang = fenceOpen[1] || ''
      const buf: string[] = []
      i++
      while (i < lines.length && !/^ {0,3}(?:`{3,}|~{3,})\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // 吃掉收尾的 ```
      out.push({ type: 'code', lang, code: buf.join('\n') })
      continue
    }

    // 标题
    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln)
    if (h) {
      out.push({ type: 'heading', level: h[1].length, text: squeezeSpaces(h[2]) })
      i++
      continue
    }

    // 引用
    if (/^ {0,3}>/.test(ln)) {
      const buf: string[] = []
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        buf.push(squeezeSpaces(lines[i].replace(/^ {0,3}>\s?/, '')))
        i++
      }
      out.push({ type: 'quote', text: buf.join('\n') })
      continue
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (t.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitCells(ln).map(squeezeSpaces)
      const aligns = splitCells(lines[i + 1]).map((c: string) =>
        /^:-+:$/.test(c) ? 'center' : /^:-+/.test(c) ? 'left' : /-+:$/.test(c) ? 'right' : ''
      )
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) {
        rows.push(splitCells(lines[i]).map(squeezeSpaces))
        i++
      }
      out.push({ type: 'table', head, rows, aligns })
      continue
    }

    // 列表：展开成带 level 的扁平项，序号在本层内自己重排（模型写的序号常跳号）
    const li = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(ln)
    if (li) {
      let base = -1
      const counters: number[] = []
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[i])
        if (m) {
          const indent = m[1].replace(/\t/g, '    ').length
          if (base < 0) base = indent
          const level = indent <= base ? 0 : Math.min(3, Math.max(1, Math.floor((indent - base) / 2)))
          const ordered = /\d/.test(m[2])
          counters.length = level + 1
          counters[level] = (counters[level] || 0) + 1
          out.push({ type: 'item', ordered, level, index: counters[level], text: squeezeSpaces(m[3]) })
          i++
          continue
        }
        // 续行（缩进 ≥2 空格）：并进上一项
        if (out.length && out[out.length - 1].type === 'item' && lines[i].trim() && /^\s{2,}/.test(lines[i])) {
          const prev = out[out.length - 1] as Extract<MdBlock, { type: 'item' }>
          prev.text += '\n' + squeezeSpaces(lines[i].trim())
          i++
          continue
        }
        break
      }
      continue
    }

    // 段落：整段里的换行保留
    const buf: string[] = []
    while (i < lines.length && lines[i].trim()) {
      const cur = lines[i]
      if (isBlockStart(cur)) break
      // 表格首行要留给主循环 —— 只有它才知道下一行是不是分隔行
      if (cur.trim().indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) break
      buf.push(squeezeSpaces(cur.trim()))
      i++
    }
    if (buf.length) out.push({ type: 'para', text: buf.join('\n') })
    else i++ // 兜底：理论上到不了这里，但绝不能原地打转
  }

  return out
}
