/*
 * @Description: BaiLianChatInYiTu 网络层
 *  - 百炼智能体：走网关 5 个接口（createSession / run / clearSession / deleteSession / feedback / taskFinishNotice）
 *  - 大模型：直连 OpenAI 兼容的 /chat/completions
 */
import { GatewayOption, StreamChunk } from './types'

/* ------------------------------ 基础工具 ------------------------------ */

export const joinUrl = (base: string, path: string) => {
  const b = String(base || '').replace(/\/+$/, '')
  const p = String(path || '')
  if (/^https?:\/\//i.test(p)) return p
  return b + (p.startsWith('/') ? p : '/' + p)
}

export const uid = (prefix = 'id') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** 组合「外部取消」与「超时」两个中断源 */
const makeAbort = (timeoutMs: number, outer?: AbortSignal) => {
  const ctrl = new AbortController()
  let timer: any = null
  const onOuterAbort = () => ctrl.abort()
  if (timeoutMs > 0) {
    timer = setTimeout(() => ctrl.abort(), timeoutMs)
  }
  if (outer) {
    if (outer.aborted) ctrl.abort()
    else outer.addEventListener('abort', onOuterAbort)
  }
  return {
    signal: ctrl.signal,
    dispose: () => {
      if (timer) clearTimeout(timer)
      if (outer) outer.removeEventListener('abort', onOuterAbort)
    }
  }
}

const gatewayHeaders = (cfg: GatewayOption) => ({
  Authorization: `Bearer ${cfg.apiKey || ''}`,
  'Content-Type': 'application/json'
})

/**
 * 浏览器只在「请求根本没发出去」或「响应读不到」时才抛 TypeError: Failed to fetch，
 * 它把跨域预检被拒、混合内容、网络不可达三种完全不同的原因糊成同一句话，运维只能靠猜。
 * 这里补上判定与处置建议，把定位时间从小时级压到分钟级。
 * 注意：Postman / apifox / curl 不做跨域校验，它们能通不代表浏览器能通。
 */
function explainFetchError(url: string, err: any): any {
  const raw = (err && err.message) || String(err)
  const name = (err && err.name) || ''
  // 主动取消 / 超时：原样抛出，上层按「已中断」处理
  if (name === 'AbortError' || /abort/i.test(raw)) return err
  if (!/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) return err

  const tips: string[] = []
  let pageOrigin = ''
  try {
    pageOrigin = typeof location !== 'undefined' ? location.origin : ''
  } catch (e) {
    /* 非浏览器环境 */
  }

  if (/^https?:\/\//i.test(url)) {
    let targetOrigin = url
    try {
      targetOrigin = new URL(url).origin
    } catch (e) {
      /* 地址不合法则保持原样 */
    }
    if (pageOrigin.indexOf('https:') === 0 && url.indexOf('http://') === 0) {
      tips.push('页面是 https 而接口是 http（混合内容被浏览器拦截），请把接口换成 https 或走同源反向代理')
    } else if (pageOrigin && targetOrigin !== pageOrigin) {
      tips.push(
        `接口 ${targetOrigin} 与页面 ${pageOrigin} 不同源，浏览器必须先发 CORS 预检（OPTIONS），` +
          `网关未放行预检就会在这里中断；请让网关 CORS 放行来源 ${pageOrigin}` +
          `（允许 POST/OPTIONS，允许 Authorization、Content-Type 请求头），` +
          `或给大屏站点加同源反向代理、把网关地址填成相对路径`
      )
    }
  }
  tips.push('提示：Postman / apifox / curl 不校验跨域，它们能通不代表浏览器能通')

  const out: any = new Error(`${raw}｜${tips.join('。')}`)
  out.name = name || 'TypeError'
  return out
}

/** 包装 fetch：只把网络层异常换成带处置建议的错误，其余行为完全不变 */
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    throw explainFetchError(url, err)
  }
}

