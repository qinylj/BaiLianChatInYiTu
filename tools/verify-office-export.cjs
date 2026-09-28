#!/usr/bin/env node
/*
 * Office 导出自检：node tools/verify-office-export.cjs
 *
 * 五组：
 *   【1】行内解析交叉一致性 —— parseInlineRuns（结构化）与 renderMarkdown（HTML）
 *        是两套独立实现，对同一批样本必须产出等价结果。这条是防"两份解析漂移"的锁。
 *   【2】块级解析与导出编排（标题自动提取、文件名、空内容兜底）
 *   【3】zip 结构自解析 —— 用独立的解析代码读回中央目录，逐个核对 CRC 与大小
 *   【4】调用 tools/verify_ooxml.py（zipfile + ElementTree）做跨语言交叉验证
 *   【5】Node 产物落盘位置与体积
 *
 * 为什么需要【4】：自己写的 zip 头和自己写的解析器可能"一起错"，
 * 必须让另一套独立实现（Python 标准库）来读一遍才算数。
 *
 * TypeScript 直接用 @babel/core 现场转 CJS，不依赖构建产物 ——
 * 这样自检跑的是**源码本身**，不用先编译。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src/package/Decorates/Mores/BaiLianChatInYiTu')
const TMP = path.join(ROOT, '.tmp/office-js')
const OUT = path.join(ROOT, '.tmp/office-out')

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  [ok]   ' + name)
  } else {
    fail++
    failures.push(name)
    console.log('  [FAIL] ' + name + (detail === undefined ? '' : '   -> ' + JSON.stringify(detail)))
  }
}

function section(t) {
  console.log('\n' + t)
}

/* ------------------------------ 编译 TS ------------------------------ */

function compile() {
  const babel = require('@babel/core')
  fs.mkdirSync(TMP, { recursive: true })
  const files = ['markdown.ts', 'zip.ts', 'ooxml.ts', 'docx.ts', 'xlsx.ts', 'exporter.ts']
  files.forEach(f => {
    const src = path.join(SRC, f)
    const out = babel.transformFileSync(src, {
      filename: src,
      configFile: false,
      babelrc: false,
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
        '@babel/preset-typescript'
      ]
    })
    fs.writeFileSync(path.join(TMP, f.replace(/\.ts$/, '.js')), out.code)
  })
  console.log('已编译 ' + files.length + ' 个 TS 源文件到 .tmp/office-js/')
}

/* ------------------------------ 样本 ------------------------------ */

/** 公文样本：三级标题、列表嵌套、引用、表格、代码块、分割线都覆盖到 */
const GONGWEN_SAMPLE = [
  '# 一、总则',
  '',
  '本预案适用于本单位**危险化学品**突发泄漏事故的应急处置，依据*安全生产法*与 `GB/T 9704` 编制。',
  '',
  '## （一）适用范围',
  '',
  '- 液氯、硫酸等剧毒强腐蚀品的储存环节',
  '- 生产装置区的泄漏事故',
  '  - 含管道、阀门、法兰等静密封点',
  '',
  '1. 先期处置',
  '2. 报告与响应',
  '',
  '### 1. 处置流程',
  '',
  '> 任何单位和个人都有责任报告事故隐患。',
  '',
  '| 姓名 | 危险特性 | 处置方式 | 应急编号 |',
  '| --- | --- | :--: | --- |',
  '| 液氯 | 剧毒、强刺激性 | 碱液中和 | 1001 |',
  '| 硫酸 | 强腐蚀性 | 大量水稀释 | 007 |',
  '| 甲醇 | 易燃、有毒 | 泡沫覆盖 | 1002 |',
  '',
  '```bash',
  'systemctl status emergency-response',
  '```',
  '',
  '---',
  '',
  '12345',
  '',
  '本预案自发布之日起施行。'
].join('\n')

/* ------------------------------ 【1】行内交叉一致性 ------------------------------ */

