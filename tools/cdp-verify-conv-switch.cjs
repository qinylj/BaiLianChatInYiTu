/**
 * 对话对象 ↔ 当前会话 的状态一致性（两个真实 bug 的回归）
 *
 *  bug ①：先点 Deepseek 发起会话（已有记录）→ 点几个别的智能体 → 再点回 Deepseek，
 *          会自动**新建**一条空对话，可列表里明明已经有 Deepseek 的会话了。
 *          期望：回到该对象「最近用过的那条」，不新建。
 *  bug ②：删除当前会话后，底部历史高亮换到了下一条，顶部大模型/智能体
 *          **没有**跟着切到那条会话所属的对象（此时再发一条会发错对象）。
 *          期望：顶部跟随当前会话。
 *  附带 ③：重载历史（刷新）后，顶部同样要落到当前会话所属的对象上 —— 同一个根因。
 *
 * 用法：node tools/cdp-verify-conv-switch.cjs   （需要 dev server 在 8085）
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
const PORT = Number(process.env.CDP_PORT || 9577)
const sleep = ms => new Promise(r => setTimeout(r, ms))
function findBrowser() {
  for (const p of CHROME_CANDIDATES) { try { if (p && fs.existsSync(p)) return p } catch (_) {} }
  return null
}

const HELPERS = `
  const vis = e => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const root = () => document.querySelector('.bailian-chat-in-yitu');
  const norm = s => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const rows = () => [...root().querySelectorAll('.ac-conv-item')].filter(vis);
  const storeKey = () => {
    const id = norm(localStorage.getItem('dbg:BaiLianChatInYiTu:instance-id'));
    return id ? 'bailian-chat-in-yitu:' + id : null;
  };
  /* 顶部当前高亮的对话对象：落在哪个区 + 叫什么 */
  const topActive = () => {
    const m = [...root().querySelectorAll('.ac-sec.models .ac-pick-item.active')].filter(vis);
    const a = [...root().querySelectorAll('.ac-sec.agents .ac-pick-item.active')].filter(vis);
    const el = m[0] || a[0] || null;
    const nm = el && el.querySelector('.ac-pick-name');
    return {
      kind: m.length ? 'model' : (a.length ? 'agent' : 'none'),
      name: nm ? norm(nm.textContent) : '',
      count: m.length + a.length
    };
  };
  /* 底部当前高亮的会话：标题 + 它属于谁（meta 行是「对象名 · N 条 · 时间」） */
  const bottomActive = () => {
    const el = rows().find(r => r.classList.contains('active')) || null;
    if (!el) return null;
    const t = el.querySelector('.ac-conv-title');
    const m = el.querySelector('.ac-conv-meta');
    return { title: t ? norm(t.textContent) : '', meta: m ? norm(m.textContent) : '' };
  };
