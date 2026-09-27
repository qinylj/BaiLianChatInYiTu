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

版本号取自 `index.vue` 里独立 `<script lang="ts">` 块的 `version: '1.0.0'`，
打包脚本用正则从该文件正文提取，改版本号时两处保持一致。

产物在 `<工程>/dist/`：`BaiLianChatInYiTu@1.0.0.js` + `BaiLianChatInYiTu@1.0.0.css`，
资源基础路径 `../component/BaiLianChatInYiTu/1.0.0/`，按平台要求放到组件目录即可。

## 5. 一键应用补丁

`yitu-base-components.patch` 记录了我们对上游工程做的全部改动（共 6 个文件，49 行新增），
包括：调试台路由注册、devServer 代理、`compName` 环境变量化、bundler analyzer 与
webpackbar 的兼容性处理、依赖版本锁定。

```bash
cd <工程>
git apply /path/to/BaiLianChatInYiTu/integration/yitu-base-components.patch
```

补丁内容与上游当前版本绑定，若上游已更新导致 apply 失败，按上面 1~4 节手动改即可，
每一处改动在补丁里都有中文注释说明原因。
