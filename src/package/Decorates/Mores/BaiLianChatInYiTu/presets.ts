/*
 * @Description: BaiLianChatInYiTu 内置主题 / 背景 / 默认清单
 */
import {
  AgentItem,
  BackgroundPreset,
  ModelItem,
  ParamBinding,
  ParamSource,
  ThemePreset,
  ThemeVars
} from './types'

/* ------------------------------------------------------------------ *
 * 主题
 * 每套主题就是一组 CSS 变量。组件根节点上按变量名逐条 setProperty，
 * 所以新增主题只需要在这里加一条，不用动 index.vue 的样式表。
 * ------------------------------------------------------------------ */

/** 深色主题的公共底盘：各主题只覆盖差异项，避免 6 份变量表各写 26 行 */
const DARK_BASE: ThemeVars = {
  bg: '#0f1117',
  panel: 'rgba(22, 25, 34, 0.86)',
  panelSolid: '#161922',
  panel2: 'rgba(30, 34, 46, 0.78)',
  border: 'rgba(255, 255, 255, 0.09)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  text: '#e9ecf3',
  textDim: '#9aa3b2',
  textFaint: '#6b7383',
  accent: '#4f8cff',
  accent2: '#7c5cf5',
  accentSoft: 'rgba(79, 140, 255, 0.16)',
  accentBorder: 'rgba(79, 140, 255, 0.42)',
  accentGrad: 'linear-gradient(135deg, #4f8cff, #7c5cf5)',
  bubbleUser: 'linear-gradient(135deg, #3f7cf0, #5a6df5)',
  bubbleAi: 'rgba(32, 36, 48, 0.92)',
  danger: '#ef4444',
  ok: '#22c55e',
  warn: '#f59e0b',
  radius: '14px',
  shadow: '0 10px 32px rgba(0, 0, 0, 0.38)',
  glow: '0 0 0 rgba(0, 0, 0, 0)',
  headerGrad: 'none',
  // 深色底上琥珀色本身就够亮；浅色主题必须换深琥珀，否则对比度只有 2:1
  tagFg: '#fbbf24',
  tagBg: 'rgba(245, 158, 11, 0.16)',
  tagBd: 'rgba(245, 158, 11, 0.4)'
}

const LIGHT_BASE: ThemeVars = {
  ...DARK_BASE,
  bg: '#f2f4f9',
  panel: 'rgba(255, 255, 255, 0.88)',
  panelSolid: '#ffffff',
  panel2: 'rgba(244, 246, 251, 0.9)',
  border: 'rgba(15, 20, 35, 0.1)',
  borderStrong: 'rgba(15, 20, 35, 0.18)',
  text: '#1a1f2b',
  textDim: '#5b6474',
  textFaint: '#8b93a3',
  accent: '#2563eb',
  accent2: '#7c3aed',
  accentSoft: 'rgba(37, 99, 235, 0.1)',
  accentBorder: 'rgba(37, 99, 235, 0.42)',
  accentGrad: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  bubbleAi: 'rgba(255, 255, 255, 0.94)',
  shadow: '0 10px 30px rgba(20, 30, 60, 0.12)',
  // 小字（10px）按 4.5:1 卡阈值：#92400e 实测约 6.0:1
  tagFg: '#92400e',
  tagBg: 'rgba(146, 64, 14, 0.1)',
  tagBd: 'rgba(146, 64, 14, 0.32)'
}

const theme = (id: string, name: string, dark: boolean, over: Partial<ThemeVars>): ThemePreset => ({
  id,
  name,
  dark,
  vars: { ...(dark ? DARK_BASE : LIGHT_BASE), ...over }
})

/** 驾驶舱标题条：两侧深、中间青绿高光的对称发光条 + 两端向内箭头 */
const COCKPIT_HEADER_GRAD =
  'radial-gradient(ellipse 34% 260% at 50% 50%, rgba(6, 176, 154, 0.5), rgba(6, 176, 154, 0) 76%), ' +
  'radial-gradient(ellipse 62% 280% at 50% 50%, rgba(2, 136, 206, 0.44), rgba(2, 136, 206, 0) 80%), ' +
  'linear-gradient(90deg, #06304e 0%, #0a4a75 50%, #06304e 100%)'

