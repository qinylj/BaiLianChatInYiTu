/*
 * @Description: 复制到剪贴板
 *
 * 环境约束（这是整个实现的前提）：
 *   大屏和预览页常跑在 http://内网IP 下，也可能被塞进 iframe ——
 *   这些都不是安全上下文，`navigator.clipboard` 直接是 undefined，
 *   只用它会出现"点了复制毫无反应"。
 *
 * 所以主路径用「选中隐藏容器 + document.execCommand('copy')」：
 *   1) 非安全上下文照样可用；
 *   2) 剪贴板里会同时写入 **text/html 与 text/plain 两种形态**：
 *      粘到 Word / 邮件 / 富文本编辑器时保留标题、列表、表格、加粗，
 *      粘到记事本 / 输入框时是去掉语法符号的纯文本。
 * 这也是"复制出来别带一堆 ** 和 |"的实现方式 —— 富文本由渲染后的 HTML 提供，
 * 纯文本由 markdown.ts 的 renderMarkdownToText 提供。
 */

/**
 * 把一段 HTML 以富文本形式写入剪贴板（同时带 text/plain 兜底片）。
 * 必须在用户手势（点击）的同一个任务里调用，否则浏览器会拒绝。
 */
export function copyRichText(html: string, plainFallback: string): boolean {
  if (!html) return false
  const box = document.createElement('div')
  /* ★ 不能用 display:none / visibility:hidden —— 那样选不中，copy 必然失败。
     放到视口外 + 透明 + 不响应鼠标即可。 */
  box.style.cssText =
    'position:fixed;left:-99999px;top:0;width:auto;height:auto;opacity:0;pointer-events:none;'
  box.setAttribute('aria-hidden', 'true')
  box.innerHTML = html

  let ok = false
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null
  const prevRange = sel && sel.rangeCount ? sel.getRangeAt(0) : null
  document.body.appendChild(box)
  try {
    const range = document.createRange()
    range.selectNodeContents(box)
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
    ok = document.execCommand('copy')
  } catch (e) {
    ok = false
  }
  // 现场还原：先把选区还回去，再摘掉临时节点
  try {
    if (sel) {
      sel.removeAllRanges()
      if (prevRange) sel.addRange(prevRange)
    }
  } catch (e) {
    /* 选区还原失败不影响已完成的复制 */
  }
  document.body.removeChild(box)
  if (ok) return true

  /* execCommand 失败时退一步：至少把纯文本写进去（text/html 没了，但内容不会丢）。
     plainFallback 由调用方传进来 —— 这里不重复算一遍，避免两边不一致。 */
  return copyPlainText(plainFallback)
}

/** 老办法：临时 textarea + execCommand，任何上下文都能用 */
export function copyPlainText(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0;'
  document.body.appendChild(ta)
  let ok = false
  try {
    ta.select()
    ok = document.execCommand('copy')
  } catch (e) {
    ok = false
  }
  document.body.removeChild(ta)
  return !!ok
}

/**
 * 复制一条消息：富文本优先，逐级兜底。
 * 返回是否成功，调用方据此决定要不要把图标换成对勾。
 */
export async function copyMessageText(html: string, plain: string): Promise<boolean> {
  if (typeof document === 'undefined') return false
  // 主路径：execCommand 富文本（安全上下文 / 非安全上下文都能用）
  if (copyRichText(html, plain)) return true
  // 兜底一：现代剪贴板（仅安全上下文存在）
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(plain)
      return true
    }
  } catch (e) {
    /* 权限被拒等，继续往下兜底 */
  }
  // 兜底二：再试一次纯文本老办法
  return copyPlainText(plain)
}