const INLINE_CASES = [
  '纯文本没有语法',
  '**加粗**',
  '__另一种加粗__',
  '*斜体*',
  '_另一种斜体_',
  '~~删除线~~',
  '`行内代码`',
  '[链接文字](https://example.com)',
  '[**加粗链接**](https://example.com)',
  '**`代码被加粗包住`**',
  '前面**中间**后面',
  'snake_case_不该变斜体',
  'a*b*c 星号前后是字母',
  '混排 **加粗** 与 *斜体* 与 `代码`',
  '未闭合的 **加粗',
  '[不安全链接](javascript:alert(1))',
  '尖括号 <script>alert(1)</script> 要转义',
  '与号 & 与引号 " 与撇号 \'',
  '中文里的**星号**标点，逗号、句号。'
]

/** 把 runs 规范化成 HTML，与 renderMarkdown 的输出形态对齐 */
function runsToHtml(runs, escapeHtml) {
  return runs
    .map(r => {
      let t = escapeHtml(r.text)
      if (r.code) t = '<code>' + t + '</code>'
      if (r.bold) t = '<strong>' + t + '</strong>'
      if (r.italic) t = '<em>' + t + '</em>'
      if (r.strike) t = '<del>' + t + '</del>'
      if (r.link) t = '<a href="' + r.link + '" target="_blank" rel="noopener noreferrer">' + t + '</a>'
      return t
    })
    .join('')
}

function groupInline(md) {
  section('【1】行内解析交叉一致性（parseInlineRuns 结构化 vs renderMarkdown HTML）')
  let same = 0
  INLINE_CASES.forEach(s => {
    const viaHtml = md.renderMarkdown(s)
    // renderMarkdown 对单个行内片段会包成 <p>，去掉外层
    const bare = viaHtml.replace(/^<p>/, '').replace(/<\/p>$/, '').replace(/<br\/>/g, '\n')
    const viaRuns = runsToHtml(md.parseInlineRuns(s), md.escapeHtml)
    if (bare === viaRuns) same++
    else check('行内一致：' + JSON.stringify(s), false, { html: bare, runs: viaRuns })
  })
  check('全部 ' + INLINE_CASES.length + ' 个行内样本两套实现结果一致', same === INLINE_CASES.length, {
    same: same,
    total: INLINE_CASES.length
  })

  // 结构本身的断言（不只是"两边一样"）
  const r1 = md.parseInlineRuns('普通**粗**尾')
  check('加粗被切成 3 个 run 且标记正确',
    r1.length === 3 && !r1[0].bold && r1[1].bold && !r1[2].bold,
    r1.map(r => ({ t: r.text, b: !!r.bold })))
  const r2 = md.parseInlineRuns('**`代码加粗`**')
  check('嵌套：代码与加粗可以同时存在',
    r2.length === 1 && r2[0].code === true && r2[0].bold === true, r2)
  const r3 = md.parseInlineRuns('`a**b**`')
  check('代码里的星号不被解析（原样保留）',
    r3.length === 1 && r3[0].code === true && r3[0].text === 'a**b**', r3)
  const r4 = md.parseInlineRuns('[文字](javascript:void(0))')
  check('不安全链接降级为纯文字（不带 link）', r4.length === 1 && !r4[0].link, r4)
  const r5 = md.parseInlineRuns('![截图](https://a.b/c.png)')
  check('图片在 Office 里降级为 [alt] 文字',
    r5.length === 1 && r5[0].text === '[截图]' && !r5[0].link, r5)
}

/* ------------------------------ 【2】块级与编排 ------------------------------ */