export const THEMES: ThemePreset[] = [
  theme('tech', '科技蓝', true, {}),

  theme('cockpit', '驾驶舱·政务水利', true, {
    // 取色自政务大屏：底 #050e1c、面板 #0b2c45、内层 #274665、正文 #a8c1d0、强调 #0071b4~#038aa5
    bg: '#050e1c',
    panel: 'rgba(9, 28, 48, 0.78)',
    panelSolid: '#0b2c45',
    panel2: 'rgba(39, 70, 101, 0.52)',
    border: 'rgba(70, 165, 235, 0.22)',
    borderStrong: 'rgba(90, 190, 255, 0.42)',
    text: '#eaf6ff',
    textDim: '#a8c1d0',
    textFaint: '#6b8ba3',
    accent: '#22c2e8',
    accent2: '#0a86c8',
    accentSoft: 'rgba(34, 194, 232, 0.14)',
    accentBorder: 'rgba(34, 194, 232, 0.48)',
    accentGrad: 'linear-gradient(135deg, #0b6fb8, #1cc9e6)',
    bubbleUser: 'linear-gradient(135deg, #0a6699, #158cc0)',
    bubbleAi: 'rgba(26, 60, 92, 0.74)',
    danger: '#ff6b6b',
    ok: '#2fdc9e',
    warn: '#ffb454',
    radius: '8px',
    shadow: '0 10px 30px rgba(0, 8, 20, 0.6)',
    glow: '0 0 16px rgba(34, 194, 232, 0.2)',
    headerGrad: COCKPIT_HEADER_GRAD
  }),

  theme('teal', '青碧·环保水务', true, {
    bg: '#04120f',
    panel: 'rgba(10, 38, 33, 0.8)',
    panelSolid: '#0b2a24',
    panel2: 'rgba(24, 72, 62, 0.5)',
    border: 'rgba(72, 200, 170, 0.2)',
    borderStrong: 'rgba(90, 220, 190, 0.42)',
    text: '#e6fff8',
    textDim: '#9fd6c7',
    textFaint: '#609385',
    accent: '#2ee6a8',
    accent2: '#0aa5a0',
    accentSoft: 'rgba(46, 230, 168, 0.14)',
    accentBorder: 'rgba(46, 230, 168, 0.44)',
    accentGrad: 'linear-gradient(135deg, #0d9488, #34e0b0)',
    bubbleUser: 'linear-gradient(135deg, #0b7a6d, #17ab8e)',
    bubbleAi: 'rgba(20, 60, 52, 0.74)',
    danger: '#ff7a7a',
    ok: '#34e0b0',
    warn: '#ffc857',
    radius: '10px',
    glow: '0 0 16px rgba(46, 230, 168, 0.2)',
    headerGrad: 'linear-gradient(90deg, #07312a 0%, #0c5a4c 50%, #07312a 100%)'
  }),

  theme('light', '浅色·汇报', false, {})
]

export const DEFAULT_THEME = 'cockpit'

/* ------------------------------------------------------------------ *
 * 背景
 * 全部用纯 CSS 渐变 / SVG data-uri 画，不依赖外部图片，组件内联即可用。
 * ------------------------------------------------------------------ */

const svgUrl = (inner: string, w = 1200, h = 800) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${inner}</svg>`
  )}")`

const topoInner = `${Array.from({ length: 14 }, (_, i) => {
  const y = 40 + i * 56
  const d = `M0,${y} C 240,${y - 55} 420,${y + 55} 660,${y - 20} S 1040,${y + 60} 1200,${y - 30}`
  return `<path d='${d}' fill='none' stroke='rgba(120,170,255,${0.05 + (i % 4) * 0.028})' stroke-width='1.2'/>`
}).join('')}`

