# 集成说明：把组件装进 yitu_base_components 工程

本仓库**只包含我们自己写的部分**：AI 对话组件本体 + 设置面板调试台。
它不能独立运行，需要放进驾驶舱低代码平台的基础组件工程里编译。

## 0. 关于上游工程

- 工程名称：CoolV-comps 可视化低代码插拔式 vue3 组件库 - webpack
- 上游地址：https://gitee.com/kaixiang594084296/yitu_base_components
- **上游未附带任何开源许可证文件**，因此本仓库不搬运上游代码，只提供我们新增的文件与一个补丁。
  请先自行获取该工程，再按下面步骤集成。

## 1. 放组件（必须）

```
本仓库 src/package/Decorates/Mores/BaiLianChatInYiTu/  →  <工程>/src/package/Decorates/Mores/BaiLianChatInYiTu/
```

组件被工程自动扫描注册（分类：装饰 → 更多，标题「AI对话」）。
注意：`COMPONENT_LIST` 是 dev server **启动时**的快照，**新增或重命名目录后必须重启 dev server**，
否则页面里找不到该组件。

组件内部依赖（都是工程里已有的）：

| 文件 | 外部依赖 |
| --- | --- |
| `index.vue`（运行组件） | 仅 `vue`，**不依赖 naive-ui**（保证打进大屏的包足够小） |
| `config.vue`（设置面板） | `naive-ui`、`lodash`、工程内 `@/components/Pages/ChartItemSetting` |
| `api.ts` / `presets.ts` / `types.ts` / `config.ts` | 无第三方依赖 |
| `markdown.ts` / `clipboard.ts` / `exporter.ts` | 无第三方依赖（Markdown 解析、剪贴板、导出各自自研） |
| `zip.ts` / `ooxml.ts` / `docx.ts` / `download.ts` | 无第三方依赖 |

最后一行值得多说一句：导出 Word 本来最容易变成"引一个 docx 库，包体积多出几百 KB"，
这里改成**手写 zip 头 + OOXML**（`zip.ts` 只实现 stored 模式，连压缩都不需要，
因为压缩要调异步的 `CompressionStream`，会把整条导出链路变成 async）。
代价是导出的文件不压缩、体积偏大（公文量级几十到几百 KB，对下载没影响），
换来的是运行组件对外部依赖始终是零。

另外 `docx.ts` 里的 OOXML **元素顺序不能随意调换** —— `w:pPr` / `w:rPr` / `w:tblPr`
的子元素顺序是 schema 规定的，顺序错了 Word 会直接报"此文件中的内容有问题"。
改版式时请连同 `tools/verify_ooxml.py` 一起跑（它用 Python 标准库独立验一遍产物）。

排版上有几个已踩过的坑写在 `docx.ts` 顶部，改版式前值得先看一眼：

- **手动换行符（Shift+Enter，↓）要换成回车（¶）**，做法是在 `docx.ts` 的 `splitLines()` 里
  把块内文本按 `\n` 拆开、每行生成独立 `<w:p>`。模型爱写"一句一行"的短句块，它们在 Markdown 里
  属于同一个段落；若照直转成同一段落里的 `<w:br/>`，Word 的两端对齐会把每一行都硬拉到版心宽度
  （两端对齐只放过**段落最后一行**，而 ↓ 只结束"行"不结束"段落"），排成「应　　急　　指　　挥　　部」。
  ★ 别用"遇到软换行就把对齐降级成左对齐"绕过去 —— 那会改掉公文该有的两端对齐（这个方案试过，已被否）。
  ★ 代码块是唯一例外：它的换行是内容本身的结构，仍留在同一段落里。
  ★ `verify-office-export.cjs` 里有一条不变式兜着：**任何 `w:jc=both` 的段落里都不许有 `<w:br/>`**。
- **分割线（`---`）直接丢弃**，不要转成"带下边框的空段落"（那会凭空多出一条横线）。
- **层次序数靠行首前缀判断，不做顺序追踪**（序数可以越级使用）：
  `一、`→方正黑体_GBK、`（一）`→方正楷体_GBK、`1.` 与 `（1）`→方正仿宋_GBK。
  检测前要把空白与 `**` 标记清掉，否则 `**一、总体要求**` 会漏检；`3.5 万元` 这种小数要排掉
  （点号后面跟数字就不是序数）。检测放在"块 → 段落"的**每一行**上，因为模型常把序数写成普通段落。