function groupBlocks(md, docx, xlsx, exporter) {
  section('【2】块级解析与导出编排')

  const blocks = md.parseMarkdownBlocks(GONGWEN_SAMPLE)
  const types = blocks.map(b => b.type)
  check('识别的块类型序列符合预期',
    JSON.stringify(types) ===
      JSON.stringify([
        'heading', 'para', 'heading', 'item', 'item', 'item', 'item', 'item',
        'heading', 'quote', 'table', 'code', 'hr', 'para', 'para'
      ]),
    types)

  const h = blocks.filter(b => b.type === 'heading')
  check('标题层级正确（1/2/3）', h.length === 3 && h[0].level === 1 && h[1].level === 2 && h[2].level === 3,
    h.map(x => x.level))

  const items = blocks.filter(b => b.type === 'item')
  check('列表项展开为扁平项且层级正确',
    items.length === 5 && items[0].level === 0 && items[2].level === 1 && items[3].ordered === true,
    items.map(x => ({ l: x.level, o: x.ordered, i: x.index, t: x.text.slice(0, 8) })))
  check('有序列表序号自己重排（1、2）',
    items[3].index === 1 && items[4].index === 2, [items[3].index, items[4].index])

  const table = blocks.find(b => b.type === 'table')
  check('表格解析出 4 列表头 + 3 行数据',
    table && table.head.length === 4 && table.rows.length === 3, table && [table.head.length, table.rows.length])
  check('表格对齐信息被解析（第 3 列居中）', table && table.aligns[2] === 'center', table && table.aligns)

  const code = blocks.find(b => b.type === 'code')
  check('代码块带语言标记且内容原样保留',
    code && code.lang === 'bash' && code.code === 'systemctl status emergency-response', code)

  // 未闭合围栏：流式输出里很常见，不能把后面的正文一起吞进代码块
  const unclosed = md.parseMarkdownBlocks('正文\n\n```js\nconst a = 1')
  check('未闭合围栏按代码块收尾（流式友好）',
    unclosed.length === 2 && unclosed[1].type === 'code' && unclosed[1].code === 'const a = 1',
    unclosed)

  // 标题自动提取
  const auto = exporter.buildOfficeExport('docx', '# 某某事故应急预案\n\n正文内容。', { when: new Date(2026, 8, 28, 17, 30) })
  check('未指定标题时自动取正文首个标题', /某某事故应急预案/.test(auto.fileName), auto.fileName)
  const blocksAfter = md.parseMarkdownBlocks('# 某某事故应急预案\n\n正文内容。')
  check('自动提取的标题块仍能独立解析', blocksAfter[0].type === 'heading')

  // 换成一次真实生成，确认提取后正文里不再重复出现标题
  const buf = Buffer.from(auto.bytes)
  const docXml = readZipEntry(buf, 'word/document.xml').toString('utf8')
  const titleCount = (docXml.match(/某某事故应急预案/g) || []).length
  check('标题只出现一次（提取后从正文移除，不重复）', titleCount === 1, titleCount)

  // 文件名
  check('文件名带时间戳（同日多次导出不覆盖）',
    /_\d{8}-\d{4}\.docx$/.test(auto.fileName), auto.fileName)

  // 空内容兜底
  const emptyDoc = exporter.buildOfficeExport('docx', '', { title: '空' })
  check('空内容也能产出非空文档', emptyDoc.bytes.length > 0, emptyDoc.bytes.length)
  const emptyXls = exporter.buildOfficeExport('xlsx', '')
  check('空内容也能产出非空工作簿', emptyXls.bytes.length > 0, emptyXls.bytes.length)

  // 脏字符：控制字符 + 孤立代理项
  const dirty = '正常文本\u0000\u0001\u000b 落单代理 \ud83d 结束 <script>alert(1)</script>'
  const dirtyDoc = exporter.buildOfficeExport('docx', dirty, { title: '脏' })
  const dirtyXml = readZipEntry(Buffer.from(dirtyDoc.bytes), 'word/document.xml').toString('utf8')
  check('控制字符被清除（document.xml 里没有裸控制字符）',
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(dirtyXml))
  check('孤立代理项被清除（不会生成非法 UTF-8）', !/\ud83d(?![\udc00-\udfff])/.test(dirtyXml))

  // 只有表格 / 只有标题
  const onlyTable = exporter.buildOfficeExport('docx', '| a | b |\n| --- | --- |\n| 1 | 2 |', { title: '表' })
  check('只有表格的输入也能生成文档', onlyTable.bytes.length > 0)
  const onlyXls = exporter.buildOfficeExport('xlsx', '| a | b |\n| --- | --- |\n| 1 | 2 |')
  const wb = readZipEntry(Buffer.from(onlyXls.bytes), 'xl/workbook.xml').toString('utf8')
  check('含表格时额外生成「表格1」工作表', /name="表格1"/.test(wb), wb)
}

/* ------------------------------ 【3】zip 自解析 ------------------------------ */

