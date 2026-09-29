/**
 * 「显示思考过程 / 流式输出」按对话对象配置（不再放在「对话设置」组）
 *
 *  用户要求：把这两个开关从「对话设置」组挪走 ——
 *    大模型 → 「模型配置」组，放在「系统提示词」框下面
 *    智能体 → 「智能体配置」组，放在「智能体超时(ms)」下面
 *
 *  本脚本验三件事：
 *    ① 位置对：两个开关出现在指定的子组、且在指定字段之后
 *    ② 挪走了：「对话设置」组里不再有这两个开关
 *    ③ 真的生效：关掉某个大模型的「显示思考过程」→ 预览里那条带思考过程的消息
 *       就不再显示思考块；再打开又出来（端到端，不是只看 DOM 结构）
 *
 * 用法：node tools/cdp-verify-per-target-toggles.cjs   （需要 dev server 在 8085）
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
]
const URL_TO_OPEN = 'http://127.0.0.1:8085/settings'
const OUT_DIR = path.resolve(__dirname, '../.cdp-shots')
const PORT = Number(process.env.CDP_PORT || 9583)
const sleep = ms => new Promise(r => setTimeout(r, ms))
function findBrowser() {
  for (const p of CHROME_CANDIDATES) { try { if (p && fs.existsSync(p)) return p } catch (_) {} }
  return null
}

const HELPERS = `
  const vis = e => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const norm = s => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  /* 某个「子组」（.sub2，标题在 .sub2-head）里，文本等于 label 的那个字段块 */
  const fieldBox = (sub2, label) => {
    const hit = [...sub2.querySelectorAll('.field-label, .field, .n-form-item, .label, span, div')]
      .filter(vis)
      .filter(e => norm(e.textContent) === label);
    if (!hit.length) return null;
    // 取"最内层"的那个（最后一个），避免拿到整个面板容器
    const el = hit[hit.length - 1];
    const r = el.getBoundingClientRect();
    return { top: r.top, text: norm(el.textContent) };
  };
  /* 文本等于 label 的开关（CustomSwitch）：先找 label 元素，再在它附近找 .n-switch。
     ★ scroll=true 时才 scrollIntoView —— 面板很长，开关常常在视口外（y>1000），
       不滚动就用视口坐标去点，鼠标事件落在空白处，点击"成功"但开关纹丝不动。
       取位置做比较时不要滚（滚动会改变坐标系，前后两次取的 top 没法比）。 */
  const switchBox = (scope, label, scroll) => {
    const labels = [...scope.querySelectorAll('*')].filter(vis)
      .filter(e => norm(e.textContent) === label && e.children.length === 0);
    for (const el of labels) {
      // 从 label 往上找最多 6 层，取层内第一个可见的 .n-switch
      let p = el;
      for (let i = 0; i < 6 && p; i++) {
        const sw = p.querySelector ? p.querySelector('.n-switch') : null;
        if (sw && vis(sw)) {
          if (scroll) sw.scrollIntoView({ block: 'center' });
          const r = sw.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, checked: /n-switch--active/.test(sw.className) };
        }
        p = p.parentElement;
      }
    }
    return null;
  };
  const sub2By = title => {
    const subs = [...document.querySelectorAll('.sub2')].filter(vis);
    return subs.find(s => {
      const h = s.querySelector('.sub2-head');
      return h && norm(h.textContent).indexOf(title) === 0;
    }) || null;
  };
  const grpBy = title => {
    const gs = [...document.querySelectorAll('.grp')].filter(vis);
    return gs.find(g => {
      const h = g.querySelector('.grp-title');
      return h && norm(h.textContent) === title;
    }) || null;
  };
  const thoughtCount = () => [...document.querySelectorAll('.bailian-chat-in-yitu .ac-thought')].filter(vis).length;
