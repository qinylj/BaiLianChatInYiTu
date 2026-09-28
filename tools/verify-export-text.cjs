#!/usr/bin/env node
/*
 * 静态自检：复制/导出用的"渲染后文本"
 *
 *   node tools/verify-export-text.cjs
 *
 * 为什么不用 CDP：markdown.ts / exporter.ts 都是纯函数（不碰 DOM），
 * 用 babel 现场转成 CJS 直接在 Node 里断言更快、更稳，也方便回归。
 * 复制那条链路的 DOM 侧行为另由 tools/verify-copy-clipboard.cjs 在真浏览器里验。
 *
 * 断言三件事：
 *   1) renderMarkdownToText —— 语法符号必须被剥掉，阅读结构（列表层级/表格/代码）必须保留；
 *   2) buildExport 的 html / txt / md 三种形态 —— 内容来源正确、该转义的转义；
 *   3) 与 renderMarkdown 的一致性 —— 同一段内容，"看到的结构"与"导出的结构"对得上。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

process.chdir(path.resolve(__dirname, '..'))

const babel = require('@babel/core')
const SRC = 'src/package/Decorates/Mores/BaiLianChatInYiTu'
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-verify-'))

/* ---------- 把 .ts 转成 Node 能 require 的 CJS ---------- */
const compile = name => {
  const file = path.resolve(SRC, name)
  const res = babel.transformFileSync(file, {
    filename: file,
    configFile: false,
    babelrc: false,
    presets: [
      ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
      '@babel/preset-typescript'
    ]
  })
  const dest = path.join(OUT, name.replace(/\.ts$/, '.js'))
  fs.writeFileSync(dest, res.code, 'utf8')
  return dest
}

/* exporter.ts 还会 import docx.ts（导出 Word 那条链路要用），
   Node 解析 import 时要求模块必须存在，所以整条依赖链都要编译出来。 */
;['markdown.ts', 'types.ts', 'zip.ts', 'ooxml.ts', 'docx.ts', 'exporter.ts'].forEach(compile)
const md = require(path.join(OUT, 'markdown.js'))
const ex = require(path.join(OUT, 'exporter.js'))

/* ---------- 断言小工具 ---------- */
let pass = 0
const fails = []
const check = (name, cond, extra) => {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fails.push(name)
    console.log(`  ❌ ${name}${extra ? `\n       ${extra}` : ''}`)
  }
}
const has = (s, sub, name) => check(name, String(s).indexOf(sub) >= 0, `未找到 ${JSON.stringify(sub)}\n      实际：${JSON.stringify(String(s).slice(0, 200))}`)
const hasNot = (s, sub, name) =>
  check(name, String(s).indexOf(sub) < 0, `不该出现 ${JSON.stringify(sub)}\n      实际：${JSON.stringify(String(s).slice(0, 200))}`)

/* ================================================================== *
 * 语料一：贴近真实的一份模型回答（含标题/加粗/列表/表格/代码）
 * ================================================================== */
const SAMPLE = [
  '## 五、保障措施',
  '',
  '物资保障：配备必要的应急器材（**MSDS/SDS手册**、专用PPE、吸附材料等），定期检查维护。',
  '',
  '- 培训演练：定期组织全员应急知识培训（含 MSDS/SDS 解读）',
  '- 预案演练：每年至少 1 次',
  '  - 专项演练：危化品泄漏 / 中毒 / 火灾',
  '  - 综合演练：跨部门联动',
  '- 信息管理：确保现场所有危化品有清晰的标签',
  '',
  '1. 立即报警',
  '2. 划定隔离区',
  '3. 向上级报告',
  '',
  '> 核心：MSDS/SDS 是处置的核心依据。',
  '',
  '| 物质 | 危害 | 处置 |',
  '| --- | --- | --- |',
  '| 液氯 | 剧毒 | 中和 |',
  '| 甲醇 | 易燃 | 泡沫 |',
  '',
  '```bash',
  'export PPE=level-a   # 代码里的 ** 不是加粗',
  'echo $PPE',
  '```',
  '',
  '详见 [应急预案](https://example.gov.cn/plan.pdf) 与 `定值` 说明。',
  '',
  '![](https://example.gov.cn/a.png)',
  '',
  '---',
  '',
  '本办法自发布之日起实施。'
].join('\n')