- **清空格只清"内容"，不用来清整行**：`markdown.ts` 的 `squeezeSpaces` 会清多余空格，
  但行首缩进是列表层级，清掉就把层级弄丢了；行内代码里的空格更是内容。
  中英文之间、数字前后的空格是正常写法（`依据 GB/T 9704 标准`、`共 30 人`），不能误伤。
  ★ 中文标点（弯引号 “” 破折号 —— 省略号 ……）要算进"中文一侧"：`打造 “数字长寿” 品牌`
    的空格贴着引号，不把引号划进中文一侧就清不掉。
  ★ 行首层次序数后的空格（`1. 算力网络`）要单独一条规则 —— 序数尾巴是 `.`，不是汉字，
    通用规则不成立。但后面跟数字时不动它（`3. 5 万元` 可能是金额）。
  ★ Word 里有序列表的序号前缀写成 `1.内容`（**不留空格**）：那个空格是 Markdown 列表语法的
    分隔符，不是内容，公文的第三层本来就不留。
- **emoji 只在导出链路清，显示链路不清**：`stripEmoji()` 由 `squeezeSpaces(x, true)` 驱动，
  Word / TXT / HTML 导出都过，屏幕渲染与 MD 原文都不过。
  ★ 只清"真 emoji"（2600-27BF / 1F000+ 等），**箭头 `→` 与几何图形 `●` 保留** ——
    它们在中文技术文里承载语义，删掉就把意思改坏了。
  ★ `squeezeSpaces` 现在有两个参数，传函数引用时要包一层（`.map(c => cleanText(c))`）：
    `.map(cleanText)` 会把下标当第二个参数塞进 `dropEmoji`，第 1 个元素之后的 emoji 就清不掉。
- **标题块由三段拼成，且不一定排在文档第一行**：`lead`（模型写在正文标题之前的那句引语，
  如「以下是为…：」）→ 标题 → 副标题 → `meta`（导出时间）。
  ★ 早先标题被硬提到正文最前，那句引语反而被挤到标题后面 —— 现在是**原位保留**。
  ★ 副标题判定 = **整行被圆括号包住**的一块（`（2025-2027年）`、`（征求意见稿）`），
    但 `（一）`/`（1）` 是层次序数不是副标题，必须排掉；只看标题后面**前两块**，
    免得把正文中段的 `（附件）` 也拽到标题下面。

## 2. 放调试台（可选，但强烈建议）

```
本仓库 src/demo/SettingsVue.vue  →  <工程>/src/demo/SettingsVue.vue
```

然后在 `<工程>/src/router/index.ts` 里注册路由：

```ts
// 懒加载的测试页面
const SettingsVue = () => import('@/demo/SettingsVue.vue')

const routes: Array<RouteRecordRaw> = [
  // ...
  {
    path: '/settings',
    name: 'AgentChatSettings',
    component: SettingsVue,
    meta: { title: 'AI对话组件-设置面板调试台' }
  }
]
```

启动 `npm run dev` 后访问 http://localhost:8085/settings 即可。

调试台左列渲染真实 `index.vue`，右列渲染真实 `config.vue`，右列宽度按平台真实比例（15.83%）
还原，底部四个卡片分别是：实例参数、option 实时 JSON、参数下发、事件日志。

## 3. 本地跨域代理（可选）

大屏生产环境是浏览器直连设置面板里填的网关地址，跨域由网关自己解决。
本地调试时若被浏览器 CORS 拦，可在 `<工程>/src/config/config.base.ts` 的 `proxy` 里加一条转发，
然后把组件「参数」tab 的网关地址填成 `/bailian/gateway/agent/api`（该前缀即代理前缀）。

## 4. 构建产物

生产构建入口由 `build/webpack.prod.conf.js` 里的 `compName` 决定，原工程里是写死的
`BarCommon`，**不改就会打错组件**。两种办法：

```bash
# 办法一（推荐）：环境变量，不用改配置文件
# Windows cmd
set COMP_NAME=BaiLianChatInYiTu && npm run build
# PowerShell
$env:COMP_NAME='BaiLianChatInYiTu'; npm run build
```

```js
// 办法二：直接改 build/webpack.prod.conf.js
const compName = process.env.COMP_NAME || 'BaiLianChatInYiTu'
```

版本号取自 `index.vue` 里独立 `<script lang="ts">` 块的 `version: '1.0.1'`，
打包脚本用正则从该文件正文提取。

产物在 `<工程>/dist/`：`BaiLianChatInYiTu@1.0.1.js` + `BaiLianChatInYiTu@1.0.1.css`，
资源基础路径 `../component/BaiLianChatInYiTu/1.0.1/`，按平台要求放到组件目录即可。

### 4.1 版本号自动更新