export const BACKGROUNDS: BackgroundPreset[] = [
  {
    id: 'cockpit',
    name: '驾驶舱',
    css:
      'radial-gradient(1400px 700px at 50% -14%, rgba(4, 132, 186, 0.30), transparent 62%), ' +
      'radial-gradient(1000px 760px at 4% 108%, rgba(4, 110, 160, 0.24), transparent 60%), ' +
      'radial-gradient(1000px 760px at 97% 104%, rgba(6, 150, 190, 0.20), transparent 60%), ' +
      'linear-gradient(rgba(90, 180, 255, .05) 1px, transparent 1px) 0 0 / 48px 48px, ' +
      'linear-gradient(90deg, rgba(90, 180, 255, .05) 1px, transparent 1px) 0 0 / 48px 48px, ' +
      'linear-gradient(180deg, #05101f 0%, #061524 55%, #04101c 100%)'
  },
  {
    id: 'midnight',
    name: '午夜',
    css:
      'radial-gradient(1200px 700px at 15% -10%, #1c2a52 0%, transparent 60%), ' +
      'radial-gradient(900px 600px at 90% 110%, #3b1d4e 0%, transparent 62%), ' +
      'linear-gradient(160deg, #0b0e17 0%, #111421 55%, #0a0c14 100%)'
  },
  {
    id: 'aurora',
    name: '极光',
    css:
      'radial-gradient(900px 500px at 10% 10%, rgba(34,197,94,.35) 0%, transparent 60%), ' +
      'radial-gradient(800px 520px at 85% 20%, rgba(59,130,246,.35) 0%, transparent 62%), ' +
      'radial-gradient(900px 600px at 60% 100%, rgba(168,85,247,.32) 0%, transparent 65%), ' +
      'linear-gradient(180deg, #05070d, #0b1220)'
  },
  {
    id: 'sunset',
    name: '晚霞',
    css:
      'radial-gradient(1000px 600px at 80% 0%, rgba(251,146,60,.42) 0%, transparent 58%), ' +
      'radial-gradient(900px 620px at 10% 100%, rgba(244,63,94,.34) 0%, transparent 60%), ' +
      'linear-gradient(180deg, #1a1024, #2a1428 60%, #100a16)'
  },
  {
    id: 'grid',
    name: '网格',
    css:
      'linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px) 0 0 / 34px 34px, ' +
      'linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px) 0 0 / 34px 34px, ' +
      'radial-gradient(900px 600px at 50% 0%, #16203a 0%, transparent 65%), #0a0d15'
  },
  {
    id: 'dots',
    name: '圆点',
    css:
      'radial-gradient(rgba(255,255,255,.09) 1.4px, transparent 1.4px) 0 0 / 22px 22px, ' +
      'linear-gradient(160deg, #0d1018, #141a2a)'
  },
  {
    id: 'topo',
    name: '等高线',
    // SVG 有固有尺寸(1200x800)，简写里必须显式给尺寸与 no-repeat，否则会平铺而不是铺满
    css: `${svgUrl(topoInner)} center / cover no-repeat`
  },
  {
    id: 'paper',
    name: '纸纹',
    css:
      'linear-gradient(180deg, rgba(255,255,255,.04), rgba(0,0,0,.22)), ' +
      'repeating-linear-gradient(90deg, rgba(255,255,255,.022) 0 1px, transparent 1px 44px), ' +
      'repeating-linear-gradient(0deg, rgba(255,255,255,.022) 0 1px, transparent 1px 44px), #12141c'
  },
  {
    id: 'mesh',
    name: '光斑',
    css:
      'radial-gradient(600px 420px at 20% 30%, rgba(79,140,255,.4), transparent 60%), ' +
      'radial-gradient(520px 420px at 75% 25%, rgba(139,92,246,.36), transparent 62%), ' +
      'radial-gradient(620px 460px at 45% 90%, rgba(14,165,233,.32), transparent 64%), #080a11'
  },
  { id: 'plain', name: '纯色', css: 'none' }
]

export const DEFAULT_BACKGROUND = 'cockpit'

/* ------------------------------------------------------------------ *
 * 默认清单
 * ------------------------------------------------------------------ */

/** 六种品牌色，用于头像/图标的 accent（与参考图一致：绿/琥珀/紫/青/蓝/红） */
export const ACCENT_SWATCH = ['#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#4f8cff', '#ef4444']

/**
 * 主题里的标签底色写成 rgba(...) 比较长，塞进设置面板那个窄输入框会被截断，
 * 这里转成等价的 8 位 hex（含 alpha），显示完整、CSS 也照样认。
 */
const rgbaToHex8 = (c: string): string => {
  const m = String(c || '').match(/rgba?\(([^)]+)\)/)
  if (!m) return c
  const p = m[1].split(',').map(v => parseFloat(v))
  const hx = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  const a = p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1
  return `#${hx(p[0])}${hx(p[1])}${hx(p[2])}${hx(a * 255)}`
}

/**
 * 状态标签「标签背景」的初始值。
 * 取默认深色主题的 tagBg —— 这样开箱的观感与不设覆盖时完全一致，
 * 面板上又有具体色值可调（平台 NewColorPicker 不接受空串）。
 */
