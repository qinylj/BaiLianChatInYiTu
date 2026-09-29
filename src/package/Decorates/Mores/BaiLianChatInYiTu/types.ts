/*
 * @Description: BaiLianChatInYiTu 类型定义
 */

/** 当前对话对象：百炼智能体 or 直连大模型 */
export type TargetKind = 'agent' | 'model'

/** 参数来源：取大屏公共参数 / 填静态值 */
export type ParamSource = 'public' | 'static'

/** 主题变量的 CSS 变量名（不含 -- 前缀） */
export interface ThemeVars {
  bg: string
  panel: string
  panelSolid: string
  panel2: string
  border: string
  borderStrong: string
  text: string
  textDim: string
  textFaint: string
  accent: string
  accent2: string
  accentSoft: string
  accentBorder: string
  accentGrad: string
  bubbleUser: string
  bubbleAi: string
  danger: string
  ok: string
  warn: string
  radius: string
  shadow: string
  glow: string
  headerGrad: string
  tagFg: string
  tagBg: string
  tagBd: string
}

/** 内置主题预设 */
export interface ThemePreset {
  id: string
  name: string
  /** 深色主题需要在容器上标注 data-theme-dark，用于内部个别对比度修正 */
  dark: boolean
  vars: ThemeVars
}

/** 内置背景预设 */
export interface BackgroundPreset {
  id: string
  name: string
  /** 直接赋给 background-image 的值；'none' 表示纯色 */
  css: string
}

/** 智能体（百炼） */
export interface AgentItem {
  id: string
  name: string
  description: string
  /** emoji 或图片地址 */
  avatar: string
  accent: string
  /**
   * 该智能体的 APP_KEY（百炼应用密钥）。
   * 网关「地址」是全局共用的，但每个智能体可能属于不同的百炼应用，
   * 所以密钥挂在智能体上；留空时回退到全局网关的 apiKey。
   */
  apiKey: string
  /** 该智能体的请求超时（ms），留空/为 0 时回退到全局网关的 timeoutMs */
  timeoutMs: number
  /**
   * 该智能体是否流式输出（边生成边出字）。
   * 每个对象各配各的：有的智能体返回快、整包返回更稳，有的必须流式才不超时。
   * 未配置（undefined）时回退到全局 option.stream（旧配置的迁移源）。
   */
  stream?: boolean
  /**
   * 该智能体是否显示思考过程。
   * 关掉只是不渲染，思考内容仍会照常累积到消息上 —— 重新打开就能看到历史那几轮。
   * 未配置（undefined）时回退到全局 option.showThought（旧配置的迁移源）。
   */
  showThought?: boolean
  agentCode: string
  agentVersion: string
  /** 欢迎语（面板上叫「欢迎语」，早期版本叫「开场白」）：欢迎页正文为空时用它兜底 */
  welcome: string
  /** 预设问题：面板上每行一条 */
  suggestions: string[]
  /** 状态标签，空串表示不显示 */
  tagText: string
  /**
   * 状态标签的底色（覆盖主题里的 --ac-tag-bg）。
   * 默认取「当前主题」的标签底色，所以不调也能保持与主题一致；
   * 调过则只影响这一个智能体。
   * ⚠️ 平台 NewColorPicker 不接受空串，因此这里永远给合法颜色值。
   */
  tagBackground: string
  enabled: boolean
  /**
   * 该智能体单独传给百炼的参数（放进 run 接口的 message.metadata）。
   * 每个智能体业务不同，需要的参数也不同，所以参数挂在智能体上而不是全局。
   */
  paramBindings: ParamBinding[]
}

