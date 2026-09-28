/*
 * @Description: BaiLianChatInYiTu 默认配置
 */
import { PublicConfigClass } from '../../../public/index'
import { CreateComponentType } from '../../../index.d'
import { BaiLianChatInYiTuConfig } from './index'
import cloneDeep from 'lodash/cloneDeep'
import { chartInitConfig } from '@/package/config/const'
import { CustomFnType } from '@/types/event.d'
import {
  DEFAULT_AGENTS,
  DEFAULT_BACKGROUND,
  DEFAULT_GATEWAY,
  DEFAULT_MODELS,
  DEFAULT_THEME
} from './presets'
import { AgentItem, ModelItem, ParamBinding } from './types'

/** 默认传给智能体的参数：一个取大屏公共参数，一个填静态值 */
export const DEFAULT_PARAM_BINDINGS: ParamBinding[] = [
  {
    id: 'param-user',
    label: 'user',
    name: 'user',
    source: 'public',
    paramKey: 'user',
    value: '',
    enabled: true
  },
  {
    id: 'param-channel',
    label: 'channel',
    name: 'channel',
    source: 'static',
    paramKey: '',
    value: '大屏',
    enabled: true
  }
]

export const option = {
  /* ---------------- 文案 / 品牌 ---------------- */
  title: 'AI对话',
  brandIcon: '🤖',
  connectedText: '已连接网关',
  /** 顶栏在「已建立会话」时展示的兜底文案，实际优先用当前对话对象的名字 */
  idleText: '未建立会话（首轮自动创建）',
  /** 大模型是直连 /chat/completions，根本没有会话号，不能沿用上面那句（会一直显示"首轮自动创建"） */
  directText: '大模型直连（无会话）',
  runningText: '正在生成…',
  readyText: '就绪',
  stopText: '停止',
  exportText: '导出',
  /** 导出格式：html=渲染后的排版（默认）/ txt=渲染后的纯文本 / md=Markdown 原文 /
   *  docx=Word 文档（默认按党政机关公文格式排版） */
  exportFormat: 'html',
  /** 消息级导出按钮：显示在每条回答脚注的「重答」旁边，导出单条内容 */
  showMsgExport: true,
  exportWordText: '导出 Word（公文格式）',
  exportTxtText: '导出 TXT（渲染后的纯文本）',
  /** 导出的是渲染**前**的 Markdown 源码，一个字符都不改，留给二次加工 / diff */
  exportMdText: '导出 Markdown 原文（渲染前）',
  /**
   * Word 排版预设：
   *   gongwen —— 党政机关公文格式：页边距上 3.5 / 下 2.9 / 左 2.55 / 右 2.55 cm、
   *              页眉 1.5 / 页脚 2.6 cm、正文方正仿宋_GBK 三号、行距固定值 29.7 磅、
   *              **所有段落一律首行缩进 2 字符**（不悬挂、不用"文本之前"的左缩进）、
   *              标题方正小标宋_GBK 二号居中、**标题与副标题段前段后均为 0 行**、
   *              副标题（「（2025-2027年）」这类整行带括号的）方正楷体_GBK 三号居中、
   *              层次序数一、/（一）/1./（1）依次方正黑体_GBK / 方正楷体_GBK / 方正仿宋_GBK、
   *              页脚页码「— 1 —」宋体四号、行距固定值 15 磅、文本前后各空 1 字符，
   *              **双面打印**（单页居右、双页居左）；
   *              无序列表不带项目符号、有序列表写作「1.内容」、表格后不留空行；
   *              **只有数字和字母用 Times New Roman**，汉字、标点、符号一律用该层次的
   *              字体或正文字体（页码是规范里的专门规定，整行宋体，不参与这条分流）
   *   plain   —— 普通文档：1 英寸页边距、小四宋体、1.5 倍行距
   */
  docxPreset: 'gongwen',
  /** 公文标题字体。留空用预设的「方正小标宋_GBK」（该字体需自行安装，未装时 Word 会自动回退） */
  docxTitleFont: '',
  placeholder: '输入消息，Enter 发送 / Shift+Enter 换行',
  inputHint: '界面由长寿区委改革办数建科设计，以GPL-3.0协议开源',
  emptyHistoryText: '暂无历史对话',
  emptyListText: '未配置',
  sectionModelText: '大模型',
  sectionAgentText: '智能体',
  sectionHistoryText: '历史对话',
  newChatText: '新建',

  /* ---------------- 显隐开关 ---------------- */
  showSidebar: true,
  showSidebarToggle: true,
  showModelSection: true,
  showAgentSection: true,
  showHistorySection: true,
  showTopbar: true,
  showParamBar: true,
  showBrand: true,
  showAvatars: true,
  showTime: true,
  showSuggestions: true,
  showFeedback: false,
  showActions: true,
  showNewChatBtn: true,
  /** 对话前内容区（欢迎页）的三个元素开关，与 showSuggestions 同组 */
  showWelcomeIcon: true,
  showWelcomeTitle: true,
  showWelcomeText: true,

  /* ---------------- 外观 ---------------- */
  theme: DEFAULT_THEME,
  /** 主题覆盖：空串表示跟随预设，不覆盖 */
  /**
   * 主题自定义覆盖
   * ★ 平台 NewColorPicker 在卸载时会无条件执行 Color(props.value)，
   *   空字符串会抛 "Unable to parse color from string"。
   *   因此色值字段一律给合法默认色，用 use 开关控制是否真正生效，
   *   而不是靠"空串"表达"不覆盖"。
   */
  themeOverride: {
    use: false,
    accent: '#3a89ff',
    accent2: '#6fabff',
    text: '#e8f2ff',
    bg: '#0b1220',
    radius: '10px'
  },
  background: DEFAULT_BACKGROUND,
  /** 自定义背景图（优先于预设） */
  backgroundImage: '',
  /** 背景遮罩浓度 0-100 */
  backgroundVeil: 45,
  /** 背景模糊 px */
  backgroundBlur: 0,
  /** 整体缩放 */
  scale: 1,
  /** 输入区字体大小 px —— 只作用在输入框里的文字（面板：基础 → 对话区 → 输入区设置） */
  fontSize: 13,
  /** 对话区字体大小 px —— 作用在消息气泡与欢迎页正文（面板：基础 → 对话区 → 对话内容区） */
  chatFontSize: 12.5,
  /** 侧栏宽度 px */
  sidebarWidth: 268,

  /* ---------------- 内容 ---------------- */
  /** 当前对话对象：agent=百炼智能体，model=直连大模型 */
  targetKind: 'agent' as 'agent' | 'model',
  /** 空 = 取清单里第一个启用的 */
  targetId: '',
  /** 为空时用当前对话对象的 welcome / suggestions */
  welcomeTitle: '',
  welcomeText: '',
  suggestions: [] as string[],

  /* ---------------- 网关（只有地址与路径是全局的） ----------------
   * APP_KEY 与超时已下沉到每个智能体（AgentItem.apiKey / timeoutMs），
   * 每个智能体可以属于不同的百炼应用，因此各配各的。
   * 这里保留的 apiKey / timeoutMs 仅作兜底（智能体没填时生效），
   * 同时是旧版本配置迁移时的一次性来源。
   */
  gateway: cloneDeep(DEFAULT_GATEWAY),

  /* ---------------- 清单 ---------------- */
  agents: cloneDeep(DEFAULT_AGENTS) as AgentItem[],
  models: cloneDeep(DEFAULT_MODELS) as ModelItem[],

  /* ---------------- 参数传递 ----------------
   * 参数已下沉到每个智能体（见 AgentItem.paramBindings），
   * 这里的全局 paramBindings 仅作为「旧版本配置迁移源」保留：
   * ensureOption 时若某个智能体还没有自己的参数，就把这份复制过去。
   * 面板上不再展示，运行时也不再直接读取。
   */
  paramBindings: cloneDeep(DEFAULT_PARAM_BINDINGS) as ParamBinding[],
  /** 参数挂在 message.metadata 下（百炼 run 接口的扩展字段） */
  paramTarget: 'metadata' as 'metadata' | 'both',

  /* ---------------- 会话 ---------------- */
  stream: true,
  /**
   * 显示思考过程（面板：基础 → 对话设置 → 显示思考过程，排在「流式输出」上方）。
   * 两种协议都能给到思考过程：OpenAI 兼容取 delta.reasoning_content，
   * 百炼取 object/type 含 thought 的分片（见 api.ts 的 extractOpenAIChunk / extractBailianChunk）。
   * 关掉后只是不渲染，仍会照常累积到消息上 —— 重新打开就能看到历史那几轮的思考。
   */
  showThought: true,
  /** localStorage 持久化历史会话 */
  persistHistory: true,
  /** 最多保留多少条历史 */
  maxHistoryCount: 30,
  /** 首轮自动创建会话 */
  autoCreateSession: true,
  /** 上下文携带的历史消息条数 */
  contextLimit: 10
}

export default class Config extends PublicConfigClass implements CreateComponentType {
  public key = BaiLianChatInYiTuConfig.key
  public attr = { ...chartInitConfig, w: 900, h: 620, zIndex: -1 }
  public chartConfig = cloneDeep(BaiLianChatInYiTuConfig)
  public option = cloneDeep(option)
  // 自定义事件：由组件内 emit，平台「交互事件」里可选
  public event: Array<CustomFnType> = [
    { name: '组件加载完成', fnName: 'finishedFn' },
    { name: '切换对话对象', fnName: 'targetChange', keys: ['kind', 'id', 'name'] },
    { name: '发送消息', fnName: 'ask', keys: ['text'] },
    { name: '收到回复', fnName: 'reply', keys: ['text', 'sessionId'] },
    { name: '发生错误', fnName: 'error', keys: ['message'] }
  ]
}
