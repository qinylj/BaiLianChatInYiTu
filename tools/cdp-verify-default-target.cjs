/**
 * 「默认对话」组里选了某个智能体，预览就该是那个智能体
 *
 *  用户现象：在设置面板的「默认对话 → 默认选中」里选了智能体 B，
 *            但预览区顶部高亮的却不是 B。
 *
 *  嫌疑：组件初始化读历史会话时，用「历史第一条」反写了顶部对话对象
 *        （localStore → syncTargetFromActive），把面板配置盖掉了。
 *
 *  本脚本用**真实 UI 操作**（展开分组 → 点 naive-ui 下拉 → 键盘选第 N 项）来改配置，
 *  不直接改内存对象，确保走的是用户那条路径。
 *
 * 用法：node tools/cdp-verify-default-target.cjs   （需要 dev server 在 8085）
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
const PORT = Number(process.env.CDP_PORT || 9581)
const sleep = ms => new Promise(r => setTimeout(r, ms))
function findBrowser() {
  for (const p of CHROME_CANDIDATES) { try { if (p && fs.existsSync(p)) return p } catch (_) {} }
  return null
}

const HELPERS = `
  const vis = e => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const root = () => document.querySelector('.bailian-chat-in-yitu');
  const norm = s => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const topActive = () => {
    const m = [...document.querySelectorAll('.bailian-chat-in-yitu .ac-sec.models .ac-pick-item.active')].filter(vis);
    const a = [...document.querySelectorAll('.bailian-chat-in-yitu .ac-sec.agents .ac-pick-item.active')].filter(vis);
    const el = m[0] || a[0] || null;
    const nm = el && el.querySelector('.ac-pick-name');
    return { kind: m.length ? 'model' : (a.length ? 'agent' : 'none'), name: nm ? norm(nm.textContent) : '' };
  };
  const bottomActive = () => {
    const rows = [...document.querySelectorAll('.bailian-chat-in-yitu .ac-conv-item')].filter(vis);
    const el = rows.find(r => r.classList.contains('active')) || null;
    if (!el) return null;
    const t = el.querySelector('.ac-conv-title');
    const m = el.querySelector('.ac-conv-meta');
    return { title: t ? norm(t.textContent) : '', meta: m ? norm(m.textContent) : '' };
  };
  /* 调试台底排的 option 实时 JSON：取「包含 targetId 且文本最短」的那个可见元素（最内层） */
  const optionJson = () => {
    const hits = [...document.querySelectorAll('div, pre, code, textarea')].filter(vis)
      .filter(e => /"targetId"/.test(e.textContent || ''));
    if (!hits.length) return '';
    hits.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return norm(hits[0].textContent).slice(0, 4000);
  };
  /* 「默认选中」下拉当前显示的值 —— 比读 option JSON 稳（JSON 卡片太长会截断） */
  const selText = () => {
    const sels = [...document.querySelectorAll('.n-base-selection')].filter(vis);
    return sels.length > 1 ? norm(sels[1].textContent) : '';
  };
