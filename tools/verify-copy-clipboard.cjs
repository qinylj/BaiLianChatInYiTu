#!/usr/bin/env node
/*
 * 真浏览器自检：复制出来的到底是"渲染后的内容"还是 Markdown 原文
 *
 *   node tools/verify-copy-clipboard.cjs              # 无头（默认）
 *   CHROME_UI=1 node tools/verify-copy-clipboard.cjs  # 真实窗口，能读回系统剪贴板
 *
 * 为什么自带一个静态服务：这条链路必须验浏览器的真实剪贴板行为
 *   （execCommand 作用在隐藏容器上是否真生效、剪贴板里有没有同时带 text/html 与 text/plain），
 *   而 webpack dev server 在本环境起不来（CleanWebpackPlugin 清 dist 会被沙箱拦），
 *   所以这里把 markdown.ts / clipboard.ts 现场编译成浏览器可跑的版本，
 *   用 http://127.0.0.1:静态端口 提供页面 —— localhost 属于安全上下文，剪贴板 API 可用。
 *
 * 两档证据（因为无头 Chrome 的剪贴板是个空桩）：
 *   无头（默认）  navigator.clipboard.read() 报 DataError，剪贴板里拿不到东西；
 *                只能验"复制的那一刻选区里是什么" —— 选区是渲染后的 HTML，
 *                才可能写出 text/html 形态（否则粘出来必然是带 ** 的源码）。
 *   CHROME_UI=1  剪贴板是真的，read() 能读回 text/html + text/plain，
 *                于是可以断言"粘出来到底长什么样"。会短暂弹出一个 Chrome 窗口。
 *
 * 两条实测结论（都踩过）：
 *   1. 不要用 copy 事件里的 e.clipboardData 做判据 —— Chromium 在 copy 事件里
 *      不会把选区数据填进去（实测 types 恒为空），那个 DataTransfer 是给处理器 setData 用的。
 *   2. 走 execCommand 富文本复制时，剪贴板里的 text/plain 是 **Chromium 自己**
 *      从选区 HTML 压出来的，不是我们传进去的 renderMarkdownToText 产物；
 *      而 test/html 会被内联计算样式（`<h2>` → `<h2 style="…">`），断言别写死 `<h2>`。
 */
'use strict'

const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

process.chdir(path.resolve(__dirname, '..'))

const babel = require('@babel/core')
const SRC = 'src/package/Decorates/Mores/BaiLianChatInYiTu'
const HTTP_PORT = Number(process.env.TEST_PORT || 8099)
const ORIGIN = `http://127.0.0.1:${HTTP_PORT}`
const CDP_PORT = Number(process.env.CDP_PORT || 9333)
const USE_UI = process.env.CHROME_UI === '1'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
const findBrowser = () => CHROME_CANDIDATES.find(p => p && fs.existsSync(p)) || null