版本号是**单一数据源**：只在 `index.vue` 那一处写 `version: 'x.y.z'`，
AMD 模块名 / 产物文件名 / 资源基础路径三处都由它派生，不用改第二遍。
`build/version.js` 负责读写，`build/resolve-file.js` 负责提取，两者用同一条正则，
编译时还会交叉校验一次（不一致直接让编译失败，不会出一个名不对版的包）。

| 命令 | 版本号 | 用途 |
| --- | --- | --- |
| `npm run build` | 不变 | 调试期反复编译 |
| `npm run build:bump` | patch +1 并写回源文件 | 正式出包 |
| `npm run build:minor` / `build:major` | 对应位 +1 | 有破坏性变更时 |
| `npm run ver` | — | 只看当前版本号 |
| `npm run ver -- patch` | patch +1 | 只改版本号，不编译 |
| `npm run ver -- --set 1.0.5` | 直接指定 | 版本号回退 / 与平台对齐 |
| `npm run pack` | — | 把 `dist` 打成 `BaiLianChatInYiTu_<版本>_<日期>.zip` |
| `npm run release` | patch +1 | 自增 → 编译 → 打包，一条龙 |

**为什么默认 `build` 不自增**：调试期一天会编译十几次，每次都自增会刷出一堆
`1.0.37` 这种没人用过的版本号，平台侧也要跟着登记。所以默认保持不动，
出包时用 `build:bump`。想让 `build` 也自增，把 `package.json` 里
`build` 脚本加上 `BUMP=patch` 即可（或直接用环境变量 `BUMP=patch npm run build`）。

**构建戳**：同一个版本号可能编译很多次，产物里另外注入了一个编译时间戳
（`__BL_VERSION__` / `__BL_BUILD__`，由 `webpack.DefinePlugin` 编译期替换）。
运行时：

- 根节点上有 `data-build` 属性，形如 `1.0.1 / 2026-09-28 16:20:48`
- 挂载时打一行 `[BaiLianChatInYiTu] 版本 1.0.1 / 2026-09-28 16:20:48`

平台上是静态路径 + 同名文件，浏览器缓存很难判断，看这两个地方就知道大屏上跑的到底是哪一次编译。

**注意**：版本号自增发生在 webpack 配置加载阶段（编译之前），所以编译失败时版本号
已经改过了，不会回滚——版本号只需单调递增，想精确对齐用 `npm run ver -- --set x.y.z`。

### 4.2 打包交付

```bash
node tools/pack.cjs          # 输出到工程上级目录
node tools/pack.cjs -o D:/tmp
```

包名带版本和日期（同一天同版本再打一次会带时分秒，不再手工加 a/b/c 后缀），
内容就是平台要的那两个文件。打包前会检查 `dist` 里的产物名是否与源码版本号一致，
版本号改过但没重新编译会直接报错提示，避免把旧包发上线。

## 5. 一键应用补丁

`yitu-base-components.patch` 记录了我们对上游工程**已有文件**的全部改动（共 7 个文件），
包括：调试台路由注册、devServer 代理、`compName` 环境变量化、bundler analyzer 与
webpackbar 的兼容性处理、版本号解析正则加行首锚定、依赖版本锁定。

```bash
cd <工程>
git apply /path/to/BaiLianChatInYiTu/integration/yitu-base-components.patch
```

另外本仓库还有两个**新增文件**需要一并拷进去（补丁里不含新文件）：

```
build/version.js        →  <工程>/build/version.js
tools/bump-version.cjs  →  <工程>/tools/bump-version.cjs
tools/pack.cjs          →  <工程>/tools/pack.cjs
```

补丁内容与上游当前版本绑定，若上游已更新导致 apply 失败，按上面 1~4 节手动改即可，
每一处改动在补丁里都有中文注释说明原因。

## 6. 版本解析的坑

上游 `build/resolve-file.js` 的版本正则原本是 `<script\s*lang="ts">([\s\S]*?)<\/script>`，
**没有行首锚定**，而且用了非贪婪匹配。只要文件里任何位置（包括注释里）出现一次
`<script lang="ts">` 这个字面量，匹配就会从那一处开始，一路截到下一个 `</script>`，
抓到一段不含 `version` 的内容，版本号解析成 `null`，报错却是
`Invalid argument expected string`（`compare-versions` 内部抛的），很难定位。

现已改成 `^<script\s+lang="ts">([\s\S]*?)<\/script>` 加 `m` 标志（真标签一定独占一行开头），
并在解析不到时抛出说明性错误。写注释时也请避免写出完整的 script 开标签字面量。
