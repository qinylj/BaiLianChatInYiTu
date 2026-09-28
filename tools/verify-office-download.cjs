#!/usr/bin/env node
/*
 * 真浏览器自检：点一下「导出 Word / TXT / MD」，磁盘上到底有没有出现一个能打开的文件
 *
 *   node tools/verify-office-download.cjs              # 无头（默认）
 *   CHROME_UI=1 node tools/verify-office-download.cjs  # 真实窗口
 *
 * 为什么还要这一层（前面 verify-office-export.cjs 已经验过字节的正确性了）：
 *   那条链路验的是**纯函数**——字节造得对不对。而用户按下按钮到文件落盘之间还有一段：
 *   Blob 接不接受我们那个 ArrayBuffer、<a download> 在真实浏览器里会不会真的写盘。
 *   这段只能真跑，写不出断言 —— 也算"最后一公里"，前面再对，这里断了整个功能就是废的。
 *
 * 自带静态服务的原因同 verify-copy-clipboard.cjs：webpack dev server 在本环境起不来
 * （CleanWebpackPlugin 清 dist 会被沙箱拦），所以把用到的几个 TS 模块现场编译、
 * 用迷你模块系统装进页面，再通过 http://127.0.0.1 提供 —— 不走 file://（下载行为不同）。
 *
 * 要读磁盘上落下来的文件，得让 CDP 允许下载并指定目录（Browser.setDownloadBehavior），
 * 否则无头 Chrome 默认**静默丢弃**下载，页面上看不出任何异常 —— 这正是最难查的那种失败。
 */
'use strict'

const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const babel = require('@babel/core')
const SRC = 'src/package/Decorates/Mores/BaiLianChatInYiTu'
const HTTP_PORT = Number(process.env.TEST_PORT || 8097)
const CDP_PORT = Number(process.env.CDP_PORT || 9331)
const USE_UI = process.env.CHROME_UI === '1'
const OUT_DIR = path.resolve(__dirname, '../.tmp/office-downloads')
const PY = process.env.BL_PY || 'python'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
const findBrowser = () => CHROME_CANDIDATES.find(p => p && fs.existsSync(p)) || null

/* 样本照着一份真实导出稿的样子写：模型先来一句引语再上正文标题、标题下面带副标题、
   正文里夹着 emoji 与"用空格摆版式"的写法。文件名仍取**正文首个标题**，与引语无关。 */
const SAMPLE = [
  '以下是为本单位编制的**危化品泄漏应急处置预案框架**（约1000字），可直接用于报送或存档：',
  '',
  '# 危险化学品事故应急预案',
  '',
  '（2025-2027年）',
  '',
  '本预案适用于本单位**危险化学品**突发泄漏事故的应急处置，依据“安全生产法” 与 “危化品管理条例” 编制。',
  '',
  '一、总体要求',
  '',
  '（一）指导思想',
  '',
  '应急指挥部',
  '总指挥：   企业主要负责人',
  '成员：  生产、安全、环保、医疗等部门负责人',
  '',
  '✅ 一级响应：由应急指挥部统一指挥，30 分钟内到位。',
  '',
  '1. 先期处置：现场人员立即撤离至上风向。',
  '',
  '- 液氯、硫酸等剧毒强腐蚀品的储存环节',
  '- 生产装置区的泄漏事故',
  '',
  '| 姓名 | 危险特性 | 处置方式 |',
  '| --- | --- | --- |',
  '| 液氯 | 剧毒、强刺激性 | 碱液中和 |',
  '| 硫酸 | 强腐蚀性 | 大量水稀释 |',
  '',
  '附：报送要求',
  '',
  '> **附：标杆场景**',
  '> - **先期处置**：清点应急物资，落实“一人一表”。',
  '> - **信息报送**：2 小时内报属地应急管理部门。',
  '',
  '本预案自发布之日起施行，由安全生产管理部门负责解释。'
].join('\n')

/* ---------- 1. 现场编译 TS，装进页面的迷你模块系统 ---------- */

/** 依赖顺序：被依赖的必须先 __define，因为迷你 require 是同步解析的 */
const MODULES = ['zip.ts', 'ooxml.ts', 'markdown.ts', 'docx.ts', 'download.ts', 'exporter.ts']

