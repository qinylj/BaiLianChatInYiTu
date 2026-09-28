#!/usr/bin/env node
/*
 * 真浏览器自检：点一下「导出 Word / TXT」，磁盘上到底有没有出现一个能打开的文件
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

const SAMPLE = [
  '# 危险化学品事故应急预案',
  '',
  '本预案适用于本单位**危险化学品**突发泄漏事故的应急处置。',
  '',
  '- 液氯、硫酸等剧毒强腐蚀品的储存环节',
  '- 生产装置区的泄漏事故',
  '',
  '| 姓名 | 危险特性 | 处置方式 |',
  '| --- | --- | --- |',
  '| 液氯 | 剧毒、强刺激性 | 碱液中和 |',
  '| 硫酸 | 强腐蚀性 | 大量水稀释 |'
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
  window.__res = { docx: null, txt: null, err: null };

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
  document.getElementById('btn-docx').onclick = function () { window.__res.docx = window.__run('docx'); };
  document.getElementById('btn-txt').onclick = function () { window.__res.txt = window.__runTxt(); };
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

    const pageReady = await evalJs('typeof window.__run === "function" && typeof window.__runTxt === "function"')
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
        check('正文里带公文页边距（top=2098 twips = 37mm）', /w:top="2098"/.test(doc))
        check('正文里带三号仿宋_GB2312', /仿宋_GB2312/.test(doc))
        check('正文里带二号小标宋标题', /方正小标宋简体/.test(doc))
        check('正文里没有残留 Markdown 加粗符号', !/\*\*/.test(doc))
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
      check('表格被拍平成可读文本（表头与单元格都在）',
        /姓名 \| 危险特性/.test(text) && /液氯/.test(text))
    }

    /* ---------------- C. 两个文件都留下了 ---------------- */
    console.log('\n【C】目录清点')
    const all = fs.readdirSync(OUT_DIR)
    check('两个文件都在，且没有 .crdownload 残留',
      all.filter(n => /\.(docx|txt)$/i.test(n)).length === 2 && !all.some(n => n.endsWith('.crdownload')),
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