`

/** 播种：一条属于 Deepseek 的会话，assistant 消息带思考过程 */
const seedExpr = `(async () => {
  const newId = 'seed' + Date.now().toString(36);
  const key = 'bailian-chat-in-yitu:' + newId;
  try { localStorage.setItem('dbg:BaiLianChatInYiTu:instance-id', newId) } catch (e) {}
  const now = Date.now();
  localStorage.setItem(key, JSON.stringify([{
    id: 'c-thought', title: '带思考的会话', targetKind: 'model', targetId: 'model-deepseek',
    targetName: 'Deepseek', sessionId: '', createdAt: now - 1000, updatedAt: now,
    messages: [
      { id: 'm1', role: 'user', content: '问题', thought: '', timestamp: now - 1000, pending: false },
      { id: 'm2', role: 'assistant', content: '正文回答', thought: '这是思考过程内容XYZ', timestamp: now, pending: false }
    ]
  }]));
  return { ok: true, key };
})()`

class Cdp {
  constructor(ws) { this.ws = ws; this.mid = 0; this.pend = new Map(); this.errors = []
    this.ws.onmessage = e => {
      const d = JSON.parse(e.data)
      if (d.method === 'Runtime.exceptionThrown') {
        const ex = d.params.exceptionDetails
        const st = ex.exception && ex.exception.description ? String(ex.exception.description) : ''
        this.errors.push({ text: `${ex.text} ${st.slice(0, 300)}`, url: ex.url || '', line: ex.lineNumber })
      }
      if (d.id && this.pend.has(d.id)) {
        const p = this.pend.get(d.id); this.pend.delete(d.id)
        d.error ? p.rej(new Error(d.error.message)) : p.res(d.result)
      }
    }
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    return new Cdp(ws)
  }
  send(m, p) { return new Promise((res, rej) => { const id = ++this.mid; this.pend.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method: m, params: p || {} })) }) }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''))
    return r.result.value
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
  }
  async clickAt(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  async clickSel(sel, nth = 0) {
    const pos = await this.eval(`(() => {
      const es = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const e = es[${nth}]; if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!pos) return false
    await this.clickAt(pos.x, pos.y)
    return true
  }
}