/** 大模型（OpenAI 兼容接口） */
export interface ModelItem {
  id: string
  name: string
  description: string
  avatar: string
  accent: string
  /**
   * 状态标签，空串表示不显示。
   * 与 AgentItem 同构：大模型和智能体在侧栏里是同一种"对话对象"，
   * 视觉上应该能表现同样的状态（建设中 / 已上线 / 灰度 等）。
   */
  tagText: string
  /** 状态标签底色，语义同 AgentItem.tagBackground（永远给合法颜色值） */
  tagBackground: string
  /** 欢迎语（原「开场白」）：欢迎页正文为空时用它兜底 */
  welcome: string
  /** 预设问题：欢迎页 suggestionList 为空时用它兜底 */
  suggestions: string[]
  model: string
  baseUrl: string
  apiKey: string
  system: string
  temperature: number
  maxTokens: number
  enabled: boolean
  /**
   * 该模型是否流式输出（边生成边出字）。
   * 与智能体同构：按对象配置，未配置（undefined）时回退到全局 option.stream。
   */
  stream?: boolean
  /**
   * 该模型是否显示思考过程（OpenAI 兼容取 delta.reasoning_content）。
   * 与智能体同构：按对象配置，未配置（undefined）时回退到全局 option.showThought。
   */
  showThought?: boolean
}

/** 传给百炼智能体的参数绑定 */
export interface ParamBinding {
  id: string
  /** 面板上的显示名（也是徽章上显示的键名） */
  label: string
  /** 真正传给智能体的键名 */
  name: string
  source: ParamSource
  /** source=public 时，取哪个大屏公共参数 */
  paramKey: string
  /** source=static 时使用的固定值 */
  value: string
  enabled: boolean
}

/** 随消息一起发出的附件（本地选择的文件） */
export interface ChatAttachment {
  id: string
  name: string
  /** 字节数，用于展示体积 */
  size: number
  /** MIME 类型，可能为空串（部分系统给不出） */
  type: string
  /**
   * 图片且体积较小时的 dataURL 预览。
   * 大文件不生成 —— 会话要落 localStorage，塞大体积 base64 会把配额撑爆。
   */
  preview?: string
}

/** 一条消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 思考过程（thought.delta 累积） */
  thought: string
  timestamp: number
  error: boolean
  pending: boolean
  requestId: string
  taskId: string
  vote: '' | 'LIKE' | 'DISLIKE'
  /** 本条消息携带的附件（目前只有用户消息会带） */
  attachments?: ChatAttachment[]
}

/** 一轮会话 */
export interface Conversation {
  id: string
  title: string
  targetKind: TargetKind
  targetId: string
  targetName: string
  sessionId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

/** 网关配置 */
export interface GatewayPaths {
  createSession: string
  run: string
  clearSession: string
  deleteSession: string
  feedback: string
  taskFinishNotice: string
}

export interface GatewayOption {
  /** 网关基址：所有智能体共用同一个 */
  baseUrl: string
  /**
   * 兜底 APP_KEY。
   * 正常应从 AgentItem.apiKey 取（每个智能体可不同），这里只在智能体没填时兜底，
   * 同时作为旧版本配置迁移时的一次性来源。
   */
  apiKey: string
  /** 兜底超时（ms），语义同 apiKey */
  timeoutMs: number
  paths: GatewayPaths
}

/** 大屏公共参数行（平台注入） */
export interface PublicParamRow {
  id?: string
  name: string
  content?: any
  variableType?: number
}

/** 组件拿到的公共参数 store */
export interface GlobalParamsLike {
  params?: Record<string, any>
  setParam?: (param: string, value: any) => void
  getParam?: (param: string) => any
  removeParam?: (param: string) => void
}

/** 组件拿到的事件总线 */
export interface EventBusLike {
  on: (eventName: string, callback: (data: any) => void) => void
  emit: (eventName: string, data: any) => void
  off: (eventName: string) => void
}

/** SSE 解析出的一块增量 */
export interface StreamChunk {
  /** 正文增量 */
  text: string
  /** 思考过程增量 */
  thought: string
  /**
   * 出现了「只有 </think>、没有 <think>」的游离闭合标签。
   * 这种输出里，闭合标签**之前**已经当成正文流出去的内容其实全是思考过程；
   * 流式下无法回头改已渲染的文本，所以由上层按此标记把已累积的正文挪进思考块。
   */
  strayClose?: boolean
  /** 图片地址 */
  image: string
  /** 是否结束 */
  end: boolean
  /** 错误信息 */
  error: string
  requestId: string
  taskId: string
  usage: any
}