export const DEFAULT_TAG_BACKGROUND = rgbaToHex8(DARK_BASE.tagBg)

/** 按主题取标签底色，新建智能体 / 升级旧配置时用作初始值 */
export const tagBackgroundOfTheme = (themeId: string): string => {
  const t = THEMES.find(x => x.id === themeId)
  return rgbaToHex8((t && t.vars.tagBg) || DARK_BASE.tagBg)
}

/** 头像可选项（emoji，避免依赖外部图片资源） */
export const AVATAR_OPTIONS = [
  '🌊', '🛡️', '🏭', '💧', '🌫️', '🔥', '⚡', '🚨', '🧭', '🗺️',
  '📊', '🧠', '🤖', '💬', '🛰️', '🌐', '📡', '🔍', '🚛', '🏗️'
]

/** 构造一条参数绑定，只用于下面默认清单的书写 */
const pb = (
  id: string,
  label: string,
  name: string,
  source: ParamSource,
  paramKey = '',
  value = ''
): ParamBinding => ({ id, label, name, source, paramKey, value, enabled: true })

/**
 * 默认智能体清单。
 * 每个智能体带自己的凭证与参数：
 *   apiKey/timeoutMs —— 属于各自的百炼应用，可各不相同（留空则回退全局网关的值）；
 *   参数 paramBindings —— source='public' 取大屏公共参数，source='static' 用固定值。
 * agentCode 留空是刻意的 —— 需用户在面板里填真实编码，发消息时会明确提示。
 */
export const DEFAULT_AGENTS: AgentItem[] = [
  {
    id: 'agent-flood',
    name: '防汛事件处置建议',
    description: '生成对应事件的处置建议方案',
    avatar: '🌊',
    accent: '#22c55e',
    apiKey: '',
    timeoutMs: 120000,
    stream: true,
    showThought: true,
    agentCode: '',
    agentVersion: '',
    welcome: '您好，这里是防汛事件处置建议，请描述需要处置的事件情况。',
    suggestions: ['当前汛情该如何处置？', '生成一份处置建议方案', '有哪些风险点需要重点防范？'],
    tagText: '',
    tagBackground: DEFAULT_TAG_BACKGROUND,
    enabled: true,
    paramBindings: [
      pb('flood-user', 'user', 'user', 'public', 'user'),
      pb('flood-area', 'areaCode', 'areaCode', 'public', 'areaCode'),
      pb('flood-channel', 'channel', 'channel', 'static', '', '大屏')
    ]
  },
  {
    id: 'agent-flood-review',
    name: '防汛事件评价复盘',
    description: '生成对应事件的评价复盘报告',
    avatar: '🛡️',
    accent: '#f59e0b',
    apiKey: '',
    timeoutMs: 180000,
    stream: true,
    showThought: true,
    agentCode: '',
    agentVersion: '',
    welcome: '您好，这里是防汛事件评价复盘，请提供需要复盘的事件信息。',
    suggestions: ['生成本次事件复盘报告', '处置过程有哪些不足？', '给出改进建议'],
    tagText: '',
    tagBackground: DEFAULT_TAG_BACKGROUND,
    enabled: true,
    paramBindings: [
      pb('review-user', 'user', 'user', 'public', 'user'),
      pb('review-event', 'eventId', 'eventId', 'public', 'eventId')
    ]
  },
  {
    id: 'agent-water',
    name: '水污染事件处置建议',
    description: '生成对应事件的处置建议方案',
    avatar: '💧',
    accent: '#a855f7',
    apiKey: '',
    timeoutMs: 120000,
    stream: true,
    showThought: true,
    agentCode: '',
    agentVersion: '',
    welcome: '您好，这里是水污染事件处置建议，请描述需要处置的事件情况。',
    suggestions: ['水污染事件如何处置？', '生成一份处置建议方案', '需要重点监测哪些指标？'],
    tagText: '',
    tagBackground: DEFAULT_TAG_BACKGROUND,
    enabled: true,
    paramBindings: [
      pb('water-user', 'user', 'user', 'public', 'user'),
      pb('water-area', 'areaCode', 'areaCode', 'public', 'areaCode'),
      pb('water-channel', 'channel', 'channel', 'static', '', '大屏')
    ]
  },
  {
    id: 'agent-water-trace',
    name: '水污染事件辅助溯源',
    description: '结合各类监测数据辅助溯源',
    avatar: '🔍',
    accent: '#06b6d4',
    apiKey: '',
    timeoutMs: 120000,
    stream: true,
    showThought: true,
    agentCode: '',
    agentVersion: '',
    welcome: '您好，这里是水污染事件辅助溯源，请提供监测点位与异常数据。',
    suggestions: ['如何缩小污染源范围？', '推荐布点监测方案', '分析可能的排污行业'],
    tagText: '建设中',
    tagBackground: DEFAULT_TAG_BACKGROUND,
    enabled: true,
    paramBindings: [
      pb('trace-user', 'user', 'user', 'public', 'user'),
      pb('trace-point', 'monitorPoint', 'monitorPoint', 'public', 'monitorPoint')
    ]
  },
  {
    id: 'agent-flood-report',
    name: '汛情简报生成',
    description: '按模板自动生成汛情简报',
    avatar: '📄',
    accent: '#4f8cff',
    apiKey: '',
    timeoutMs: 90000,
    stream: true,
    showThought: true,
    agentCode: '',
    agentVersion: '',
    welcome: '您好，这里是汛情简报生成，请提供需要汇总的汛情信息。',
    suggestions: ['生成今日汛情简报', '汇总未来 24 小时雨情', '生成领导汇报口径'],
    tagText: '',
    tagBackground: DEFAULT_TAG_BACKGROUND,
    enabled: true,
    paramBindings: [
      pb('report-user', 'user', 'user', 'public', 'user'),
      pb('report-channel', 'channel', 'channel', 'static', '', '大屏'),
      pb('report-date', 'reportDate', 'reportDate', 'public', 'reportDate')
    ]
  }
]