console.log('\n【1】renderMarkdownToText —— 剥符号、留结构')
const text = md.renderMarkdownToText(SAMPLE)
check('标题去掉 #', !/^#/m.test(text), `实际：${JSON.stringify(text.split('\n')[0])}`)
has(text, '五、保障措施', '标题文字保留')
/* 注意：样本的代码块里故意留了一处 `**`，那是代码内容，按约定必须原样保留。
   所以这里查两件事：正文里的强调符号被剥掉、代码块里的没被剥掉。 */
has(text, '（MSDS/SDS手册、', '加粗符号已剥掉')
hasNot(text, '**MSDS/SDS手册**', '正文里没有残留 **')
has(text, '代码里的 ** 不是加粗', '代码块里的 ** 原样保留（不做行内剥离）')
hasNot(text, '##', '没有残留 ##')
hasNot(text, '| --- |', '表格分隔行已去掉')
has(text, '液氯 | 剧毒 | 中和', '表格单元格用 | 连接')
has(text, '\n- 培训演练', '无序列表保留 -')
has(text, '\n  - 专项演练', '嵌套项缩进两格')
has(text, '\n1. 立即报警', '有序列表保留序号')
has(text, '\n2. 划定隔离区', '有序列表序号递进')
has(text, '核心：MSDS/SDS', '引用文字保留')
hasNot(text, '\n> ', '引用符号已去掉')
hasNot(text, '----------', '分割线不再输出横杠（只留空行）')
hasNot(text, '---', '分割线整行都不残留')
has(text, 'export PPE=level-a', '代码块内容保留')
has(text, '代码里的 ** 不是加粗', '代码块里不做行内剥离')
hasNot(text, '```', '代码围栏已去掉')
has(text, '应急预案（https://example.gov.cn/plan.pdf）', '链接带出地址')
has(text, '定值', '行内代码去掉反引号')
has(text, '[图片]', '图片转占位')
check('末尾无多余空行', !/\n+$/.test(text))

console.log('\n【2】与 renderMarkdown 的结构一致性')
const html = md.renderMarkdown(SAMPLE)
check('HTML 有 h2', html.indexOf('<h2>五、保障措施</h2>') >= 0)
check('HTML 有嵌套 ul', (html.match(/<ul>/g) || []).length >= 2)
check('HTML 有 table', html.indexOf('<table>') >= 0)
check('HTML 有 pre', html.indexOf('<pre class="ac-pre">') >= 0)
check(
  '列表项数量两边一致',
  (html.match(/<li>/g) || []).length === (text.match(/^\s*(-|\d+\.) /gm) || []).length,
  `html=${(html.match(/<li>/g) || []).length} text=${(text.match(/^\s*(-|\d+\.) /gm) || []).length}`
)
check(
  '表格行数两边一致',
  (html.match(/<tr>/g) || []).length === (text.match(/^.* \| .*$/gm) || []).length,
  `html=${(html.match(/<tr>/g) || []).length} text=${(text.match(/^.* \| .*$/gm) || []).length}`
)

console.log('\n【3】流式半截内容不崩、不留脏符号')
const half = md.renderMarkdownToText('### 标题\n\n- 第一项\n- 第二项\n\n```js\nconst a = 1')
hasNot(half, '###', '半截内容里的 # 也被去掉')
has(half, 'const a = 1', '未闭合代码块内容保留')
hasNot(half, '```', '未闭合围栏不吐出 ```')
check('未闭合强调保持字面量', md.renderMarkdownToText('这是 **半截').indexOf('**半截') >= 0)
check('空输入安全', md.renderMarkdownToText('').trim() === '' && md.renderMarkdownToText(null).trim() === '')

/* ================================================================== *
 * 【4】三种导出形态
 * ================================================================== */
const conv = {
  id: 'c1',
  title: '危化品/泄漏 处置<预案>', // 故意带非法文件名字符与尖括号
  targetKind: 'model',
  targetId: 'm1',
  targetName: 'DeepSeek',
  sessionId: '',
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: 'u1', role: 'user', content: '给我一份预案\n要专业', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: SAMPLE, timestamp: 2 },
    { id: 'u2', role: 'user', content: '谢谢', timestamp: 3, attachments: [{ id: 'f1', name: '标准.pdf', size: 10 }] }
  ]
}

console.log('\n【4】buildExport —— 默认 html')
const eHtml = ex.buildExport(conv, 'html', '2026/9/28 17:00:00')
check('扩展名 html', /\.html$/.test(eHtml.fileName), eHtml.fileName)
check('mime 是 text/html', /text\/html/.test(eHtml.mime))
check('文件名里的 / 与 < 被净化', eHtml.fileName.indexOf('/') < 0 && eHtml.fileName.indexOf('<') < 0, eHtml.fileName)
has(eHtml.content, '<!DOCTYPE html>', '是完整 HTML 文档')
has(eHtml.content, '<h2>五、保障措施</h2>', '正文按渲染后的标签输出（不是 Markdown 源码）')
has(eHtml.content, '<table>', '表格是真表格')
has(eHtml.content, '<strong>MSDS/SDS手册</strong>', '加粗是真加粗')
hasNot(eHtml.content, '**MSDS/SDS手册**', 'HTML 里没有 Markdown 语法')
has(eHtml.content, '要专业', '用户消息带上了')
has(eHtml.content, '<br/>', '用户消息的换行变成 br')
has(eHtml.content, '附件：标准.pdf', '附件名带上')
has(eHtml.content, '<title>DeepSeek</title>', '标题进了 head')