/* ---------- 1. 编译两个模块，装进迷你模块系统 ---------- */
function compileToIife(name) {
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

const SAMPLE = [
  '## 五、保障措施',
  '',
  '物资保障：配备必要的应急器材（**MSDS/SDS手册**、专用PPE、吸附材料等）。',
  '',
  '- 培训演练：定期组织全员应急知识培训',
  '- 预案演练：每年至少 1 次',
  '',
  '| 物质 | 危害 | 处置 |',
  '| --- | --- | --- |',
  '| 液氯 | 剧毒 | 中和 |'
].join('\n')

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>copy test</title></head>
<body>
<button id="btn-rich">copy rich</button>
<button id="btn-plain">copy plain</button>
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
${compileToIife('markdown.ts')}
${compileToIife('clipboard.ts')}
<script>
  var md = require('markdown');
  var clip = require('clipboard');
  window.SAMPLE = ${JSON.stringify(SAMPLE)};
  window.__richOk = null;
  window.__plainOk = null;
  window.__err = null;
  window.__selHtml = '';
  window.__selText = '';
  /* 记录"复制那一刻的选区" —— 无头模式下这是唯一能拿到的证据 */
  document.addEventListener('copy', function () {
    try {
      var sel = window.getSelection();
      window.__selText = sel ? String(sel) : '';
      window.__selHtml = '';
      if (sel && sel.rangeCount) {
        var div = document.createElement('div');
        div.appendChild(sel.getRangeAt(0).cloneContents());
        window.__selHtml = div.innerHTML;
      }
    } catch (e) { window.__err = 'copy-listener: ' + String(e); }
  }, true);
  document.getElementById('btn-rich').onclick = function () {
    try {
      var raw = window.SAMPLE;
      clip.copyMessageText(md.renderMarkdown(raw), md.renderMarkdownToText(raw)).then(function (ok) {
        window.__richOk = ok;
      }, function (e) { window.__err = String(e && e.message || e); });
    } catch (e) { window.__err = String(e && e.message || e); }
  };
  document.getElementById('btn-plain').onclick = function () {
    try { window.__plainOk = clip.copyPlainText('第一行\\n第二行'); } catch (e) { window.__err = String(e); }
  };
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

/* ---------- 4. 断言小工具 ---------- */
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

/* ---------- 主流程 ---------- */
async function main() {
  const browser = findBrowser()
  if (!browser) {
    console.error('❌ 未找到 Chrome / Edge，跳过浏览器自检')
    process.exit(2)
  }
  console.log(`▶ 浏览器: ${browser}`)
  console.log(`▶ 模式: ${USE_UI ? '真实窗口（剪贴板可读回）' : '无头（剪贴板为空桩，只验选区）'}`)

  const srv = await startServer()
  console.log(`▶ 静态页: ${ORIGIN}`)

  const userDataDir = path.join(os.tmpdir(), `bl-copy-${Date.now()}`)
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
  try {
    const version = await waitForCdp()
    browserCdp = await new Cdp(version.webSocketDebuggerUrl).connect()
    try {
      await browserCdp.send('Browser.grantPermissions', {
        origin: ORIGIN,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
      })
      console.log('▶ 已授予剪贴板读写权限')
    } catch (e) {
      console.log(`⚠ 授予剪贴板权限失败（继续）：${e.message}`)
    }

    const tRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
    const target = await tRes.json()
    pageCdp = await new Cdp(target.webSocketDebuggerUrl).connect()
    await pageCdp.send('Runtime.enable')
    await pageCdp.send('Page.enable')
    await pageCdp.send('Page.navigate', { url: ORIGIN })
    await sleep(1500)

    const evalJs = async (expression, awaitPromise = false) => {
      const r = await pageCdp.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true
      })
      if (r.exceptionDetails) {
        const d = r.exceptionDetails
        throw new Error((d.exception && d.exception.description) || d.text || '页面执行异常')
      }
      return r.result && r.result.value
    }

    /** 真实鼠标点击（合成 click 不算用户手势，execCommand 会直接失败） */
    const clickReal = async sel => {
      const rect = await evalJs(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`)
      await pageCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
      await pageCdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1
      })
      await pageCdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1
      })
    }

    const readClipboard = () =>
      evalJs(
        `(async () => {
          const items = await navigator.clipboard.read();
          const out = { types: [], html: '', text: '' };
          for (const it of items) {
            for (const t of it.types) {
              out.types.push(t);
              if (t === 'text/html') out.html = await (await it.getType(t)).text();
              if (t === 'text/plain') out.text = await (await it.getType(t)).text();
            }
          }
          return out;
        })()`,
        true
      )

    /** 读剪贴板：必须在"复制之后"试 —— 空剪贴板本身就会抛 DataError，
     *  拿它当"能不能读"的探针会把真实窗口误判成无头。 */
    const tryReadClipboard = async () => {
      try {
        await pageCdp.send('Page.bringToFront')
      } catch (_) {}
      try {
        return { ok: true, data: await readClipboard() }
      } catch (e) {
        return { ok: false, err: e.message }
      }
    }

    /* ---------------- A. 富文本复制 ---------------- */
    console.log('\n【A】富文本复制（copyMessageText）')
    await clickReal('#btn-rich')
    await sleep(600)
    const pageErr = await evalJs('window.__err')
    check('页面里没有异常', !pageErr, String(pageErr))
    check('真实点击后返回成功', (await evalJs('window.__richOk')) === true)
    const selHtml = (await evalJs('window.__selHtml')) || ''
    const selText = (await evalJs('window.__selText')) || ''

    const rich = await tryReadClipboard()
    const canReadClipboard = rich.ok && !!rich.data && rich.data.types.length > 0
    if (!canReadClipboard) {
      console.log(
        '▶ 剪贴板读不回来（无头模式没有系统剪贴板后端）→ 退化为"选区内容"校验' +
          '\n  要看真实剪贴板请用：CHROME_UI=1 node tools/verify-copy-clipboard.cjs'
      )
    }

    /* ---------------- B. 复制那一刻的选区 ---------------- */
    console.log('\n【B】复制时的选区内容')
    const html = (canReadClipboard && rich.data.html) || selHtml
    check('选区里有 <strong>（加粗真的生效）', html.indexOf('<strong>MSDS/SDS手册</strong>') >= 0, html.slice(0, 200))
    check('选区里有 <table>（表格是真表格）', html.indexOf('<table') >= 0, html.slice(0, 200))
    /* 标题必须带标签名匹配：Chromium 写剪贴板时会把自己的计算样式内联进去，
       `<h2>` 会变成 `<h2 style="font-size:1.5em;…">`，写成 `<h2>五、保障措施</h2>` 会误判 */
    check('选区里有 h2 标题', /<h2[^>]*>五、保障措施<\/h2>/.test(html), html.slice(0, 200))
    check('选区里不含 Markdown 语法', html.indexOf('**MSDS') < 0)
    check('选区里不含表格分隔行源码', html.indexOf('| ---') < 0)
    if (selText) {
      check('选区纯文本里没有 **', selText.indexOf('**') < 0, JSON.stringify(selText.slice(0, 120)))
    }

    /* ---------------- C. 剪贴板真实载荷（仅真实窗口） ---------------- */
    if (canReadClipboard) {
      const clip = rich.data
      console.log('\n【C】剪贴板真实载荷')
      console.log(`      类型：${JSON.stringify(clip.types)}`)
      check('含 text/html', clip.types.indexOf('text/html') >= 0)
      check('含 text/plain', clip.types.indexOf('text/plain') >= 0)
      check('html 是渲染后的标签', clip.html.indexOf('<strong>MSDS/SDS手册</strong>') >= 0, clip.html.slice(0, 200))
      check('html 里没有 Markdown 语法', clip.html.indexOf('**MSDS') < 0)

      /* ★ 实测结论：走 execCommand 富文本复制时，text/plain 那一片是 **Chromium 自己
         从选区 HTML 压出来的**，不是我们传进去的 renderMarkdownToText 结果。
         所以这里的约定是浏览器的：列表符号会丢、表格单元格之间是制表符（粘到 Excel 正好分列）。
         我们那份纯文本渲染只在两种场合生效：execCommand 失败的兜底、以及 .txt 导出
         （那两种场合由 tools/verify-export-text.cjs 断言，保留 `- ` 前缀与 ` | ` 分隔）。 */
      const plain = clip.text
      check('plain 不含 **（语法符号已剥掉）', plain.indexOf('**') < 0, JSON.stringify(plain.slice(0, 200)))
      check('plain 不含表格分隔行', plain.indexOf('| ---') < 0)
      check('plain 不含标题井号', plain.indexOf('##') < 0)
      check('plain 保留了正文', plain.indexOf('物资保障') >= 0)
      check('plain 保留了列表项文字', plain.indexOf('培训演练') >= 0 && plain.indexOf('预案演练') >= 0)
      check('plain 保留了表格内容', plain.indexOf('液氯') >= 0 && plain.indexOf('剧毒') >= 0 && plain.indexOf('中和') >= 0)
      console.log('      —— 粘成纯文本时长这样（浏览器压出来的） ——')
      console.log(
        plain
          .split('\n')
          .map(l => '      | ' + l)
          .join('\n')
      )
    } else {
      console.log('\n【C】剪贴板真实载荷 —— 跳过（无头模式剪贴板为空桩）')
      if (!rich.ok) console.log(`      读取失败原因：${String(rich.err).slice(0, 90)}`)
    }

    /* ---------------- D. 纯文本兜底 ---------------- */
    console.log('\n【D】纯文本兜底（copyPlainText）')
    await clickReal('#btn-plain')
    await sleep(500)
    check('返回成功', (await evalJs('window.__plainOk')) === true)
    if (canReadClipboard) {
      const again = await tryReadClipboard()
      check('内容与换行一致', again.ok && /^第一行\r?\n第二行$/.test(again.data.text), JSON.stringify(again.data && again.data.text))
    } else {
      console.log('      ⏭ 无头模式读不回内容，跳过')
    }
  } finally {
    try {
      pageCdp && pageCdp.close()
      browserCdp && browserCdp.close()
    } catch (_) {}
    try {
      proc.kill()
    } catch (_) {}
    try {
      srv.close()
    } catch (_) {}
    await sleep(300)
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch (_) {}
  }

  console.log(`\n共 ${pass + fails.length} 项，通过 ${pass} 项，失败 ${fails.length} 项`)
  if (fails.length) {
    console.log('失败项：\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
}

main().catch(e => {
  console.error(`\n❌ 自检异常：${e.message}`)
  process.exit(1)
})