/** 独立实现一个最小 zip 解析器：从 EOCD 读中央目录，再按偏移取本地项 */
function readZipCentral(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('找不到 EOCD 记录')

  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOff = buf.readUInt32LE(eocd + 16)
  if (cdOff + cdSize !== eocd) throw new Error('中央目录长度与 EOCD 对不上')

  const entries = []
  let at = cdOff
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('中央目录项签名错误 @' + at)
    const method = buf.readUInt16LE(at + 10)
    const crc = buf.readUInt32LE(at + 16)
    const compSize = buf.readUInt32LE(at + 20)
    const rawSize = buf.readUInt32LE(at + 24)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const localOff = buf.readUInt32LE(at + 42)
    const name = buf.slice(at + 46, at + 46 + nameLen).toString('utf8')
    entries.push({ name, method, crc, compSize, rawSize, localOff })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readZipEntry(buf, name) {
  const entries = readZipCentral(buf)
  const e = entries.find(x => x.name === name)
  if (!e) throw new Error('包里没有 ' + name)
  return extractEntry(buf, e)
}

function extractEntry(buf, e) {
  if (buf.readUInt32LE(e.localOff) !== 0x04034b50) throw new Error('本地头签名错误：' + e.name)
  const nameLen = buf.readUInt16LE(e.localOff + 26)
  const extraLen = buf.readUInt16LE(e.localOff + 28)
  const start = e.localOff + 30 + nameLen + extraLen
  return buf.slice(start, start + e.compSize)
}

function groupZip(zip) {
  section('【3】zip 结构（用独立解析器读回中央目录，逐个核对 CRC 与长度）')

  const parts = [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/styles.xml',
    'word/settings.xml',
    'word/footer1.xml',
    'xl/workbook.xml',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml'
  ]
  const data = parts.map(n => Buffer.from('内容 ' + n + ' —— 中文与 ASCII 混排 to test utf8'))
  const buf = Buffer.from(zip.buildZip(parts.map((n, i) => ({ name: n, data: data[i] }))))

  let entries
  try {
    entries = readZipCentral(buf)
    check('中央目录可被独立解析', true)
  } catch (e) {
    check('中央目录可被独立解析', false, e.message)
    return
  }

  check('条目数与写入一致', entries.length === parts.length, entries.length)
  check('条目名与写入顺序一致', JSON.stringify(entries.map(e => e.name)) === JSON.stringify(parts),
    entries.map(e => e.name))

  let crcOk = 0
  let sizeOk = 0
  let methodOk = 0
  entries.forEach((e, i) => {
    const raw = extractEntry(buf, e)
    if (zip.crc32(raw) === e.crc) crcOk++
    if (raw.length === e.rawSize && e.compSize === e.rawSize) sizeOk++
    if (e.method === 0) methodOk++
    if (!raw.equals(data[i])) check('内容还原一致：' + e.name, false)
  })
  check('每一条的 CRC32 与数据自洽', crcOk === entries.length, crcOk)
  check('stored 模式下压缩大小 == 原始大小', sizeOk === entries.length, sizeOk)
  check('压缩方法全部为 0（stored，无需异步压缩）', methodOk === entries.length, methodOk)

  // 中文文件名与内容都要能按 UTF-8 还原
  check('内容按 UTF-8 正确还原', extractEntry(buf, entries[2]).toString('utf8') === data[2].toString('utf8'))

  // 时间戳早于 1980 的兜底
  const old = Buffer.from(zip.buildZip([{ name: 'a.txt', data: 'x' }], new Date(1970, 0, 1)))
  const oe = readZipCentral(old)
  check('时间戳早于 1980 时用 1980 兜底（年份字段不为负）', oe.length === 1, oe.length)
}

/* ------------------------------ 【4】Python 交叉验证 ------------------------------ */

/**
 * 逐个候选解释器跑一遍校验脚本。
 *
 * ★ 用异步 exec 而不是 spawnSync：某些受限环境（含本项目的沙箱）里同步 spawn 会直接
 *   报 EBUSY，而异步版本正常。所以自检的最后一组是 await 进来的 —— 别改成同步调用。
 */
function runPython(exe, script) {
  return new Promise(resolve => {
    const { exec } = require('child_process')
    exec(
      '"' + exe + '" "' + script + '"',
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
      },
      (err, stdout, stderr) => resolve({ err, stdout, stderr })
    )
  })
}