function compileModule(name) {
  const file = path.resolve(SRC, name)
  const res = babel.transformFileSync(file, {
    filename: file,
    configFile: false,
    babelrc: false,
    presets: [
      ['@babel/preset-env', { targets: { chrome: '90' }, modules: 'commonjs' }],
      '@babel/preset-typescript'
    ]
  })
  const key = name.replace(/\.ts$/, '')
  return `<script>__define(${JSON.stringify(key)}, function (module, exports, require) {\n${res.code}\n});</script>`
}

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>office download test</title></head>
<body>
<button id="btn-docx">导出 Word</button>
<button id="btn-txt">导出 TXT</button>
<button id="btn-md">导出 MD</button>
<script>
  var __mods = {};
  window.__define = function (name, fn) {
    var module = { exports: {} };
    fn(module, module.exports, require);
    __mods[name] = module.exports;
  };
  function require(n) {
    var k = String(n).replace(/^\\.\\//, '').replace(/\\.ts$/, '');
    if (!__mods[k]) throw new Error('模块未找到: ' + n);
    return __mods[k];
  }
</script>
${MODULES.map(compileModule).join('\n')}
<script>
  var BL = require('exporter');
  var saveFile = require('download').saveFile;
  window.SAMPLE = ${JSON.stringify(SAMPLE)};
  window.__res = { docx: null, txt: null, md: null, err: null };

  /* 与组件里 exportMessage 的核心两行一致：造字节 → 落盘 */
  window.__run = function (kind) {
    try {
      var res = BL.buildOfficeExport(window.SAMPLE, {
        preset: 'gongwen',
        meta: ['导出时间：2026-09-28 19:30'],
        when: new Date(2026, 8, 28, 19, 30)
      });
      var ok = saveFile(res.fileName, res.bytes, res.mime);
      return { ok: ok, fileName: res.fileName, size: res.bytes.length, mime: res.mime };
    } catch (e) {
      return { err: String((e && e.message) || e) };
    }
  };
  /* TXT 那条链路给的是字符串（不是字节），落盘后由浏览器按 UTF-8 编码 */
  window.__runTxt = function () {
    try {
      var res = BL.buildMessageText(window.SAMPLE, { when: new Date(2026, 8, 28, 19, 30) });
      var ok = saveFile(res.fileName, res.content, res.mime);
      return { ok: ok, fileName: res.fileName, mime: res.mime, content: res.content };
    } catch (e) {
      return { err: String((e && e.message) || e) };
    }
  };
  /* MD 那条链路也是字符串，但**一个字符都不改**（渲染前的原数据） */
  window.__runMd = function () {
    try {
      var res = BL.buildMessageMarkdown(window.SAMPLE, { when: new Date(2026, 8, 28, 19, 30) });
      var ok = saveFile(res.fileName, res.content, res.mime);
      return { ok: ok, fileName: res.fileName, mime: res.mime, content: res.content };
    } catch (e) {
      return { err: String((e && e.message) || e) };
    }
  };
  document.getElementById('btn-docx').onclick = function () { window.__res.docx = window.__run('docx'); };
  document.getElementById('btn-txt').onclick = function () { window.__res.txt = window.__runTxt(); };
  document.getElementById('btn-md').onclick = function () { window.__res.md = window.__runMd(); };
</script>
</body></html>`

/* ---------- 2. 静态服务 ---------- */
function startServer() {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(PAGE)
  })
  return new Promise(resolve => srv.listen(HTTP_PORT, '127.0.0.1', () => resolve(srv)))
}

/* ---------- 3. 极简 CDP 客户端（与工程内其它自检脚本同一套） ---------- */
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.id = 0
    this.pending = new Map()
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.onopen = () => resolve(this)
      this.ws.onerror = e => reject(new Error('WebSocket 连接失败: ' + (e && e.message)))
      this.ws.onmessage = ev => {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch (_) {
          return
        }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve: rs, reject: rj } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          msg.error ? rj(new Error(JSON.stringify(msg.error))) : rs(msg.result)
        }
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 20000)
    })
  }
  close() {
    try {
      this.ws && this.ws.close()
    } catch (_) {}
  }
}

async function waitForCdp(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch (_) {}
    await sleep(300)
  }
  throw new Error('CDP 端口未就绪，Chrome 可能启动失败')
}

/* ---------- 4. 断言工具 ---------- */
let pass = 0
const fails = []
const check = (name, cond, extra) => {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fails.push(name)
    console.log(`  ❌ ${name}${extra === undefined ? '' : `\n       ${extra}`}`)
  }
}

/* ---------- 5. 落盘文件校验 ---------- */

/** 独立的最小 zip 解析器（与 verify-office-export.cjs 同一份实现，刻意不复用文件） */
function readZipCentral(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('找不到 EOCD')
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOff = buf.readUInt32LE(eocd + 16)
  if (cdOff + cdSize !== eocd) throw new Error('中央目录长度与 EOCD 对不上')
  const out = []
  let at = cdOff
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('中央目录项签名错误')
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const localOff = buf.readUInt32LE(at + 42)
    const compSize = buf.readUInt32LE(at + 20)
    out.push({
      name: buf.slice(at + 46, at + 46 + nameLen).toString('utf8'),
      localOff,
      compSize
    })
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function readZipEntry(buf, name) {
  const entries = readZipCentral(buf)
  const e = entries.find(x => x.name === name)
  if (!e) throw new Error('包里没有 ' + name)
  const nameLen = buf.readUInt16LE(e.localOff + 26)
  const extraLen = buf.readUInt16LE(e.localOff + 28)
  const start = e.localOff + 30 + nameLen + extraLen
  return buf.slice(start, start + e.compSize)
}

/** 让 Python 标准库再独立验一遍落盘文件（不经 shell，避免中文路径被转义搞坏） */
function pythonVerify(filePath) {
  return new Promise(resolve => {
    const code =
      'import sys, zipfile, xml.etree.ElementTree as ET\n' +
      'p = sys.argv[1]\n' +
      'z = zipfile.ZipFile(p)\n' +
      'bad = z.testzip()\n' +
      'assert bad is None, "CRC 失败: %s" % bad\n' +
      'n = 0\n' +
      'for name in z.namelist():\n' +
      '    if name.endswith(".xml") or name.endswith(".rels"):\n' +
      '        ET.fromstring(z.read(name))\n' +
      '        n += 1\n' +
      'print("OK parts=%d" % n)\n'
    const p = spawn(PY, ['-c', code, filePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', d => (out += d.toString()))
    p.stderr.on('data', d => (err += d.toString()))
    p.on('error', e => resolve({ ok: false, err: e.message }))
    p.on('close', code2 => resolve({ ok: code2 === 0 && /OK parts=/.test(out), out: out.trim(), err: err.trim() }))
  })
}

/** 等下载完成：轮询目录，忽略 .crdownload 这种中间态 */
async function waitForFile(ext, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const names = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []
    const hit = names.filter(n => n.toLowerCase().endsWith(ext) && !n.endsWith('.crdownload'))
    if (hit.length) return hit[0]
    await sleep(200)
  }
  return null
}

/* ---------- 主流程 ---------- */
async function main() {
  console.log('='.repeat(68))
  console.log('导出落盘自检（真浏览器点按钮 → 磁盘上出现文件：.docx / .txt）')
  console.log('='.repeat(68))

  const browser = findBrowser()
  if (!browser) {
    console.error('❌ 未找到 Chrome / Edge，无法验证下载，跳过')
    process.exit(2)
  }
  console.log(`▶ 浏览器: ${browser}`)
  console.log(`▶ 模式: ${USE_UI ? '真实窗口' : '无头'}`)

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const srv = await startServer()
  console.log(`▶ 静态页: http://127.0.0.1:${HTTP_PORT}`)

  const userDataDir = path.join(os.tmpdir(), `bl-dl-${Date.now()}`)
  const proc = spawn(
    browser,
    [
      ...(USE_UI ? [] : ['--headless=new']),
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      `--remote-debugging-port=${CDP_PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,900',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  let browserCdp
  let pageCdp
  let ok = false
  try {
    const version = await waitForCdp()
    browserCdp = await new Cdp(version.webSocketDebuggerUrl).connect()

    // ★ 关键一步：不允许的话，无头 Chrome 会把下载静默丢掉，页面上完全看不出来
    try {
      await browserCdp.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: OUT_DIR,
        eventsEnabled: true
      })
      console.log('▶ 已允许下载，目标目录：' + path.relative(path.resolve(__dirname, '..'), OUT_DIR))
    } catch (e) {
      console.log('⚠ 设置下载行为失败：' + e.message)
    }

    const tRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
    const target = await tRes.json()
    pageCdp = await new Cdp(target.webSocketDebuggerUrl).connect()
    await pageCdp.send('Runtime.enable')
    await pageCdp.send('Page.enable')
    await pageCdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}` })
    await sleep(1800)

    const evalJs = async expression => {
      const r = await pageCdp.send('Runtime.evaluate', { expression, returnByValue: true })
      if (r.exceptionDetails) {
        const d = r.exceptionDetails
        throw new Error((d.exception && d.exception.description) || d.text || '页面异常')
      }
      return r.result && r.result.value
    }

    /** 真实鼠标点击：合成的 el.click() 不算用户手势，下载在这种场景下有被拦的风险 */
    const clickReal = async sel => {
      const box = await evalJs(
        `(function(){var b=document.querySelector(${JSON.stringify(sel)});` +
          `var r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`
      )
      for (const type of ['mousePressed', 'mouseReleased']) {
        await pageCdp.send('Input.dispatchMouseEvent', {
          type,
          x: Math.round(box.x),
          y: Math.round(box.y),
          button: 'left',
          clickCount: 1
        })
      }
    }

    const pageReady = await evalJs(
      'typeof window.__run === "function" && typeof window.__runTxt === "function" && typeof window.__runMd === "function"'
    )
    check('页面里的导出模块加载成功', pageReady === true)

    /* ---------------- A. Word ---------------- */
    console.log('\n【A】点击「导出 Word」')
    await clickReal('#btn-docx')
    await sleep(400)
    const docxRes = await evalJs('window.__res.docx')
    check('页面侧调用返回成功', docxRes && docxRes.ok === true, JSON.stringify(docxRes))
    check(
      '文件名是 .docx 且带正文首个标题与时间戳',
      docxRes && /危险化学品事故应急预案_\d{8}-\d{4}\.docx$/.test(docxRes.fileName),
      docxRes && docxRes.fileName
    )
    check('MIME 是 docx 的 OpenXML 类型', docxRes && /wordprocessingml\.document/.test(docxRes.mime), docxRes && docxRes.mime)

    const docxName = await waitForFile('.docx')
    check('磁盘上真的出现了 .docx 文件', !!docxName, `目录内容：${fs.readdirSync(OUT_DIR).join(', ') || '（空）'}`)
    if (docxName) {
      const p = path.join(OUT_DIR, docxName)
      const buf = fs.readFileSync(p)
      check('落盘文件大小与页面里生成的字节数一致（Blob 没截断）', buf.length === docxRes.size, {
        disk: buf.length,
        page: docxRes.size
      })
      let entries = null
      try {
        entries = readZipCentral(buf)
      } catch (e) {
        check('落盘文件是合法 zip（能解析中央目录）', false, e.message)
      }
      if (entries) {
        check('落盘文件是合法 zip（能解析中央目录）', true)
        const names = entries.map(e => e.name)
        check('含 word/document.xml', names.indexOf('word/document.xml') >= 0, names.slice(0, 6))
        const doc = readZipEntry(buf, 'word/document.xml').toString('utf8')
        check('正文里带公文页边距（top=1984 twips = 3.5cm / left=1446 = 2.55cm）',
          /w:top="1984"/.test(doc) && /w:left="1446"/.test(doc))
        check('正文里带固定行距 29.7 磅（w:line="594" lineRule="exact"）',
          /w:line="594" w:lineRule="exact"/.test(doc))
        check('正文与层次字体是方正字族（仿宋_GBK / 黑体_GBK / 楷体_GBK）',
          /方正仿宋_GBK/.test(doc) && /方正黑体_GBK/.test(doc) && /方正楷体_GBK/.test(doc))
        check('标题是方正小标宋_GBK 二号', /方正小标宋_GBK/.test(doc))
        check('正文里没有残留 Markdown 加粗符号', !/\*\*/.test(doc))

        /* 层次序数 → 字体：落盘产物上独立复算一遍（不依赖页面里的中间结果） */
        const paraWith = t => doc.split('<w:p>').slice(1).find(p => p.indexOf(t) >= 0) || ''
        check('第一层「一、总体要求」用方正黑体_GBK',
          /方正黑体_GBK/.test(paraWith('一、总体要求')))
        check('第二层「（一）指导思想」用方正楷体_GBK',
          /方正楷体_GBK/.test(paraWith('（一）指导思想')))

        /* 标题块：引语留在标题上面、副标题（（2025-2027年））用楷体紧排在标题下面 */
        const iLead = doc.indexOf('以下是为本单位编制的')
        /* 标题那一行的文本节点结尾 —— 引语里写的是"危化品泄漏应急处置预案框架"，不会撞上 */
        const iTitle = doc.indexOf('危险化学品事故应急预案</w:t>')
        check('模型写的引语留在标题上面（标题没被硬提到最前）',
          iLead >= 0 && iTitle >= 0 && iLead < iTitle, { iLead, iTitle })
        check('副标题「（2025-2027年）」用方正楷体_GBK 居中',
          /方正楷体_GBK/.test(paraWith('（2025-2027年）')) && /w:val="center"/.test(paraWith('（2025-2027年）')),
          paraWith('（2025-2027年）').slice(0, 120))

        /* emoji 与零散空格：都要在落盘产物里消失 */
        check('emoji 不进 Word（✅ 已清掉）', doc.indexOf('✅') < 0)
        check('emoji 清掉后剩下的文字仍在（一级响应…）',
          doc.indexOf('一级响应：由应急指挥部统一指挥') >= 0)
        check('引号旁边的空格清掉（依据“安全生产法” 与 …）',
          doc.indexOf('依据“安全生产法”与“危化品管理条例”编制。') >= 0)
        check('有序列表序号后面不留空格（1. 先期处置 → 1.先期处置）',
          doc.indexOf('1.先期处置：现场人员立即撤离至上风向。') >= 0)

        /* 多余空格：落盘产物里必须已经被清掉（只看 <w:t> 里的真实文本，不看 XML 排版） */
        const tNodes = (doc.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).map(t =>
          t.replace(/<[^>]+>/g, '')
        )
        check('用空格摆版式的短句在落盘文件里已被合并（总指挥：   企业… → 无空格）',
          doc.indexOf('总指挥：企业主要负责人') >= 0, doc.indexOf('总指挥：企业主要负责人'))
        check('正文文本里没有连续两个空格、也没有全角空格（U+3000）',
          !tNodes.some(t => /  |\u3000/.test(t)), tNodes.filter(t => /  |\u3000/.test(t)))

        /* 落盘产物上再验一次本轮修复：手动换行符换成了回车、段落仍是两端对齐。
           ★ 这里按"整段文字恰好等于"来筛 —— 早先按 /应急指挥部/ 之类的子串筛，
             样本里新加的「由应急指挥部统一指挥」会一起被捞进来，段数就对不上了。 */
        check('手动换行符换成了回车（落盘正文里 <w:br/> 数为 0）', doc.indexOf('<w:br/>') < 0)
        const paraText = p =>
          (p.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')
        const shortParas = doc
          .split('<w:p>')
          .slice(1)
          .filter(p => /^(应急指挥部|总指挥：企业主要负责人|成员：生产、安全、环保、医疗等部门负责人)$/.test(paraText(p)))
        check('落盘的三个短句各自成一段（不再是同一段里的软换行）',
          shortParas.length === 3, shortParas.length)
        check('这三段都是两端对齐（字距不会被拉开）',
          shortParas.length === 3 && shortParas.every(p => /<w:jc w:val="both"\/>/.test(p)),
          shortParas.map(p => (p.match(/<w:jc [^/]*\/>/) || ['(无)'])[0]))

        /* ★ 本轮三处：不悬挂缩进 / 列表不带项目符号 / 表后不留空行（都在落盘文件上验） */
        /* 只看 body 级段落：表格整块先挖掉，否则单元格里的 <w:p> 会混进来 */
        const noTblDoc = doc.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '')
        const bodyParaTexts = noTblDoc.split('<w:p>').slice(1).map(paraText)
        check('全篇没有悬挂缩进，也没有左缩进/右缩进（不是"文本之前"空 2 字符）',
          !/w:hangingChars=/.test(doc) && !/w:leftChars=/.test(doc) && !/w:rightChars=/.test(doc),
          (doc.match(/<w:ind[^>]*>/g) || []).slice(0, 4))
        check('无序列表不生成项目符号（`- 液氯…` 落盘后就是正文，没有「· 」也没有「- 」）',
          bodyParaTexts.indexOf('液氯、硫酸等剧毒强腐蚀品的储存环节') >= 0 &&
            !bodyParaTexts.some(t => /^\s*[·\-*+•]/.test(t)),
          bodyParaTexts.filter(t => /液氯|储存环节/.test(t)))
        check('引用块里的「- 」也被剥掉（落盘后是「先期处置：清点应急物资…」）',
          bodyParaTexts.indexOf('先期处置：清点应急物资，落实“一人一表”。') >= 0,
          bodyParaTexts.filter(t => /先期处置|信息报送/.test(t)))
        check('表格后面不留空行（表后紧跟的一段是正文，不是空段落）',
          (() => {
            const m = /<\/w:tbl>\s*(<w:p>[\s\S]*?<\/w:p>)/.exec(doc)
            return !!m && paraText(m[1]).trim().length > 0
          })(),
          (() => {
            const m = /<\/w:tbl>\s*(<w:p>[\s\S]*?<\/w:p>)/.exec(doc)
            return m ? JSON.stringify(paraText(m[1])) : '(表后没有段落)'
          })())
        check('正文段落一律"首行缩进 2 字符"（封面居中段与表格单元格除外）',
          noTblDoc.split('<w:p>').slice(1)
            .filter(p => paraText(p).trim() && !/<w:jc w:val="center"/.test(p))
            .every(p => /w:firstLineChars="200"/.test(p)),
          noTblDoc.split('<w:p>').slice(1)
            .filter(p => paraText(p).trim() && !/<w:jc w:val="center"/.test(p))
            .map(p => (p.match(/w:firstLineChars="\d+"/) || ['(无)'])[0]))
      }
      const py = await pythonVerify(p)
      check('Python zipfile 校验落盘文件通过（CRC + XML 独立验证）', py.ok, py.out || py.err)
    }

    /* ---------------- B. TXT ---------------- */
    console.log('\n【B】点击「导出 TXT」')
    await clickReal('#btn-txt')
    await sleep(400)
    const txtRes = await evalJs('window.__res.txt')
    check('页面侧调用返回成功', txtRes && txtRes.ok === true, JSON.stringify(txtRes && { err: txtRes.err }))
    check(
      '文件名是 .txt 且带正文首个标题与时间戳',
      txtRes && /危险化学品事故应急预案_\d{8}-\d{4}\.txt$/.test(txtRes.fileName),
      txtRes && txtRes.fileName
    )
    check('MIME 是 text/plain', txtRes && /^text\/plain/.test(txtRes.mime), txtRes && txtRes.mime)

    const txtName = await waitForFile('.txt')
    check('磁盘上真的出现了 .txt 文件', !!txtName, fs.readdirSync(OUT_DIR).join(', ') || '（空）')
    if (txtName) {
      const p = path.join(OUT_DIR, txtName)
      const buf = fs.readFileSync(p)
      const text = buf.toString('utf8')
      const want = txtRes && txtRes.content ? Buffer.byteLength(txtRes.content, 'utf8') : -1
      check('落盘字节数 = 页面里字符串的 UTF-8 编码长度（没被截断）', buf.length === want, {
        disk: buf.length,
        page: want
      })
      check('落盘文件开头是 UTF-8 BOM（EF BB BF）',
        buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, [buf[0], buf[1], buf[2]])
      check('换行是 CRLF（记事本能正常显示）',
        text.indexOf('\r\n') > 0 && !/[^\r]\n/.test(text),
        JSON.stringify(text.slice(0, 40)))
      check('没有残留 Markdown 语法符号与分割线横杠',
        text.indexOf('**') < 0 && text.indexOf('----------') < 0, JSON.stringify(text.slice(0, 160)))
      check('多余空格也被清掉（TXT 与 Word 同一套口径，连 nbsp 一起）',
        text.indexOf('总指挥：企业主要负责人') >= 0 && !/  /.test(text) && text.indexOf('\u00a0') < 0,
        JSON.stringify({
          hit: text.indexOf('总指挥：企业主要负责人') >= 0,
          dbl: /  /.test(text),
          nbsp: text.indexOf('\u00a0') >= 0
        }))
      check('emoji 同样不进 TXT（✅ 已清掉）', text.indexOf('✅') < 0,
        JSON.stringify((text.match(/.*一级响应.*/g) || []).slice(0, 1)))
      check('表格被拍平成可读文本（表头与单元格都在）',
        /姓名 \| 危险特性/.test(text) && /液氯/.test(text))
    }

    /* ---------------- C. MD（渲染前的原数据） ---------------- */
    console.log('\n【C】点击「导出 MD」')
    await clickReal('#btn-md')
    await sleep(400)
    const mdRes = await evalJs('window.__res.md')
    check('页面侧调用返回成功', mdRes && mdRes.ok === true, JSON.stringify(mdRes && { err: mdRes.err }))
    check(
      '文件名是 .md 且与 Word / TXT 前缀一致（同一套标题规则）',
      mdRes && /危险化学品事故应急预案_\d{8}-\d{4}\.md$/.test(mdRes.fileName),
      mdRes && mdRes.fileName
    )
    check('MIME 是 text/markdown', mdRes && /^text\/markdown/.test(mdRes.mime), mdRes && mdRes.mime)

    const mdName = await waitForFile('.md')
    check('磁盘上真的出现了 .md 文件', !!mdName, fs.readdirSync(OUT_DIR).join(', ') || '（空）')
    if (mdName) {
      const buf = fs.readFileSync(path.join(OUT_DIR, mdName))
      const want = mdRes && mdRes.content ? Buffer.byteLength(mdRes.content, 'utf8') : -1
      check('落盘字节数 = 页面里字符串的 UTF-8 编码长度（没被截断）', buf.length === want, {
        disk: buf.length,
        page: want
      })
      check('落地内容与页面里的原文逐字节相同（下载链路没做任何加工）',
        buf.toString('utf8') === mdRes.content)
      check('不带 BOM（原数据不加 BOM）',
        !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), [buf[0], buf[1], buf[2]])
      check('换行没被转成 CRLF（LF 原样保留）', buf.toString('utf8').indexOf('\r') < 0)
      check('Markdown 语法符号都还在（** 与表格分隔行）',
        buf.toString('utf8').indexOf('**危险化学品**') >= 0 &&
          buf.toString('utf8').indexOf('| --- |') >= 0)
      check('★ 多余空格原样保留（渲染**前**是原数据，绝不清理）',
        buf.toString('utf8').indexOf('总指挥：   企业主要负责人') >= 0,
        JSON.stringify((buf.toString('utf8').match(/.*总指挥.*/g) || []).slice(0, 1)))
      check('★ emoji 原样保留（原数据一个字符都不改，连图标也是）',
        buf.toString('utf8').indexOf('✅ 一级响应') >= 0,
        JSON.stringify((buf.toString('utf8').match(/.*一级响应.*/g) || []).slice(0, 1)))
    }

    /* ---------------- D. 三个文件都留下了 ---------------- */
    console.log('\n【D】目录清点')
    const all = fs.readdirSync(OUT_DIR)
    check('三个文件都在，且没有 .crdownload 残留',
      all.filter(n => /\.(docx|txt|md)$/i.test(n)).length === 3 && !all.some(n => n.endsWith('.crdownload')),
      all)

    ok = fails.length === 0
  } catch (e) {
    check('自检过程未抛异常', false, e.message)
  } finally {
    proc.kill()
    try {
      browserCdp && browserCdp.close()
    } catch (_) {}
    try {
      pageCdp && pageCdp.close()
    } catch (_) {}
    srv.close()
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch (_) {}
  }

  console.log('\n' + '='.repeat(68))
  if (ok) {
    console.log(`结果：全部 ${pass} 项通过`)
  } else {
    console.log(`结果：${pass} / ${pass + fails.length} 通过，${fails.length} 项失败`)
    fails.forEach(f => console.log('  失败：' + f))
  }
  process.exit(ok ? 0 : 1)
}

main()