`

/** rows 里按顺序播种若干会话（换全新实例 id，避免卸载回写把种子盖掉） */
const seedExpr = list => `(async () => {
  const newId = 'seed' + Date.now().toString(36);
  const key = 'bailian-chat-in-yitu:' + newId;
  try { localStorage.setItem('dbg:BaiLianChatInYiTu:instance-id', newId) } catch (e) {}
  const now = Date.now();
  const mk = (s, i) => ({
    id: s.id, title: s.title, targetKind: s.kind, targetId: s.targetId, targetName: s.targetName,
    sessionId: '', createdAt: now - i * 1000, updatedAt: now - i * 1000,
    messages: Array.from({ length: s.n || 0 }, (_, k) => ({
      id: s.id + '-m' + k, role: k % 2 ? 'assistant' : 'user', content: '第' + (k + 1) + '条',
      timestamp: now - i * 1000, pending: false
    }))
  });
  localStorage.setItem(key, JSON.stringify(${JSON.stringify(list)}.map(mk)));
  return { ok: true, key };
})()`

class Cdp {
  constructor(ws) { this.ws = ws; this.mid = 0; this.pend = new Map(); this.errors = []
    this.ws.onmessage = e => {
      const d = JSON.parse(e.data)
      if (d.method === 'Runtime.exceptionThrown') {
        const ex = d.params.exceptionDetails
        this.errors.push(`${ex.text} ${ex.exception && ex.exception.description || ''}`)
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
  async clickSel(sel, nth = 0) {
    const pos = await this.eval(`(() => {
      const es = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const e = es[${nth}]; if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!pos) return false
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
    return true
  }
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' —— ' + detail : ''}`)
}
const snap = cdp => cdp.eval(`(() => { ${HELPERS}
  return { n: rows().length, top: topActive(), bottom: bottomActive() };
})()`)

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

    /* =========== ① 切走再切回，不该新建 =========== */
    console.log('\n【① 切回已有对话对象：不新建，回到原来那条】')
    await cdp.eval(seedExpr([
      { id: 'c-deep', title: 'Deepseek 老会话', kind: 'model', targetId: 'model-deepseek', targetName: 'Deepseek', n: 3 }
    ]))
    await cdp.send('Page.reload')
    await sleep(9000)

    const a0 = await snap(cdp)
    check('①-1 播种生效：1 条 Deepseek 会话，且它处于选中态',
      a0.n === 1 && /Deepseek 老会话/.test(a0.bottom && a0.bottom.title || ''),
      `条数=${a0.n} 底部=${a0.bottom && a0.bottom.title}`)
    check('①-2 重载历史后顶部也落在 Deepseek 上（同根因的第三处）',
      a0.top.kind === 'model' && /Deepseek/.test(a0.top.name),
      `顶部=${a0.top.kind}/${a0.top.name}`)

    /* 点第 1 个智能体 */
    await cdp.clickSel('.ac-sec.agents .ac-pick-item', 0)
    await sleep(600)
    const a1 = await snap(cdp)
    check('①-3 点第 1 个智能体：新建了该对象的会话（条数 +1）',
      a1.n === a0.n + 1 && a1.top.kind === 'agent', `条数 ${a0.n} → ${a1.n}；顶部=${a1.top.name}`)

    /* 再点第 2 个智能体 */
    await cdp.clickSel('.ac-sec.agents .ac-pick-item', 1)
    await sleep(600)
    const a2 = await snap(cdp)
    check('①-4 再点第 2 个智能体：又新建一条（条数 +1）',
      a2.n === a1.n + 1, `条数 ${a1.n} → ${a2.n}`)
    await cdp.shot(path.join(OUT_DIR, 'CONVSW-1-切到其他智能体.png'))

    /* ★ 点回 Deepseek */
    await cdp.clickSel('.ac-sec.models .ac-pick-item', 0)
    await sleep(600)
    const a3 = await snap(cdp)
    check('①-5 ★ 点回 Deepseek：不再新建（条数不变）',
      a3.n === a2.n, `条数 ${a2.n} → ${a3.n}`)
    check('①-6 ★ 且回到原来那条会话（不是空白新对话）',
      /Deepseek 老会话/.test(a3.bottom && a3.bottom.title || '') && /3 条/.test(a3.bottom && a3.bottom.meta || ''),
      `底部=${a3.bottom && a3.bottom.title} / ${a3.bottom && a3.bottom.meta}`)
    check('①-7 顶部与底部一致（都落在 Deepseek）',
      a3.top.kind === 'model' && /Deepseek/.test(a3.top.name), `顶部=${a3.top.kind}/${a3.top.name}`)
    await cdp.shot(path.join(OUT_DIR, 'CONVSW-2-切回Deepseek.png'))

    /* =========== ② 删除当前会话后，顶部要跟随 =========== */
    console.log('\n【② 删除当前会话：顶部对话对象跟随底部新选中的那条】')
    await cdp.eval(seedExpr([
      { id: 'c-agent', title: '智能体会话', kind: 'agent', targetId: 'agent-flood', targetName: '防汛事件处置建议', n: 4 },
      { id: 'c-model', title: '大模型会话', kind: 'model', targetId: 'model-deepseek', targetName: 'Deepseek', n: 2 }
    ]))
    await cdp.send('Page.reload')
    await sleep(9000)

    const b0 = await snap(cdp)
    check('②-1 播种生效：2 条，当前选中的是第 1 条（智能体的）',
      b0.n === 2 && /智能体会话/.test(b0.bottom && b0.bottom.title || ''),
      `条数=${b0.n} 底部=${b0.bottom && b0.bottom.title}`)
    check('②-2 重载后顶部落在智能体区（该会话所属对象）',
      b0.top.kind === 'agent' && /防汛/.test(b0.top.name), `顶部=${b0.top.kind}/${b0.top.name}`)

    /* 删掉当前这条（第 1 条）
       ★ 删除图标是 hover 才 display 出来的，必须先点一下行让指针停在上面，
         否则 query 到的按钮 rect 是 0，clickSel 会静默返回 false。 */
    await cdp.clickSel('.ac-conv-item', 0)
    await sleep(300)
    if (!(await cdp.clickSel('.ac-conv-del', 0))) throw new Error('没点到删除图标（可能仍处于隐藏态）')
    await sleep(400)
    const btns = await cdp.eval(`(() => { ${HELPERS}
      return [...root().querySelectorAll('.ac-del-confirm-btn')].map(b => norm(b.textContent));
    })()`)
    await cdp.clickSel('.ac-del-confirm-btn', btns.findIndex(t => /确认删除/.test(t)))
    await sleep(900)
    const b1 = await snap(cdp)
    check('②-3 删除生效：条数 -1，且底部切到第 2 条',
      b1.n === 1 && /大模型会话/.test(b1.bottom && b1.bottom.title || ''),
      `条数 ${b0.n} → ${b1.n}；底部=${b1.bottom && b1.bottom.title}`)
    check('②-4 ★ 顶部跟着切到大模型 Deepseek（不是还停在智能体上）',
      b1.top.kind === 'model' && /Deepseek/.test(b1.top.name),
      `顶部=${b1.top.kind}/${b1.top.name}`)
    await cdp.shot(path.join(OUT_DIR, 'CONVSW-3-删除后顶部跟随.png'))

    /* 零真实异常 */
    const real = cdp.errors.filter(e => !/favicon|ERR_/.test(e))
    check('③ 零真实异常', real.length === 0, real.slice(0, 3).join(' | ') || '无')

    const bad = results.filter(r => !r.ok)
    console.log(`\n${bad.length ? '❌' : '✅'} 共 ${results.length} 项，失败 ${bad.length} 项`)
    if (bad.length) process.exitCode = 1
  } finally {
    try { cdp && cdp.send('Browser.close') } catch (_) {}
    try { proc.kill() } catch (_) {}
  }
}

main().catch(e => { console.error('脚本异常：', e); process.exit(1) })