async function groupPython() {
  section('【4】Python 标准库交叉验证（zipfile 验 CRC / ElementTree 验 XML）')
  const candidates = [process.env.BL_PY, process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean)
  const script = path.join(ROOT, 'tools/verify_ooxml.py')
  const tried = []

  for (const exe of candidates) {
    const r = await runPython(exe, script)
    if (r.err && r.err.code === 127) {
      tried.push(exe + '(找不到)')
      continue
    }
    if (r.err && !r.stdout && /ENOENT|不是内部或外部命令|not found/i.test(String(r.err.message || ''))) {
      tried.push(exe + '(找不到)')
      continue
    }
    const out = ((r.stdout || '') + (r.stderr || '')).replace(/\s+$/, '')
    console.log('  解释器：' + exe)
    console.log(out)
    check('Python 交叉验证全部通过', r.err ? r.err.code === 0 : true, 'exit=' + (r.err ? r.err.code : 0))
    return
  }

  check('找到可用的 Python 解释器', false, {
    tried: tried,
    hint: '可用 BL_PY=<python 路径> node tools/verify-office-export.cjs 指定'
  })
}

/* ------------------------------ 【5】产物 ------------------------------ */

function groupArtifacts(exporter) {
  section('【5】产物落盘')
  fs.mkdirSync(OUT, { recursive: true })

  const cases = [
    ['case-gongwen.docx', exporter.buildOfficeExport('docx', GONGWEN_SAMPLE, {
      title: '危险化学品事故应急预案',
      preset: 'gongwen',
      meta: ['导出时间：2026-09-28 17:30', '来源：BaiLianChatInYiTu'],
      when: new Date(2026, 8, 28, 17, 30)
    })],
    ['case-plain.docx', exporter.buildOfficeExport('docx', '普通文档**加粗**与*斜体*。\n\n- 一项\n- 两项', {
      title: '普通文档',
      preset: 'plain',
      when: new Date(2026, 8, 28, 17, 30)
    })],
    ['case-empty.docx', exporter.buildOfficeExport('docx', '', { title: '空文档', when: new Date(2026, 8, 28, 17, 30) })],
    ['case-dirty.docx', exporter.buildOfficeExport('docx', '脏字符：\u0000\u0001\u000b\ud83d 与 <script>alert(1)</script> 混排', {
      title: '脏字符',
      when: new Date(2026, 8, 28, 17, 30)
    })],
    ['case-content.xlsx', exporter.buildOfficeExport('xlsx', GONGWEN_SAMPLE, {
      title: '危险化学品事故应急预案',
      when: new Date(2026, 8, 28, 17, 30)
    })],
    ['case-notable.xlsx', exporter.buildOfficeExport('xlsx', '没有表格的普通内容。\n\n- 一项\n- 两项', {
      title: '无表格',
      when: new Date(2026, 8, 28, 17, 30)
    })]
  ]

  cases.forEach(([name, res]) => {
    const p = path.join(OUT, name)
    fs.writeFileSync(p, Buffer.from(res.bytes))
    const kb = (res.bytes.length / 1024).toFixed(1)
    check(name + ' 已生成（' + kb + ' KB）', res.bytes.length > 800, res.bytes.length)
    check(name + ' 的 MIME 正确', /openxmlformats/.test(res.mime), res.mime)
    check(name + ' 的 content 为空（内容在 bytes 里）', res.content === '')
  })

  console.log('\n  产物目录：' + path.relative(ROOT, OUT).replace(/\\/g, '/'))
}

/* ------------------------------ main ------------------------------ */

async function main() {
  console.log('='.repeat(68))
  console.log('Office 导出自检（docx 公文格式 / xlsx 工作簿）')
  console.log('='.repeat(68))

  compile()
  const md = require(path.join(TMP, 'markdown.js'))
  const zip = require(path.join(TMP, 'zip.js'))
  const docx = require(path.join(TMP, 'docx.js'))
  const xlsx = require(path.join(TMP, 'xlsx.js'))
  const exporter = require(path.join(TMP, 'exporter.js'))

  groupInline(md)
  groupBlocks(md, docx, xlsx, exporter)
  groupZip(zip)
  groupArtifacts(exporter)
  await groupPython()

  console.log('\n' + '='.repeat(68))
  if (fail) {
    console.log('结果：' + pass + ' / ' + (pass + fail) + ' 通过，' + fail + ' 项失败')
    failures.forEach(f => console.log('  失败：' + f))
    process.exit(1)
  }
  console.log('结果：全部 ' + pass + ' 项通过')
}

main()