`

/** 播种会话到当前桶（换全新实例 id，避免卸载回写盖掉种子） */
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
  /** 用键盘在下拉里选第 n 项（naive-ui 的 option.click() 不生效，必须走真实键盘） */
  async key(times, keyName, code, vk) {
    for (let i = 0; i < times; i++) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vk })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk })
      await sleep(120)
    }
  }
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' —— ' + detail : ''}`)
}
const snap = cdp => cdp.eval(`(() => { ${HELPERS}
  return { top: topActive(), bottom: bottomActive(), targetId: selText() };
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

    /* 播种：历史里第一条属于「防汛事件处置建议」(agent-flood)，第二条属于 Deepseek */
    await cdp.eval(seedExpr([
      { id: 'c-a', title: '老会话-防汛处置', kind: 'agent', targetId: 'agent-flood', targetName: '防汛事件处置建议', n: 3 },
      { id: 'c-b', title: '老会话-复盘', kind: 'agent', targetId: 'agent-flood-review', targetName: '防汛事件评价复盘', n: 2 }
    ]))
    await cdp.send('Page.reload')
    await sleep(9000)

    const s0 = await snap(cdp)
    check('① 播种生效：2 条历史，当前选中第 1 条（防汛事件处置建议）',
      /防汛事件处置建议/.test(s0.top.name), `顶部=${s0.top.kind}/${s0.top.name}；底部=${s0.bottom && s0.bottom.title}`)

    /* 展开「默认对话」分组 */
    const opened = await cdp.eval(`(() => {
      ${HELPERS}
      const heads = [...document.querySelectorAll('.grp-title')].filter(vis);
      const h = heads.find(x => norm(x.textContent) === '默认对话');
      if (!h) return { found: false };
      h.click();
      return { found: true };
    })()`)
    check('② 找到并展开「默认对话」分组', opened.found, opened.found ? '' : '没找到该分组标题')
    await sleep(600)

    /* 点开「默认选中」下拉：它在 label 为「默认选中」的那一行里 */
    const selInfo = await cdp.eval(`(() => {
      ${HELPERS}
      const labels = [...document.querySelectorAll('.grp')].filter(vis)
        .filter(g => norm(g.querySelector('.grp-title') && g.querySelector('.grp-title').textContent) === '默认对话');
      const grp = labels[0]; if (!grp) return { ok: false, why: 'no grp' };
      const sel = [...grp.querySelectorAll('.n-base-selection')].filter(vis);
      return { ok: sel.length >= 2, count: sel.length, box: sel[1] ? (r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(sel[1].getBoundingClientRect()) : null };
    })()`)
    check('③ 定位到「默认选中」下拉', selInfo.ok, `组内下拉数=${selInfo.count}`)
    if (!selInfo.ok) throw new Error('定位不到下拉，脚本终止')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: selInfo.box.x, y: selInfo.box.y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: selInfo.box.x, y: selInfo.box.y, button: 'left', clickCount: 1 })
    await sleep(700)

    /* 菜单里当前是第 1 项（防汛事件处置建议），往下走 1 步选到第 2 项（防汛事件评价复盘） */
    await cdp.key(1, 'ArrowDown', 'ArrowDown', 40)
    await cdp.key(1, 'Enter', 'Enter', 13)
    await sleep(900)
    await cdp.shot(path.join(OUT_DIR, 'DEFTRG-1-改默认选中.png'))

    const s1 = await snap(cdp)
    check('④ 面板「默认选中」确实落到了所选智能体上',
      /防汛事件评价复盘/.test(s1.targetId), `下拉显示=${s1.targetId}`)
    check('⑤ ★ 预览顶部就是面板选的那个智能体（防汛事件评价复盘）',
      /防汛事件评价复盘/.test(s1.top.name), `顶部=${s1.top.kind}/${s1.top.name}`)
    check('⑥ ★ 底部跟着切到该智能体的会话（或该对象暂无会话时不选中），两边一致',
      !s1.bottom || /防汛事件评价复盘/.test(s1.bottom.meta || ''),
      `底部=${s1.bottom ? s1.bottom.title + ' / ' + s1.bottom.meta : '（未选中，应为空）'}`)

    /* 再切回第 1 个，确认是双向的 */
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: selInfo.box.x, y: selInfo.box.y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: selInfo.box.x, y: selInfo.box.y, button: 'left', clickCount: 1 })
    await sleep(700)
    await cdp.key(1, 'ArrowUp', 'ArrowUp', 38)
    await cdp.key(1, 'Enter', 'Enter', 13)
    await sleep(900)
    const s2 = await snap(cdp)
    check('⑦ 改回第 1 个也跟随（防汛事件处置建议）',
      /防汛事件处置建议/.test(s2.top.name), `顶部=${s2.top.name}`)
    await cdp.shot(path.join(OUT_DIR, 'DEFTRG-2-改回第一个.png'))

    const real = cdp.errors.filter(e => !/favicon|ERR_/.test(e))
    check('⑧ 零真实异常', real.length === 0, real.slice(0, 2).join(' | ') || '无')

    const bad = results.filter(r => !r.ok)
    console.log(`\n${bad.length ? '❌' : '✅'} 共 ${results.length} 项，失败 ${bad.length} 项`)
    if (bad.length) process.exitCode = 1
  } finally {
    try { cdp && cdp.send('Browser.close') } catch (_) {}
    try { proc.kill() } catch (_) {}
  }
}

main().catch(e => { console.error('脚本异常：', e.message); process.exit(1) })
