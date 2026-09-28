# BaiLianChatInYiTu

> 仓库地址：[GitHub](https://github.com/qinylj/BaiLianChatInYiTu) · [Gitee 镜像](https://gitee.com/qinylj/BaiLianChatInYiTu)

驾驶舱可视化低代码平台的（翼图yitu）**AI 对话自定义组件**（装饰 → 更多 → 「AI对话」）。
一个组件同时接两类后端：

- **阿里云百炼智能体**（网关协议：`createSession` / `run` / `clearSession` / `deleteSession` / `feedback` / `taskFinishNotice`）
- **OpenAI 兼容大模型**（`/v1/chat/completions`，已内置 DeepSeek、通义千问预设，也可自建）

同时开源配套的**设置面板调试台**，不用进平台就能调组件的全部配置项。

> 界面由长寿区委改革办数建科设计，以 GPL-3.0 协议开源。

---

## 一、它能做什么

**对话能力**

- 流式输出（SSE），边生成边渲染；生成中发送键变停止键，可随时中断
- 支持**思考过程**：OpenAI 兼容取 `delta.reasoning_content`，百炼取 object/type 含 `thought` 的分片；
  生成中自动展开、完成后折叠；关掉只是不渲染，重新打开仍能看到历史轮次的思考
- **思考过程写在正文里也认**：有些模型经网关转发后不填 `reasoning_content`，
  而是直接输出 `<think>…</think>真正的回答`。组件会把标签里的内容自动挪进思考块，
  标签被流式切断（`<thi` + `nk>`）也能正确识别；只有 `</think>` 没有 `<think>` 时，
  闭合标签之前的那段同样归入思考
- **正文按 Markdown 渲染**：标题、有序/无序列表（可嵌套）、引用、分割线、代码块、
  表格、加粗/斜体/删除线、行内代码、链接、图片。自研渲染器零依赖（见 `markdown.ts`），
  **先转义再套格式**，模型输出里带 HTML 只会按字面显示，不会被当标签执行；
  流式下半截语法（未闭合的 ``` 、半个 `**`）也不会把符号当正文吐出来
- 首轮自动创建会话；上下文可携带指定条数的历史消息
- 消息操作：复制 / 点赞 / 点踩 / 重新回答（hover 显示，按角色左右对齐）
- **复制的是渲染后的内容，不是 Markdown 原文**：剪贴板里同时写入富文本与纯文本两个形态 ——
  粘到 Word / 邮件还是标题、列表、表格、加粗；粘到记事本 / 输入框则没有 `**`、`|` 这些符号
  （大屏跑在 http 下没有 Clipboard API，走的是"选中隐藏容器 + execCommand"，实测两种形态都在）
- **导出也按渲染后的样子出**：默认 `.html` 单文件（能直接打开，也能直接粘进 Word），
  可选 `.txt`（去语法符号，带 BOM，Windows 记事本不乱码）或 `.md`（源码留档）
- **单条回答可一键导出 Word / TXT / Markdown 原文**（按钮在「重答」旁边）：
  - **Word 默认按党政机关公文格式排版**：页边距上 3.5 / 下 2.9 / 左 2.55 / 右 2.55 cm，
    正文方正仿宋_GBK 三号，**行距固定值 29.7 磅**（版心 159 × 233 mm，一页正好排 22 行），
    首行缩进 2 字符，标题方正小标宋_GBK 二号居中，页脚「— 1 —」页码；
    正文的**层次按行首序数**自动换字体 ——「一、」方正黑体_GBK、「（一）」方正楷体_GBK、
    「1.」与「（1）」方正仿宋_GBK（与正文同），序数可以越级使用；
    标题下面紧跟的、整行被圆括号包住的一块（如「（2025-2027年）」）当作**副标题**，
    用方正楷体_GBK 三号居中排在标题正下方；
    公式里只有一条缩进口径：**所有段落（标题、正文、列表项、引用）都是首行缩进 2 字符** ——
    不做悬挂缩进、也不用"文本之前"的左缩进；无序列表**不带项目符号**（公文靠 `一、`/`（一）`/`1.`
    分层次，不靠 `·`/`-`），有序列表保留 `1.` 但序号后不留空格；Markdown 表格后面的那个空行
    不会落成一个空段落（否则 Word 里就是可见的一整行空白）；
    Markdown 表格落成 **Word 真表格**（表头跨页自动重复、列宽按内容分配、
    总宽正好铺满版心，不会因为某列内容长就把版心撑歪）。也可切换成「普通文档」预设
  - **标题块按原文顺序落位**：模型常先写一句引语（「以下是为…：」）再上正文标题，
    那句话原位留在**标题上面**、用正文的字体字号，不会被标题挤到后面去
  - **TXT 就是渲染后的纯文本**（带 BOM + CRLF）：不做结构转换，永远不丢内容，是"先存下来再说"的出口
  - **MD 是渲染前的原数据**：与模型返回的 Markdown **逐字节相同**（不转结构、不改换行、不加 BOM），
    留给二次加工 / diff / 喂给别的工具
  - 三种格式都是**浏览器里现场生成**：Word 走零依赖手写 zip + OOXML（见 `zip.ts` / `docx.ts`），
    不走服务端、不引第三方 Office 库 —— 运行组件是要跟着大屏一起加载的
  - 排版细节一：模型爱写的"一句一行"短句（Markdown 里属同一段落、Word 里是**手动换行符** Shift+Enter）
    会被换成**回车** —— 每行独立成段，于是段落仍可两端对齐，且不会出现「应　急　指　挥　部」这种
    字距被拉开的排版事故（Word 的两端对齐只放过每段最后一行，手动换行符只结束"行"不结束"段落"）。
    代码块例外：它的换行是内容本身的结构，仍留在同一段落里
  - 排版细节二：Markdown 分割线 `---` 直接丢弃，不在公文里凭空画一条横线
  - 排版细节三：模型用空格摆版式留下的**多余空格会被清掉**（`总指挥：   企业主要负责人`、
    `第一章　　总则`），但中英文之间、数字前后的空格是正常写法（`依据 GB/T 9704 标准`、`共 30 人`），
    行内代码里的空格更是内容 —— 一律不动。
    另外两类容易漏的也一并处理了：**中文标点旁边的空格**（`打造 “数字长寿” 品牌` 里空格贴着弯引号，
    光按"汉字之间去空格"清不掉）与**层次序数后的空格**（`1. 算力网络` → `1.算力网络`，
    公文里序号与文字之间本来就不留空格）
  - 排版细节四：**emoji 图标不进导出物**（`✅ 政务服务：…` → `政务服务：…`）。
    但**箭头和几何图形留着** —— `→`、`●` 在中文技术文里是承载语义的符号，删掉就把意思改坏了。
    **MD 导出是唯一例外**，那里给的是渲染前的原数据，一个字符都不改；屏幕上正在显示的那份也不动
- 输入区支持附件入口（聚焦时出现）、Enter 发送 / Shift+Enter 换行

**左侧栏**

- 三块内容：大模型、智能体、历史对话，高度按 **2 : 4 : 4** 分配，条目多了各自内部滚动，不会互相挤占
- 历史会话存 localStorage（可关），最多保留 30 条，删除需二次确认（行内确认条，支持 Esc 取消）
- 每一块都能单独显隐，侧栏整体可收起

**多对象与参数**

- 智能体和模型都是清单式配置，可各自配 **API Key、超时、欢迎语、推荐问题、角标**
  （密钥下沉到每个对象，不同对象可以属于不同的百炼应用）
- 参数绑定：每个智能体可挂自己的参数，来源支持「大屏公共参数」或「静态值」，
  最终挂在 `message.metadata` 下发

**外观**

- 4 套主题预设 + 自定义覆盖（主色、文字色、背景色、圆角）
- 背景：预设底图 / 自定义图片 / 遮罩浓度 / 模糊
- 整体缩放、输入区字号、对话区字号、侧栏宽度独立可调
- 几乎所有元素都有显隐开关（顶栏、品牌区、参数栏、时间戳、推荐问题、反馈按钮等）

**对外事件**（平台「交互事件」里可选）

| 事件 | 说明 | 回调参数 |
| --- | --- | --- |
| `finishedFn` | 组件加载完成 | — |
| `targetChange` | 切换对话对象 | `kind`, `id`, `name` |
| `ask` | 发送消息 | `text` |
| `reply` | 收到回复 | `text`, `sessionId` |
| `error` | 发生错误 | `message` |

**工程实现上的两个刻意设计**

1. 运行组件 `index.vue` **零 UI 库依赖**（只用 `vue`），naive-ui 仅出现在设置面板侧，
   保证打进大屏的产物体积可控；
2. 组件按面板尺寸自适应，不跟随平台等比缩放（`noScale: true`）。

---

## 二、仓库里有什么

```
BaiLianChatInYiTu/
├── README.md
├── LICENSE                     # GPL-3.0 全文
├── NOTICE.md                   # 署名与第三方说明
├── .gitignore
├── integration/
│   ├── README.md               # 放进宿主工程的集成步骤
│   └── yitu-base-components.patch   # 对宿主工程的全部改动（7 文件）
├── build/
│   └── version.js              # 版本号唯一数据源 + 自增 + 构建戳（新增文件）
├── tools/
│   ├── bump-version.cjs        # 版本号命令行：查看 / 自增 / 指定
│   ├── pack.cjs                # 把 dist 打成带版本的交付 zip（零依赖 zip 写入）
│   ├── verify-export-text.cjs  # 静态自检：复制/导出用的"渲染后文本"+ 空格/emoji 清理（108 项，无需浏览器）
│   ├── verify-copy-clipboard.cjs  # 真浏览器自检：剪贴板里到底是渲染后内容还是 Markdown 原文
│   ├── verify-office-export.cjs   # 导出自检（146 项：行内交叉一致性 / 排版回归 / 层次序数 / 标题块 / 版面 / zip / 编排）
│   ├── verify_ooxml.py            # Python 标准库独立复验产物（142 项：zipfile 验 CRC、ElementTree 验 XML）
│   ├── verify-office-download.cjs # 真浏览器自检：点导出按钮后磁盘上是否真的出现文件（55 项）
└── src/
    ├── package/Decorates/Mores/BaiLianChatInYiTu/   # 组件本体（16 个文件）
    │   ├── index.ts            # 组件标识：key / chartKey / conKey、分类、标题
    │   ├── config.ts           # 默认 option（约 65 个配置项都在这里）
    │   ├── config.vue          # 设置面板（naive-ui，分组折叠）
    │   ├── index.vue           # 运行组件（对话界面，零 UI 库依赖）
    │   ├── api.ts              # 两种协议的请求、SSE 解析、<think> 标签拆分
    │   ├── markdown.ts         # 自研 Markdown 解析（零依赖）：HTML / 纯文本 / 结构化块三种出口 + 空格清理
    │   ├── clipboard.ts        # 复制：富文本 + 纯文本双形态，非安全上下文有兜底
    │   ├── zip.ts              # 零依赖 ZIP 写入器（.docx 就是 zip 包，只用 stored 模式）
    │   ├── ooxml.ts            # OOXML 公共工具：XML 转义与非法字符清理、mm/pt/字号换算、part 拼装
    │   ├── docx.ts             # Word 生成：公文版式常量、层次序数 → 字体、Markdown 块 → 段落/表格
    │   ├── download.ts         # 存盘：Blob + <a download>（非安全上下文也能用）
    │   ├── exporter.ts         # 导出内容构造：html / txt / md / docx（含文档标题取名规则）
    │   ├── presets.ts          # 主题 / 背景 / 默认智能体 / 默认模型 / 默认网关
    │   ├── types.ts            # 类型定义
    │   ├── data.json           # 组件默认数据
    │   └── export.ts           # 打包导出
    └── demo/
        └── SettingsVue.vue     # 设置面板调试台页面
```

调试台长这样：左列渲染真实 `index.vue`，右列渲染真实 `config.vue`
（宽度按平台真实比例 15.83% 还原，保证换行/挤压程度与线上一致），
底部四个卡片：实例参数 · option 实时 JSON · 参数下发 · 事件日志。

---

## 三、怎么用

⚠️ 本仓库**不能独立运行**，它是宿主工程的插件。请先按
[`integration/README.md`](./integration/README.md) 把文件放进
`yitu_base_components` 工程（上游：https://gitee.com/kaixiang594084296/yitu_base_components ，
未附带开源许可证，需自行获取）。

简述三步：

```bash
# 1. 复制组件目录与调试台
cp -r src/package/Decorates/Mores/BaiLianChatInYiTu/  <工程>/src/package/Decorates/Mores/
cp    src/demo/SettingsVue.vue                        <工程>/src/demo/
# 2. 在 <工程>/src/router/index.ts 注册 /settings 路由（见 integration/README.md 第 2 节）
# 3. 重启 dev server（组件清单是启动时快照），打开 http://localhost:8085/settings
```

出生产包：

```bash
set COMP_NAME=BaiLianChatInYiTu && npm run build
# 产物：<工程>/dist/BaiLianChatInYiTu@1.0.1.js + .css
```

版本号会自动管（自增机制见 [`integration/README.md`](./integration/README.md) 第 4 节）：

```bash
npm run release      # 版本号 +1 → 编译 → 打包 zip，一条命令出交付物
npm run ver          # 只看当前版本号，不改动
npm run pack         # 已编译过，只想重新打 zip
```

编译日志里会打印本次的版本号、构建戳和部署路径；产物运行时把版本写进根节点
`data-build` 属性并打一行控制台日志，用来确认大屏上跑的是哪一次编译。

环境要求：Node 16+ / vue 3.2.27 / naive-ui 2.42.0（仅面板）/ lodash。

---

## 四、接入配置速查

配置项都在设置面板里，这里只列必须先填的：

| 位置 | 项 | 说明 |
| --- | --- | --- |
| 参数 tab | 网关地址 `baseUrl` | 百炼网关根地址，paths 一般不用改 |
| 参数 tab | 各智能体的 `agentCode` | 百炼应用编码，留空发消息时会明确提示 |
| 智能体 tab | `apiKey` | 每个智能体各自的 APP_KEY，面板上是密码框 |
| 大模型 tab | `baseUrl` / `model` / `apiKey` | 直连 OpenAI 兼容模型时用 |
| 对话设置 | 最大 Token | 默认 32768。**注意 DeepSeek-R1 的 `max_tokens` 是「思考 + 正文」合计额度**，开思考过程时给小了正文会空 |

面板顶部有「显示思考过程」「流式输出」开关；历史对话持久化、上下文条数、首轮自动建会话
都在「对话设置」组里。

---

## 五、自检怎么跑

组件的每条链路都有对应的自检，都**不需要先编译**（脚本自己用 `@babel/core`
把 TS 现场转成可执行代码），也不需要 webpack dev server：

```bash
node tools/verify-export-text.cjs        # 复制/导出用的"渲染后文本" + 空格/emoji 清理，108 项，纯 Node
node tools/verify-office-export.cjs      # Word 生成 / 排版回归 / 层次序数 / 标题块 / 版面 / TXT / MD，146 项 + Python 交叉验证 142 项
node tools/verify-office-download.cjs    # 真浏览器：点三个按钮 → 磁盘上出现三个文件，55 项
node tools/verify-copy-clipboard.cjs     # 真浏览器剪贴板载荷（无头 9 项 / CHROME_UI=1 共 20 项）
```

两个说明：

- `verify-office-export.cjs` 会调用 `tools/verify_ooxml.py`，用 **Python 标准库**把产物独立验一遍
  （`zipfile` 算 CRC、`ElementTree` 解析 XML）。这一步不是多余的：自己写的 zip 头和自己的解析器
  可能"一起错"，必须让另一套实现来读。没装 Python 时用 `BL_PY=<python 路径>` 指定。
- 两个浏览器自检会各自起一个临时静态服务与 Chrome 实例（端口 8097 / 8099 与 9331 / 9333，
  可用 `TEST_PORT` / `CDP_PORT` 覆盖），跑完自动清理。**别用 `spawnSync` 改成同步** ——
  某些受限环境里同步 spawn 会直接报 `EBUSY`，异步没问题。

## 六、已知边界

- 历史会话存在浏览器 localStorage，桶名 `bailian-chat-in-yitu:<实例id>`，
  换实例或清缓存后不会恢复；旧版本使用的 `agent-chat-e01:` 桶会在新桶为空时自动迁移一次。
- 直连大模型时没有百炼那套会话管理（createSession/deleteSession），历史只在本地。
- 最大 Token 面板上限开到 1048576，但各家模型有自己的上限
  （如 DeepSeek-R1 官方 64K），实际按模型规格填。
- **导出公文时的字体依赖本机安装**：标题用的「方正小标宋_GBK」、正文用的「方正仿宋_GBK」、
  层次用的「方正黑体_GBK / 方正楷体_GBK」（方正 GBK 系列）都是公文字体的标准叫法，
  但**不是 Windows 自带字体**。没装的话 Word 会自动回退成默认字体，文档打开是正常的，
  只是字体不是小标宋 / 仿宋。面板里可以把标题字体改成「黑体」这类随系统自带的字体。
- 导出的 `.docx` 内部的 zip **不压缩**（stored），文件偏大（公文量级几十到几百 KB）。
  这是为了避开 `CompressionStream` 的异步链路，换取导出全程同步、任何浏览器都能跑。
- 单条回答导出的 Word / TXT / MD **共用同一套标题取名规则**（正文首个标题 > 首段前 24 字 >
  「文档」），所以同一个回答导出的三个文件前缀是一样的。
- **改 Word 排版时请连带跑一遍自检**：`verify-office-export.cjs` 里有一条不变式 ——
  「任何两端对齐（`w:jc=both`）的段落里都不许有 `<w:br/>`」。这不是洁癖：Word 的两端对齐
  只放过**段落最后一行**，而手动换行符只结束"行"不结束"段落"，一旦带 `\n` 的文本被直接
  丢进段落生成器，模型爱写的那句一行短句就会被拉成「应　　急　　指　　挥　　部」。
  新增"文本里可能带 `\n`"的块类型时，必须走 `docx.ts` 的 `splitLines` 拆成独立段落
  （代码块是唯一的例外：它的换行是内容本身的结构）。

---

## 七、许可证

本项目以 **GPL-3.0** 协议开源，完整条款见 [`LICENSE`](./LICENSE)。

- 你可以自由使用、修改、分发，包括商用；
- 但任何再分发（含二次开发的衍生版本）必须同样以 GPL-3.0 开源，并保留署名；
- 本组件作为大屏里的一个插件被「调用」不构成衍生，但直接修改本组件代码后再分发即触发传染性条款。

署名与第三方说明见 [`NOTICE.md`](./NOTICE.md)。
