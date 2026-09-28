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
│   └── pack.cjs                # 把 dist 打成带版本的交付 zip（零依赖 zip 写入）
└── src/
    ├── package/Decorates/Mores/BaiLianChatInYiTu/   # 组件本体（10 个文件）
    │   ├── index.ts            # 组件标识：key / chartKey / conKey、分类、标题
    │   ├── config.ts           # 默认 option（约 60 个配置项都在这里）
    │   ├── config.vue          # 设置面板（naive-ui，分组折叠）
    │   ├── index.vue           # 运行组件（对话界面，零 UI 库依赖）
    │   ├── api.ts              # 两种协议的请求、SSE 解析、<think> 标签拆分
    │   ├── markdown.ts         # 自研 Markdown 渲染器（零依赖，先转义再套格式）
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

## 五、已知边界

- 历史会话存在浏览器 localStorage，桶名 `bailian-chat-in-yitu:<实例id>`，
  换实例或清缓存后不会恢复；旧版本使用的 `agent-chat-e01:` 桶会在新桶为空时自动迁移一次。
- 直连大模型时没有百炼那套会话管理（createSession/deleteSession），历史只在本地。
- 最大 Token 面板上限开到 1048576，但各家模型有自己的上限
  （如 DeepSeek-R1 官方 64K），实际按模型规格填。

---

## 六、许可证

本项目以 **GPL-3.0** 协议开源，完整条款见 [`LICENSE`](./LICENSE)。

- 你可以自由使用、修改、分发，包括商用；
- 但任何再分发（含二次开发的衍生版本）必须同样以 GPL-3.0 开源，并保留署名；
- 本组件作为大屏里的一个插件被「调用」不构成衍生，但直接修改本组件代码后再分发即触发传染性条款。

署名与第三方说明见 [`NOTICE.md`](./NOTICE.md)。