console.log('\n【5】buildExport —— txt')
const eTxt = ex.buildExport(conv, 'txt', '2026/9/28 17:00:00')
check('扩展名 txt', /\.txt$/.test(eTxt.fileName))
check('带 BOM（记事本不糊中文）', eTxt.content.charCodeAt(0) === 0xfeff)
check('用 CRLF 换行', eTxt.content.indexOf('\r\n') > 0)
check('不出现半 LF 半 CRLF', !/[^\r]\n/.test(eTxt.content))
has(eTxt.content, '【我】', '有说话人标记')
has(eTxt.content, '【DeepSeek】', 'AI 用对话对象名')
hasNot(eTxt.content, '**MSDS/SDS手册**', 'txt 里正文没有 Markdown 语法')
hasNot(eTxt.content, '# 五', 'txt 里没有标题井号')
has(eTxt.content, '液氯 | 剧毒 | 中和', '表格按行输出')

console.log('\n【6】buildExport —— md 与兜底')
const eMd = ex.buildExport(conv, 'md', '2026/9/28 17:00:00')
check('扩展名 md', /\.md$/.test(eMd.fileName))
has(eMd.content, '**我：**', 'md 保留原始语法')
has(eMd.content, '**MSDS/SDS手册**', 'md 是源码原文')
check('未知格式回退 html', /\.html$/.test(ex.buildExport(conv, 'weird', 'x').fileName))
check('format 为空回退 html', /\.html$/.test(ex.buildExport(conv, '', 'x').fileName))

console.log('\n【7】安全：注入内容不得变成标签')
const evil = {
  ...conv,
  title: '<script>alert(1)</script>',
  messages: [{ id: 'u', role: 'user', content: '<img src=x onerror=alert(1)>', timestamp: 1 }]
}
const evilHtml = ex.buildExport(evil, 'html', 'x').content
hasNot(evilHtml, '<script>alert(1)</script>', '标题里的 script 被转义')
hasNot(evilHtml, '<img src=x onerror', '用户消息里的 img 被转义')
has(evilHtml, '&lt;img src=x onerror', '转义成了实体')
const evilTxt = ex.buildExport(evil, 'txt', 'x').content
check('用户消息里的 HTML 在 txt 里原样保留（纯文本不解析）', evilTxt.indexOf('<img src=x onerror=alert(1)>') > 0)

console.log('\n【8】buildMessageText —— 单条回答导出 TXT（脚注第二个按钮）')
const mt = ex.buildMessageText(SAMPLE, { when: new Date(2026, 8, 28, 17, 30) })
check('文件名 = 正文首个标题 + 时间戳', /^五、保障措施_\d{8}-\d{4}\.txt$/.test(mt.fileName), mt.fileName)
check('mime 是 text/plain', /^text\/plain/.test(mt.mime), mt.mime)
check('是字符串形态（没有 bytes）', !mt.bytes)
check('带 BOM', mt.content.charCodeAt(0) === 0xfeff)
check('全部 CRLF 换行', !/[^\r]\n/.test(mt.content))
hasNot(mt.content, '**MSDS/SDS手册**', '正文里没有 Markdown 语法')
hasNot(mt.content, '----------', '没有分割线横杠')
hasNot(mt.content, '| --- |', '没有表格分隔行')
has(mt.content, '本办法自发布之日起实施。', '正文结尾完整保留')
check('标题兜底：没有标题时取首段前 24 字',
  ex.pickDocTitle('甲'.repeat(40)) === '甲'.repeat(24), ex.pickDocTitle('甲'.repeat(40)))
check('标题兜底：空内容给「文档」', ex.pickDocTitle('') === '文档')

/* ---------- 汇总 ---------- */
try {
  fs.rmSync(OUT, { recursive: true, force: true })
} catch (e) {
  /* 临时目录清理失败无所谓 */
}

console.log(`\n共 ${pass + fails.length} 项，通过 ${pass} 项，失败 ${fails.length} 项`)
if (fails.length) {
  console.log('失败项：\n  - ' + fails.join('\n  - '))
  process.exit(1)
}