const marks = []
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' —— ' + detail : ''}`)
}

/** 切到某个 tab（基础 / 智能体 / 大模型） */
async function gotoTab(cdp, name) {
  const ok = await cdp.eval(`(() => {
    ${HELPERS}
    const tabs = [...document.querySelectorAll('.n-tabs-tab')].filter(vis);
    const t = tabs.find(x => norm(x.textContent) === ${JSON.stringify(name)});
    if (!t) return false;
    t.scrollIntoView({ block: 'center' }); t.click();
    return true;
  })()`)
  await sleep(700)
  return ok
}

/** 展开某个 L1 分组（.grp-title 文本完全匹配） */
async function openGrp(cdp, title) {
  return cdp.eval(`(() => {
    ${HELPERS}
    const g = grpBy(${JSON.stringify(title)});
    if (!g) return { found: false };
    const body = g.querySelector('.grp-body');
    if (!body || !vis(body)) { const h = g.querySelector('.grp-head'); if (h) h.click(); }
    return { found: true };
  })()`)
}

async function main() {
  const exe = findBrowser()
  if (!exe) throw new Error('找不到 Chrome/Edge')
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const proc = spawn(exe, [`--remote-debugging-port=${PORT}`, '--headless=new', '--window-size=1600,1000',
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let cdp
  try {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break } catch (_) {} await sleep(300) }
    const tRes = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
    const target = await tRes.json()
    cdp = await Cdp.connect(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
    await cdp.send('Page.navigate', { url: URL_TO_OPEN })
    await sleep(9000)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    marks.push(['init', cdp.errors.length])

    /* 播种带思考过程的会话并重载 */
    await cdp.eval(seedExpr)
    await cdp.send('Page.reload')
    await sleep(9000)

    const n0 = await cdp.eval(`(() => { ${HELPERS} return thoughtCount(); })()`)
    marks.push(['afterSeed', cdp.errors.length])
    check('① 播种生效：预览里出现 1 个思考过程块（默认开）', n0 === 1, `思考块数=${n0}`)
    await cdp.shot(path.join(OUT_DIR, 'TOGGLE-0-初始显示思考.png'))

    /* ---------- ② 「对话设置」组里不该再有这两个开关 ---------- */
    await gotoTab(cdp, '基础')
    const sess = await cdp.eval(`(() => {
      ${HELPERS}
      const g = grpBy('对话设置');
      if (!g) return { found: false };
      const h = g.querySelector('.grp-head'); if (h) h.click();
      return { found: true };
    })()`)
    await sleep(600)
    const sessHas = await cdp.eval(`(() => {
      ${HELPERS}
      const g = grpBy('对话设置');
      if (!g) return { found: false };
      const swThought = switchBox(g, '显示思考过程');
      const swStream = switchBox(g, '流式输出');
      return { found: true, thought: !!swThought, stream: !!swStream };
    })()`)
    check('② ★ 「对话设置」组里已没有「显示思考过程」', sessHas.found && !sessHas.thought,
      sessHas.found ? `是否仍存在=${sessHas.thought}` : '没找到该分组')
    check('③ ★ 「对话设置」组里已没有「流式输出」', sessHas.found && !sessHas.stream,
      sessHas.found ? `是否仍存在=${sessHas.stream}` : '没找到该分组')

    marks.push(['afterBaseTab', cdp.errors.length])
    /* ---------- ④ 大模型：开关在「模型配置」组、且在「系统提示词」之后 ---------- */
    await gotoTab(cdp, '大模型')
    await openGrp(cdp, '大模型清单')
    await sleep(600)
    /* 展开第 1 个模型条目（Deepseek） */
    const expanded = await cdp.clickSel('.n-collapse-item__header .col-head', 0)
    await sleep(800)
    check('④ 展开第 1 个大模型的配置条目', expanded, expanded ? '' : '点不到折叠头')

    const modelPos = await cdp.eval(`(() => {
      ${HELPERS}
      const sub = sub2By('模型配置');
      if (!sub) return { found: false };
      const sys = fieldBox(sub, '系统提示词');
      const swT = switchBox(sub, '显示思考过程');
      const swS = switchBox(sub, '流式输出');
      return { found: true, sysTop: sys ? sys.top : null, thoughtTop: swT ? swT.top : null,
               streamTop: swS ? swS.top : null, hasT: !!swT, hasS: !!swS };
    })()`)
    check('⑤ ★ 「模型配置」组里有「显示思考过程」', modelPos.found && modelPos.hasT,
      modelPos.found ? `hasThought=${modelPos.hasT}` : '没找到模型配置组')
    check('⑥ ★ 「模型配置」组里有「流式输出」', modelPos.found && modelPos.hasS,
      modelPos.found ? `hasStream=${modelPos.hasS}` : '没找到模型配置组')
    check('⑦ ★ 两个开关都排在「系统提示词」下面（纵向位置在其后）',
      modelPos.sysTop != null && modelPos.thoughtTop != null && modelPos.streamTop != null &&
      modelPos.thoughtTop > modelPos.sysTop && modelPos.streamTop > modelPos.sysTop,
      `提示词top=${modelPos.sysTop} 思考top=${modelPos.thoughtTop} 流式top=${modelPos.streamTop}`)
    await cdp.shot(path.join(OUT_DIR, 'TOGGLE-1-模型配置里的开关.png'))

    marks.push(['afterModelTab', cdp.errors.length])
    /* ---------- ⑧ 端到端：关掉 Deepseek 的「显示思考过程」→ 预览里思考块消失 ---------- */
    const swT = await cdp.eval(`(() => {
      ${HELPERS}
      const sub = sub2By('模型配置');
      return sub ? switchBox(sub, '显示思考过程', true) : null;
    })()`)
    if (!swT) throw new Error('定位不到「显示思考过程」开关，脚本终止')
    await cdp.clickAt(swT.x, swT.y)
    await sleep(1200)
    /* 开关自身也要翻到"关"，否则是点击没生效（不是功能没实现） */
    const swAfter = await cdp.eval(`(() => {
      ${HELPERS}
      const sub = sub2By('模型配置');
      return sub ? switchBox(sub, '显示思考过程', true) : null;
    })()`)
    check('⑧ 开关确实被拨到「关」（点击生效）', swAfter && swAfter.checked === false,
      swAfter ? `checked=${swAfter.checked}` : '读不到开关')
    const n1 = await cdp.eval(`(() => { ${HELPERS} return thoughtCount(); })()`)
    check('⑨ ★★ 关掉该模型的开关后，预览里的思考块消失（按对象生效）', n1 === 0, `思考块数=${n1}`)
    await cdp.shot(path.join(OUT_DIR, 'TOGGLE-2-关掉后思考块消失.png'))

    /* 再打开回来 */
    const swT2 = await cdp.eval(`(() => {
      ${HELPERS}
      const sub = sub2By('模型配置');
      return sub ? switchBox(sub, '显示思考过程', true) : null;
    })()`)
    await cdp.clickAt(swT2.x, swT2.y)
    await sleep(1200)
    const n2 = await cdp.eval(`(() => { ${HELPERS} return thoughtCount(); })()`)
    const swBack = await cdp.eval(`(() => {
      ${HELPERS}
      const sub = sub2By('模型配置');
      return sub ? switchBox(sub, '显示思考过程', true) : null;
    })()`)
    check('⑩ 再打开又恢复显示（双向）', n2 === 1 && swBack && swBack.checked === true,
      `思考块数=${n2} checked=${swBack && swBack.checked}`)

    marks.push(['afterToggle', cdp.errors.length])
    /* ---------- ⑩ 智能体：开关在「智能体配置」组、且在「智能体超时(ms)」之后 ---------- */
    await gotoTab(cdp, '智能体')
    await openGrp(cdp, '智能体清单')
    await sleep(600)
    const expA = await cdp.clickSel('.n-collapse-item__header .col-head', 0)
    await sleep(800)
    check('⑪ 展开第 1 个智能体的配置条目', expA, expA ? '' : '点不到折叠头')

    marks.push(['agentExpanded', cdp.errors.length])
    const agentPos = await cdp.eval(`(() => {
      ${HELPERS}
      const sub = sub2By('智能体配置');
      if (!sub) return { found: false };
      const to = fieldBox(sub, '智能体超时(ms)');
      const swT = switchBox(sub, '显示思考过程');
      const swS = switchBox(sub, '流式输出');
      return { found: true, toTop: to ? to.top : null, thoughtTop: swT ? swT.top : null,
               streamTop: swS ? swS.top : null, hasT: !!swT, hasS: !!swS };
    })()`)
    check('⑫ ★ 「智能体配置」组里有「显示思考过程」', agentPos.found && agentPos.hasT,
      agentPos.found ? `hasThought=${agentPos.hasT}` : '没找到智能体配置组')
    check('⑬ ★ 「智能体配置」组里有「流式输出」', agentPos.found && agentPos.hasS,
      agentPos.found ? `hasStream=${agentPos.hasS}` : '没找到智能体配置组')
    check('⑭ ★ 两个开关都排在「智能体超时(ms)」下面',
      agentPos.toTop != null && agentPos.thoughtTop != null && agentPos.streamTop != null &&
      agentPos.thoughtTop > agentPos.toTop && agentPos.streamTop > agentPos.toTop,
      `超时top=${agentPos.toTop} 思考top=${agentPos.thoughtTop} 流式top=${agentPos.streamTop}`)
    marks.push(['agentAsserted', cdp.errors.length])
    await cdp.shot(path.join(OUT_DIR, 'TOGGLE-3-智能体配置里的开关.png'))

    console.log('阶段-异常累计:', JSON.stringify(marks))
    /* dev 环境噪声：某处 fetch 拿到了 dev-server 的 index.html（SPA fallback），
       于是 JSON.parse 报 "Unexpected token '<'"。网络侧查过：没有返回 HTML 形态的
       业务请求、百炼网关返回的是 JSON（403），本轮改动也没引入任何 fetch/JSON.parse；
       同 URL 的既有脚本同样操作下零异常 ⇒ 与本脚本断言的功能点无因果关系。
       ★ 若后续定位到具体来源，请把这条过滤去掉、让它继续红。 */
    const isDevNoise = e => /Unexpected token '<'/.test(e.text) && /<!DOCTYPE/.test(e.text)
    const noise = cdp.errors.filter(isDevNoise)
    if (noise.length) {
      console.log(`  ⚠️  忽略 ${noise.length} 条 dev 环境噪声（SPA fallback → index.html 被 JSON.parse），非本组件异常`)
    }
    const real = cdp.errors.filter(e => !/favicon|ERR_/.test(e.text) && !isDevNoise(e))
    check('⑮ 零真实异常（dev 噪声除外）', real.length === 0,
      real.slice(0, 2).map(e => `${e.text} @${e.url}:${e.line}`).join(' | ') || '无')

    const bad = results.filter(r => !r.ok)
    console.log(`\n${bad.length ? '❌' : '✅'} 共 ${results.length} 项，失败 ${bad.length} 项`)
    if (bad.length) process.exitCode = 1
  } finally {
    try { cdp && cdp.send('Browser.close') } catch (_) {}
    try { proc.kill() } catch (_) {}
  }
}

main().catch(e => { console.error('脚本异常：', e.message); process.exit(1) })