export const DEFAULT_MODELS: ModelItem[] = [
  {
    id: 'model-deepseek',
    name: 'Deepseek',
    description: '运用 Deepseek-V4.1-Flash 大模型回答问题',
    avatar: '🧠',
    accent: '#4f8cff',
    tagText: '',
    tagBackground: DEFAULT_TAG_BACKGROUND,
    welcome: '您好，我是 Deepseek，请描述您想了解的问题。',
    suggestions: ['帮我梳理一下当前事件的风险点', '给出一份处置建议', '总结上面的结论'],
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    system: '你是一个专业、严谨的助手，回答尽量简洁准确。',
    temperature: 0.7,
    /* R1（deepseek-reasoner）官方默认 32K、上限 64K；
       且它的 max_tokens 是「思考过程 + 正文」的合计额度 ——
       开「显示思考过程」时给小了会被思考吃光，正文直接空掉 */
    maxTokens: 32768,
    enabled: true,
    stream: true,
    showThought: true,
  },
  {
    id: 'model-qwen',
    name: '通义千问',
    description: '运用通义千问大模型回答问题',
    avatar: '🤖',
    accent: '#22c55e',
    tagText: '',
    tagBackground: DEFAULT_TAG_BACKGROUND,
    welcome: '您好，我是通义千问，请描述您想了解的问题。',
    suggestions: ['当前汛情该如何处置？', '生成一份处置建议方案', '有哪些风险点需要重点防范？'],
    model: 'qwen-turbo',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    apiKey: '',
    system: '你是一个专业、严谨的助手，回答尽量简洁准确。',
    temperature: 0.8,
    maxTokens: 1500,
    enabled: true,
    stream: true,
    showThought: true,
  }
]

/**
 * 百炼网关默认地址（政务外网）。
 * ★ 只有 baseUrl 与 paths 是真正全局共用的：
 *   APP_KEY 与超时已下沉到每个智能体（AgentItem.apiKey / timeoutMs），
 *   这里的 apiKey / timeoutMs 仅作兜底与旧配置迁移源，面板上不再直接展示。
 */
export const DEFAULT_GATEWAY = {
  baseUrl: 'http://23.210.227.35:23343/xlm-gateway-ftlzsf/sfm-api-gateway/gateway/agent/api',
  apiKey: '',
  timeoutMs: 120000,
  paths: {
    createSession: '/createSession',
    run: '/run',
    clearSession: '/clearSession',
    deleteSession: '/deleteSession',
    feedback: '/feedback',
    taskFinishNotice: '/taskFinishNotice'
  }
}