async function postJson(url: string, headers: Record<string, string>, body: any, timeoutMs: number, outer?: AbortSignal) {
  const { signal, dispose } = makeAbort(timeoutMs, outer)
  try {
    const res = await request(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch (e) {
      throw new Error(`响应不是合法 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
    }
    if (!res.ok) {
      throw new Error((data && (data.errorMsg || data.message)) || `HTTP ${res.status}`)
    }
    if (data && data.success === false) {
      throw new Error(data.errorMsg || data.message || '网关返回失败')
    }
    return { data, res }
  } finally {
    dispose()
  }
}

/* ------------------------------ SSE 解析 ------------------------------ */

/**
 * 按行切 SSE。返回两个方法：push 喂原始文本，flush 收尾。
 * 只认 `data:` 行；`: ` 开头的注释行、id:/event: 行按规范忽略。
 */
export function createSseParser(onPayload: (payload: string) => void) {
  let buffer = ''
  const consume = (line: string) => {
    const t = line.trim()
    if (!t || t.startsWith(':')) return
    if (!t.startsWith('data:')) return
    const payload = t.slice(5).trim()
    if (payload && payload !== '[DONE]') onPayload(payload)
  }
  return {
    push(chunk: string) {
      buffer += chunk
      const lines = buffer.split('\n')
      // 最后一段可能是不完整的行，留到下一轮
      buffer = lines.pop() || ''
      for (const line of lines) consume(line)
    },
    flush() {
      const rest = buffer
      buffer = ''
      if (rest) consume(rest)
    }
  }
}

/** 从 content 的任意一种形态里抠出文本 */
function readTextOf(item: any): string {
  if (item == null) return ''
  if (typeof item === 'string') return item
  if (item.text) {
    if (typeof item.text === 'string') return item.text
    if (typeof item.text.value === 'string') return item.text.value
  }
  if (typeof item.value === 'string') return item.value
  if (typeof item.data === 'string') return item.data
  return ''
}

const EMPTY_CHUNK = (): StreamChunk => ({
  text: '',
  thought: '',
  strayClose: false,
  image: '',
  end: false,
  error: '',
  requestId: '',
  taskId: '',
  usage: null
})

/**
 * 解析百炼 run 接口的单条 SSE 数据。
 * content 既可能是数组（[{type:'text', text:{value}}]），也可能是对象（{value, type}），
 * 两种形态在真实返回里都出现过，这里统一成 {text, thought, image}。
 */
export function extractBailianChunk(raw: any): StreamChunk {
  const out = EMPTY_CHUNK()
  if (!raw || typeof raw !== 'object') return out

  out.end = !!raw.end
  out.requestId = raw.requestId || raw.id || ''
  out.usage = raw.usage || null
  // taskId 藏在 usage.uiTaskId 里，feedback 接口要用
  if (raw.usage && raw.usage.uiTaskId) out.taskId = String(raw.usage.uiTaskId)

  const label = String(raw.object || raw.type || '')
  const isThought = label.indexOf('thought') >= 0

  const content = raw.content
  const items: any[] = Array.isArray(content) ? content : content != null ? [content] : []

  for (const item of items) {
    if (item && typeof item === 'object') {
      if (item.errorMsg) {
        out.error += String(item.errorMsg)
        continue
      }
      if (item.type === 'image') {
        const url = (item.image && item.image.url) || ''
        if (url) out.image += url
        continue
      }
    }
    const txt = readTextOf(item)
    if (!txt) continue
    if (isThought) out.thought += txt
    else out.text += txt
  }

  if (!out.error && typeof raw.errorMsg === 'string') out.error = raw.errorMsg
  return out
}

/** 解析 OpenAI 兼容流式分片 */
export function extractOpenAIChunk(raw: any): StreamChunk {
  const out = EMPTY_CHUNK()
  if (!raw || typeof raw !== 'object') return out
  const choice = (raw.choices && raw.choices[0]) || null
  if (!choice) {
    if (raw.error) out.error = raw.error.message || String(raw.error)
    return out
  }
  const delta = choice.delta || {}
  if (typeof delta.content === 'string') out.text += delta.content
  if (typeof delta.reasoning_content === 'string') out.thought += delta.reasoning_content
  out.end = choice.finish_reason != null || choice.delta === undefined
  out.usage = raw.usage || null
  return out
}

/* ------------------------ 正文里的 <think> 标签 ------------------------ */

/**
 * 有些模型（尤其经网关转发之后）不把思考过程放进 reasoning_content 字段，
 * 而是直接写在正文里：`<think>……思考……</think>真正的回答`。
 * 后果是思考内容与 `<think>` 标签一起被当正文显示在气泡里，非常难看。
 *
 * 还会遇到两种残缺形态，都得兜住：
 *  ① 只有 `</think>` 没有 `<think>`（上游把开标签挪走了）—— 闭合标签之前的那段就是思考；
 *  ② 流式分片把标签切成两半（`<thi` + `nk>`，甚至 `<` + `think>`）—— 所以必须带状态，
 *     并把"可能是标签开头"的尾巴先扣住，等下一片到齐再判断。
 * 收尾时仍未闭合的残片按当前状态吐出来 —— 宁可多显示几个字符，也不能吞内容。
 */
export function createThinkSplitter() {
  const OPEN_RE = /<think\b[^>]*>/i
  const CLOSE_RE = /<\/think\s*>/i
  const OPEN_HEAD = '<think'
  const CLOSE_HEAD = '</think'
  /** 标签最长可能被切成的悬空长度上限，超过就不再当标签，直接按正文吐 */
  const HOLD_MAX = 32

  let inThink = false
  let carry = ''
  let text = ''
  let thought = ''

  const emitTo = (target: 'text' | 'thought', s: string) => {
    if (!s) return
    if (target === 'thought') thought += s
    else text += s
  }

  /**
   * buf 末尾有多少字符需要扣住（等下一片）：
   *  ① 已经出现 head，但 `>` 还没到 —— 标签被切在中间；
   *  ② 末尾只是 head 的前几个字符（`<`、`<t`…）—— 可能是标签的开头。
   */
  const holdLen = (buf: string, head: string) => {
    const low = buf.toLowerCase()
    const i = low.lastIndexOf(head)
    if (i >= 0) {
      if (buf.indexOf('>', i + head.length) < 0 && buf.length - i <= HOLD_MAX) return buf.length - i
      return 0
    }
    const max = Math.min(buf.length, head.length - 1)
    for (let n = max; n > 0; n--) {
      if (low.slice(buf.length - n) === head.slice(0, n)) return n
    }
    return 0
  }

  /** 喂一片正文增量，返回本片里"属于正文"和"属于思考"的两段文本 */
  const feed = (piece: string) => {
    text = ''
    thought = ''
    let stray = false
    let buf = carry + String(piece == null ? '' : piece)
    carry = ''
    while (buf) {
      const open = OPEN_RE.exec(buf)
      const close = CLOSE_RE.exec(buf)
      if (inThink) {
        if (close) {
          emitTo('thought', buf.slice(0, close.index))
          inThink = false
          buf = buf.slice(close.index + close[0].length)
          continue
        }
      } else {
        // 只有闭合标签：它前面那段没有开标签的文本，就是被上游剥掉开标签的思考过程
        if (close && (!open || close.index < open.index)) {
          emitTo('thought', buf.slice(0, close.index))
          // 流式下"之前那些分片"已经当正文发出去了，这里只能打个标记，由上层回挪
          stray = true
          buf = buf.slice(close.index + close[0].length)
          continue
        }
        if (open) {
          emitTo('text', buf.slice(0, open.index))
          inThink = true
          buf = buf.slice(open.index + open[0].length)
          continue
        }
      }
      const hold = inThink
        ? holdLen(buf, CLOSE_HEAD)
        : Math.max(holdLen(buf, OPEN_HEAD), holdLen(buf, CLOSE_HEAD))
      if (hold > 0) {
        emitTo(inThink ? 'thought' : 'text', buf.slice(0, buf.length - hold))
        carry = buf.slice(buf.length - hold)
      } else {
        emitTo(inThink ? 'thought' : 'text', buf)
      }
      buf = ''
    }
    return { text, thought, strayClose: stray }
  }

  /** 流结束：把扣住的残片放出来（残片是半个标签时不会被认成标签，正好当正文/思考处理） */
  const flush = () => {
    text = ''
    thought = ''
    if (carry) {
      emitTo(inThink ? 'thought' : 'text', carry)
      carry = ''
    }
    return { text, thought }
  }

  return { feed, flush, isInThink: () => inThink }
}

export type ThinkSplitter = ReturnType<typeof createThinkSplitter>

/** 把一块增量里的 `<think>` 内容挪到 thought；就地改写并返回同一对象 */
const splitThinkInPlace = (sp: ThinkSplitter, chunk: StreamChunk): StreamChunk => {
  if (chunk.text) {
    const parts = sp.feed(chunk.text)
    chunk.text = parts.text
    chunk.thought += parts.thought
    if (parts.strayClose) chunk.strayClose = true
  }
  return chunk
}

/** 流结束时收尾：把被扣住的残片拼成一块新增量（没有残片则返回 null） */
const drainThink = (sp: ThinkSplitter): StreamChunk | null => {
  const rest = sp.flush()
  if (!rest.text && !rest.thought) return null
  const out = EMPTY_CHUNK()
  out.text = rest.text
  out.thought = rest.thought
  return out
}

/* ------------------------------ 百炼网关 ------------------------------ */

export interface RunParams {
  /** 前端拼好的文本 */
  text: string
  /** 传给智能体的参数（会放进 message.metadata） */
  metadata?: Record<string, any>
  /** 附件 */
  attachments?: Array<{ url: string; name?: string }>
}

/**
 * 创建会话，返回 sessionId（网关字段名是 uniqueCode）。
 * agentVersion 非必填；填了就带上。
 */
export async function createSession(
  cfg: GatewayOption,
  agentCode: string,
  agentVersion = '',
  outer?: AbortSignal
): Promise<string> {
  if (!agentCode) throw new Error('未配置智能体编码（agentCode）')
  const body: Record<string, any> = { agentCode }
  if (agentVersion) body.agentVersion = agentVersion
  const { data } = await postJson(
    joinUrl(cfg.baseUrl, cfg.paths.createSession),
    gatewayHeaders(cfg),
    body,
    cfg.timeoutMs,
    outer
  )
  const sessionId = (data && data.data && (data.data.uniqueCode || data.data.sessionId)) || ''
  if (!sessionId) throw new Error('创建会话未返回 uniqueCode')
  return String(sessionId)
}

/**
 * 发起一次对话。stream=true 时逐块回调，false 时一次性回调一块。
 * 返回本次运行的 requestId / taskId，用于后续反馈。
 */
export async function runAgent(
  cfg: GatewayOption,
  sessionId: string,
  params: RunParams,
  onChunk: (chunk: StreamChunk) => void,
  stream = true,
  outer?: AbortSignal
): Promise<{ requestId: string; taskId: string }> {
  if (!sessionId) throw new Error('缺少 sessionId')
  const body: Record<string, any> = {
    sessionId,
    stream,
    delta: true,
    trace: false,
    message: {
      text: params.text,
      metadata: params.metadata || {},
      attachments: params.attachments || []
    }
  }
  const url = joinUrl(cfg.baseUrl, cfg.paths.run)
  const { signal, dispose } = makeAbort(cfg.timeoutMs, outer)
  let requestId = ''
  let taskId = ''
  const track = (c: StreamChunk) => {
    if (c.requestId) requestId = c.requestId
    if (c.taskId) taskId = c.taskId
  }

  try {
    const res = await request(url, {
      method: 'POST',
      headers: gatewayHeaders(cfg),
      body: JSON.stringify(body),
      signal
    })

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      throw new Error(raw || `HTTP ${res.status}`)
    }

    // 任务 id 也可能挂在响应头上
    const headerTaskId = res.headers.get('idx-agent-task-id')
    if (headerTaskId) taskId = headerTaskId

    if (!stream) {
      const raw = await res.text()
      let json: any = null
      try {
        json = raw ? JSON.parse(raw) : null
      } catch (e) {
        throw new Error(`响应不是合法 JSON：${raw.slice(0, 200)}`)
      }
      if (json && json.success === false) throw new Error(json.errorMsg || '网关返回失败')
      const msg = (json && json.data && json.data.message) || null
      const chunk = EMPTY_CHUNK()
      if (msg) {
        const items: any[] = Array.isArray(msg.content) ? msg.content : msg.content ? [msg.content] : []
        for (const item of items) {
          if (item && item.type === 'image') {
            chunk.image += (item.image && item.image.url) || ''
          } else {
            chunk.text += readTextOf(item)
          }
        }
      }
      const thoughts = (json && json.data && json.data.thoughts) || []
      if (Array.isArray(thoughts)) {
        for (const th of thoughts) {
          const items: any[] = Array.isArray(th.content) ? th.content : th.content ? [th.content] : []
          for (const item of items) chunk.thought += readTextOf(item)
        }
      }
      // 正文里若混了 <think> 标签（有些模型用标签表达思考），一并挪进思考内容
      const sp = createThinkSplitter()
      splitThinkInPlace(sp, chunk)
      const rest = drainThink(sp)
      if (rest) {
        chunk.text += rest.text
        chunk.thought += rest.thought
      }
      chunk.end = true
      track(chunk)
      onChunk(chunk)
      return { requestId, taskId }
    }

    // ---- 流式 ----
    const reader = res.body && (res.body as any).getReader ? (res.body as any).getReader() : null
    if (!reader) throw new Error('当前环境不支持流式读取（response.body 不可用）')
    const decoder = new TextDecoder('utf-8')
    let errored = ''
    const sp = createThinkSplitter()
    const parser = createSseParser(payload => {
      let json: any = null
      try {
        json = JSON.parse(payload)
      } catch (e) {
        return // 非 JSON 的 data 行直接跳过
      }
      const chunk = splitThinkInPlace(sp, extractBailianChunk(json))
      if (chunk.error) errored += chunk.error
      if (chunk.text || chunk.thought || chunk.strayClose || chunk.image || chunk.end) {
        track(chunk)
        onChunk(chunk)
      }
    })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.flush()
    const rest = drainThink(sp)
    if (rest && (rest.text || rest.thought)) onChunk(rest)

    if (errored) throw new Error(errored)
    const tail = EMPTY_CHUNK()
    tail.end = true
    onChunk(tail)
    return { requestId, taskId }
  } finally {
    dispose()
  }
}

/** 会话中断（清空上下文，保留会话） */
export async function clearSession(cfg: GatewayOption, sessionId: string, outer?: AbortSignal) {
  const { data } = await postJson(
    joinUrl(cfg.baseUrl, cfg.paths.clearSession),
    gatewayHeaders(cfg),
    { sessionId },
    cfg.timeoutMs,
    outer
  )
  return !!(data && data.success)
}

/** 永久删除会话及相关数据 */
export async function deleteSession(cfg: GatewayOption, sessionId: string, outer?: AbortSignal) {
  const { data } = await postJson(
    joinUrl(cfg.baseUrl, cfg.paths.deleteSession),
    gatewayHeaders(cfg),
    { sessionId },
    cfg.timeoutMs,
    outer
  )
  return !!(data && data.success)
}

/** 对一次运行结果点赞 / 点踩 */
export async function sendFeedback(
  cfg: GatewayOption,
  payload: {
    sessionId: string
    requestId: string
    taskId: string
    vote: 'LIKE' | 'DISLIKE'
    subject?: 'REQUEST' | 'TASK'
    comment?: string
    uniqueCode?: string
  },
  outer?: AbortSignal
) {
  const body: Record<string, any> = {
    sessionId: payload.sessionId,
    requestId: payload.requestId,
    taskId: payload.taskId,
    subject: payload.subject || 'REQUEST',
    provider: { source: 'USER', extendInfo: {} },
    vote: payload.vote
  }
  if (payload.uniqueCode) body.uniqueCode = payload.uniqueCode
  if (payload.comment) body.extCommentsInfo = { comment: payload.comment }
  const { data } = await postJson(
    joinUrl(cfg.baseUrl, cfg.paths.feedback),
    gatewayHeaders(cfg),
    body,
    cfg.timeoutMs,
    outer
  )
  return !!(data && data.success)
}

/**
 * 工具异步回调：智能体执行中调用异步工具时，会在请求头下发 key=idx-agent-task-id 的任务标识，
 * 调用方完成工具任务后回调本接口告知结果。data 必须是 JSON 字符串。
 */
export async function taskFinishNotice(
  cfg: GatewayOption,
  taskId: string,
  result: any,
  success = true,
  outer?: AbortSignal
) {
  const { data } = await postJson(
    joinUrl(cfg.baseUrl, cfg.paths.taskFinishNotice),
    gatewayHeaders(cfg),
    {
      taskId,
      success,
      data: typeof result === 'string' ? result : JSON.stringify(result)
    },
    cfg.timeoutMs,
    outer
  )
  return !!(data && data.success)
}

/* ------------------------------ 大模型直连 ------------------------------ */

export interface ModelRunConfig {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  temperature: number
  maxTokens: number
  timeoutMs: number
}

export async function runModel(
  cfg: ModelRunConfig,
  history: Array<{ role: string; content: string }>,
  onChunk: (chunk: StreamChunk) => void,
  stream = true,
  outer?: AbortSignal
): Promise<void> {
  if (!cfg.baseUrl) throw new Error('未配置大模型接口地址')
  const messages: Array<{ role: string; content: string }> = []
  if (cfg.system) messages.push({ role: 'system', content: cfg.system })
  messages.push(...history)

  const { signal, dispose } = makeAbort(cfg.timeoutMs, outer)
  try {
    const res = await request(cfg.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey || ''}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream,
        temperature: Number(cfg.temperature),
        max_tokens: Number(cfg.maxTokens)
      }),
      signal
    })

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      let msg = raw
      try {
        const j = JSON.parse(raw)
        msg = (j.error && j.error.message) || j.message || raw
      } catch (e) {
        /* 保持原文 */
      }
      throw new Error(msg || `HTTP ${res.status}`)
    }

    if (!stream) {
      const json: any = await res.json()
      const choice = (json.choices && json.choices[0]) || {}
      const chunk = EMPTY_CHUNK()
      chunk.text = (choice.message && choice.message.content) || ''
      chunk.thought = (choice.message && choice.message.reasoning_content) || ''
      chunk.usage = json.usage || null
      // 正文里带 <think> 标签的，一并挪到思考内容（一次性返回时同样适用）
      const sp = createThinkSplitter()
      splitThinkInPlace(sp, chunk)
      const rest = drainThink(sp)
      if (rest) {
        chunk.text += rest.text
        chunk.thought += rest.thought
      }
      chunk.end = true
      onChunk(chunk)
      return
    }

    const reader = res.body && (res.body as any).getReader ? (res.body as any).getReader() : null
    if (!reader) throw new Error('当前环境不支持流式读取（response.body 不可用）')
    const decoder = new TextDecoder('utf-8')
    let errored = ''
    const sp = createThinkSplitter()
    const parser = createSseParser(payload => {
      let json: any = null
      try {
        json = JSON.parse(payload)
      } catch (e) {
        return
      }
      const chunk = splitThinkInPlace(sp, extractOpenAIChunk(json))
      if (chunk.error) errored += chunk.error
      if (chunk.text || chunk.thought || chunk.strayClose) onChunk(chunk)
    })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.flush()
    const rest = drainThink(sp)
    if (rest && (rest.text || rest.thought)) onChunk(rest)

    if (errored) throw new Error(errored)
    const tail = EMPTY_CHUNK()
    tail.end = true
    onChunk(tail)
  } finally {
    dispose()
  }
}
