<!--
  * @Description: BaiLianChatInYiTu 专用调试台
  * 官方 Playground 需要 token 才渲染配置面板、换组件也不刷新，这里单独做一个：
 *   左列 真实组件预览（独占左列，把高度全部让给预览）
 *   右列 真实 config.vue（宽度按平台真实比例还原，见 .dbg-col--right，且优先保证宽度）
 *   底部 一排 4 卡片并列：实例参数 · option 实时 JSON · 参数下发（公共+全局合一张）· 事件日志
  * 全部用真实文件，不 mock 组件与面板本身。
  *
  * ★ 右列宽度为什么是 15.8%：
  *   量自平台真实截图（3803×1974，含右侧 215px 白色留白）——
  *   编辑器视口宽 3588px，右侧设置面板宽 568px，占比 15.83%。
  *   这里用百分比而不是写死 px，是为了任何窗口宽度下都保持同样的相对宽度，
  *   这样调试台里看到的换行/挤压程度才和真实平台一致。
-->
<template>
  <n-config-provider style="width: 100%; height: 100%" :theme-overrides="overridesTheme" :theme="darkTheme">
    <n-message-provider>
      <div class="dbg">
        <header class="dbg-head">
          <div class="dbg-title">BaiLianChatInYiTu · 设置面板调试台</div>
          <div class="dbg-actions">
            <n-button size="small" @click="reload">重置配置</n-button>
            <n-button size="small" @click="copyJson">复制 JSON</n-button>
            <n-button size="small" type="primary" @click="applyJson">把 JSON 写回面板</n-button>
            <n-button size="small" @click="goHome">回官方 Playground</n-button>
          </div>
        </header>

        <div class="dbg-body">
          <!-- 左列 -->
          <div class="dbg-col">
            <section class="pane grow">
              <div class="pane-head">组件预览（真实 index.vue）</div>
              <div class="pane-body preview-body">
                <component
                  v-if="componentName && instance"
                  :is="componentName"
                  :chartConfig="instance"
                  :publicParamList="paramList"
                  :globalParams="globalParamsMock"
                  :themeColor="globalColor"
                  @finishedFn="onEvent('finishedFn', '渲染完成')"
                  @targetChange="p => onEvent('targetChange', p)"
                  @ask="p => onEvent('ask', p)"
                  @reply="p => onEvent('reply', p)"
                  @error="p => onEvent('error', p)"
                />
                <div v-else class="loading">组件加载中…</div>
              </div>
            </section>
          </div>

          <!-- 右列：宽度还原平台真实设置面板占比 -->
          <div class="dbg-col dbg-col--right" ref="rightColEl">
            <section class="pane grow">
              <div class="pane-head">
                设置面板（真实 config.vue）
                <em v-if="rightColWidth" class="pane-w">{{ rightColWidth }}px</em>
              </div>
              <div class="pane-body cfg-body">
                <n-scrollbar>
                  <component
                    v-if="configComponentName && option"
                    :is="configComponentName"
                    :optionData="option"
                    :newAttr="instance?.newAttr"
                    :themeColor="globalColor"
                  />
                </n-scrollbar>
              </div>
            </section>
          </div>
        </div>

        <!-- 最底部一排并列：实例参数 / option 实时 JSON / 参数下发 / 事件日志
             （公共参数与全局参数合并进同一张「参数下发」卡片） -->
        <footer class="dbg-foot">
          <div class="dbg-row">
            <section class="pane">
              <div class="pane-head">实例参数</div>
              <div v-if="instance" class="pane-body form-body">
                <label>
                  <span>宽度 w</span>
                  <n-input-number size="small" v-model:value="instance.attr.w" :min="320" :max="2400" />
                </label>
                <label>
                  <span>高度 h</span>
                  <n-input-number size="small" v-model:value="instance.attr.h" :min="240" :max="1600" />
                </label>
                <label>
                  <span>实例 id</span>
                  <n-input size="small" v-model:value="instance.id" />
                </label>
                <label>
                  <span>隐藏组件</span>
                  <n-switch size="small" v-model:value="instance.status.hide" />
                </label>
                <!-- 「历史对话刷新后没了」的一眼诊断位：桶名变了 = 实例 id 变了 -->
                <div class="bucket-hint" :title="`会话存 localStorage 的桶名。刷新后历史「没了」，先看这里是不是变了。`">
                  存档桶 {{ storeKeyHint }}
                </div>
              </div>
              <div v-else class="pane-body loading">实例加载中…</div>
            </section>

            <section class="pane">
              <div class="pane-head">
                option 实时 JSON
                <em v-if="jsonError" class="json-err">{{ jsonError }}</em>
              </div>
              <div class="pane-body">
                <textarea class="json-box" v-model="jsonText" spellcheck="false"></textarea>
              </div>
            </section>

            <!-- 公共参数 + 全局参数：同一张卡片里的两块 -->
            <section class="pane">
              <div class="pane-head">参数下发</div>
              <div class="pane-body par-body">
                <label class="par-line">
                  <span class="par-label">公共参数</span>
                  <input class="mock-input" v-model="paramText" spellcheck="false" />
                </label>
                <label class="par-line">
                  <span class="par-label">全局参数</span>
                  <input class="mock-input" v-model="globalText" spellcheck="false" />
                </label>
                <div class="mock-actions">
                  <n-button size="small" @click="pushParams">下发公共参数</n-button>
                  <n-button size="small" @click="paramList = []">清空公共参数</n-button>
                  <n-button size="small" @click="pushGlobal">下发全局参数</n-button>
                </div>
              </div>
            </section>

            <section class="pane">
              <div class="pane-head">事件日志</div>
              <div class="pane-body par-body">
                <div class="log" ref="logEl">
                  <div v-for="(l, i) in logs" :key="i" class="log-line">
                    <i>{{ l.time }}</i>{{ l.text }}
                  </div>
                </div>
                <div class="mock-actions">
                  <n-button size="small" @click="logs = []">清空日志</n-button>
                </div>
              </div>
            </section>
          </div>
        </footer>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { darkTheme, GlobalThemeOverrides } from 'naive-ui'
import cloneDeep from 'lodash/cloneDeep'
import { PublicParamRow } from '@/package/Decorates/Mores/BaiLianChatInYiTu/types'

const COMP_NAME = 'BaiLianChatInYiTu'

const router = useRouter()
const goHome = () => router.push('/')

const overridesTheme: GlobalThemeOverrides = {
  common: {
    borderRadius: '6px',
    primaryColor: '#3a89ff',
    primaryColorHover: '#6fabff',
    primaryColorPressed: '#2f78e0',
    primaryColorSuppl: '#3a89ff'
  },
  Input: { color: '#10151f', border: '1px solid #222831' },
  Select: {
    peers: {
      InternalSelection: { textColor: '#fff', color: '#10151F', border: '1px solid #222831' }
    }
  }
}

// @ts-ignore COMPONENT_LIST 由 webpack DefinePlugin 注入
const componentsList = COMPONENT_LIST

const componentName = ref<any>('')
const configComponentName = ref<any>('')
/** 必须是 ref：面板里 v-model 改的是对象内部字段，shallowRef 不会触发重渲染 */
const instance = ref<any>(null)
/** 传给 config.vue 的必须是 Config 实例的 .option，不是 Config 实例本身 */
const option = ref<any>(null)

const globalColor = ref({ color: ['#04bcfa', '#0454cb', '#056ff1', '#47dea2', '#16b8d6', '#f1b736'] })

/* --------------------------- 模拟基座 --------------------------- */

const paramText = ref('[{"name":"user","content":"张三","variableType":1},{"name":"areaCode","content":"500000","variableType":1}]')
const globalText = ref('{"channel":"大屏","user":"张三"}')
const paramList = ref<PublicParamRow[]>([
  { name: 'user', content: '张三', variableType: 1 },
  { name: 'areaCode', content: '500000', variableType: 1 }
])
const globalParamsMock = ref<any>({
  params: { channel: '大屏', user: '张三' },
  setParam: (k: string, v: any) => {
    globalParamsMock.value.params[k] = v
    log(`globalParams.setParam(${k}=${v})`)
  },
  getParam: (k: string) => globalParamsMock.value.params[k],
  removeParam: (k: string) => {
    delete globalParamsMock.value.params[k]
  }
})

const logs = ref<Array<{ time: string; text: string }>>([])
const logEl = ref<HTMLElement | null>(null)

const log = (text: string) => {
  const d = new Date()
  const p = (n: number) => (n < 10 ? '0' + n : '' + n)
  logs.value.push({ time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, text })
  if (logs.value.length > 200) logs.value.splice(0, logs.value.length - 200)
  nextTick(() => {
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  })
}

const onEvent = (name: string, payload: any) => {
  let text = ''
  try {
    text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  } catch (e) {
    text = String(payload)
  }
  log(`组件事件 ${name} ${text}`)
}

const pushParams = () => {
  try {
    const arr = JSON.parse(paramText.value)
    if (!Array.isArray(arr)) throw new Error('需要数组')
    paramList.value = arr
    log(`下发公共参数：${arr.map((i: any) => i.name).join(', ')}`)
  } catch (e: any) {
    log(`公共参数解析失败：${e.message}`)
  }
}

const pushGlobal = () => {
  try {
    const obj = JSON.parse(globalText.value)
    globalParamsMock.value.params = obj
    log(`下发全局参数：${JSON.stringify(obj)}`)
  } catch (e: any) {
    log(`全局参数解析失败：${e.message}`)
  }
}

/* --------------------------- option ↔ JSON --------------------------- */

const jsonText = ref('')
const jsonError = ref('')
let syncing = false

/** 右列实测宽度，显示在面板标题上，方便和平台截图（568/3588 ≈ 304px@1920）对照 */
const rightColEl = ref<HTMLElement | null>(null)
const rightColWidth = ref(0)
let ro: ResizeObserver | null = null

const syncJson = () => {
  if (syncing) return
  try {
    jsonText.value = JSON.stringify(option.value, null, 2)
    jsonError.value = ''
  } catch (e: any) {
    jsonError.value = e.message
  }
}

const applyJson = () => {
  try {
    const parsed = JSON.parse(jsonText.value)
    if (!parsed || typeof parsed !== 'object') throw new Error('需要对象')
    syncing = true
    Object.keys(parsed).forEach(k => {
      option.value[k] = parsed[k]
    })
    jsonError.value = ''
    log('JSON 已写回面板')
  } catch (e: any) {
    jsonError.value = e.message
    log(`JSON 解析失败：${e.message}`)
  } finally {
    syncing = false
    nextTick(syncJson)
  }
}

/* --------------------------- 加载组件 --------------------------- */

/**
 * ★ 实例 id 为什么要持久化（这是「历史对话刷新后没了」的根因所在）
 *
 * 组件的会话是存 localStorage 的，桶名 = `bailian-chat-in-yitu:<组件实例 id>`，
 * 而实例 id 来自 `new Config()` —— PublicConfigClass 里写着 `public id = getUUID()`，
 * **每次 new 都是一个新的随机值**。调试台原来每次刷新都重新 `new` 一遍，
 * 于是刷新后实例 id 变了 → 去读一个空桶 → 侧栏「历史对话」变空。
 * 数据其实一条没丢，全躺在旧桶里（可以用下面的「存档桶」提示直接看出来）。
 *
 * 真实平台上实例 id 是由平台**持久化在屏幕配置里**的，不会每次加载都变，
 * 所以生产环境本来就没这个问题。调试台要复现生产行为，就得自己把 id 存住：
 * 这里把首次生成的 id 写进 localStorage，下次加载复用，
 * 相当于让调试台扮演"屏幕配置"这个角色。
 */
const ID_STORE_KEY = `dbg:${COMP_NAME}:instance-id`

const loadOption = async () => {
  // @ts-ignore
  const el = componentsList.find((it: any) => it.name === COMP_NAME)
  if (!el) {
    log(`找不到组件 ${COMP_NAME}，确认 export.ts 存在`)
    return
  }
  const entryPath = el.entry
    .replace(/[\\]/g, '/')
    .replace('src', '..')
    .replace('../package', '')
    .replace('export.ts', '')
  // webpack 动态导入不能用纯变量，模板字符串可以
  const chart: any = await import(`../package${entryPath}export.ts`)
  const mod = chart[COMP_NAME]
  componentName.value = mod.component
  configComponentName.value = mod.configVue
  instance.value = new mod.config.default()
  /* 把实例 id 换成上次存下来的那份，让刷新前后是同一个「实例」——
     否则每次刷新都会换一个新桶，历史对话看起来就像被清空了 */
  let keptId = ''
  try {
    keptId = window.localStorage.getItem(ID_STORE_KEY) || ''
  } catch (e) {
    /* 隐私模式下读不到，退回新 id */
  }
  if (keptId) instance.value.id = keptId
  else {
    try {
      window.localStorage.setItem(ID_STORE_KEY, instance.value.id)
    } catch (e) {
      /* 写不进去也不影响本次使用 */
    }
  }
  // ★ 面板要的是 Config 实例的 .option
  option.value = instance.value.option
  syncJson()
  log(`已加载 ${COMP_NAME}@${mod.version}（实例 ${instance.value.id}）`)
}

const reload = async () => {
  await loadOption()
  log('已重置为默认配置')
}

const copyJson = async () => {
  try {
    await navigator.clipboard.writeText(jsonText.value)
    log('JSON 已复制到剪贴板')
  } catch (e) {
    log('复制失败，请手动选中')
  }
}

watch(jsonText, () => {
  // 用户手改 JSON 时不做实时回写，避免半截 JSON 打爆面板；点按钮才写回
})

/**
 * 组件的存档桶名。会话就是按这个名字存 localStorage 的 ——
 * 把它显示出来，以后「历史没了」这类问题一眼就能看出是不是桶名变了。
 * （格式与 index.vue 的 storeKey 一致：bailian-chat-in-yitu:<实例 id>）
 */
const storeKeyHint = computed(() => `bailian-chat-in-yitu:${(instance.value && instance.value.id) || 'default'}`)

/* 手动改「实例 id」时也存住 —— 换 id 等于换一个存档桶，用户有权这么做，但要能跨刷新保持 */
watch(
  () => instance.value && instance.value.id,
  v => {
    if (!v) return
    try {
      window.localStorage.setItem(ID_STORE_KEY, v)
    } catch (e) {
      /* 忽略 */
    }
  }
)

onMounted(() => {
  loadOption()
  log('调试台就绪')
  // 观测右列真实宽度（含窗口缩放），标题上实时显示
  if (rightColEl.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(entries => {
      const w = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0
      if (w) rightColWidth.value = Math.round(w)
    })
    ro.observe(rightColEl.value)
  }
})

onBeforeUnmount(() => {
  if (ro) {
    ro.disconnect()
    ro = null
  }
})
</script>

<style lang="scss" scoped>
.dbg {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #101014;
  color: #e6e9ef;
  font-size: 12px;
  overflow: hidden;
}

.dbg-head {
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid #23272f;

  .dbg-title {
    font-size: 14px;
    font-weight: 600;
  }

  .dbg-actions {
    display: flex;
    gap: 8px;
  }
}

.dbg-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 10px;
  padding: 10px;
}

.dbg-col {
  /* flex-shrink 允许为 1：窗口不够宽时优先压缩左列，把宽度让给右列设置面板 */
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 窗口不够高时左列可滚动，避免预览被压没 */
  overflow-y: auto;
}

/**
 * 右列 = 平台真实设置面板的宽度。
 * 实测平台截图：编辑器视口 3588px，右侧面板 568px → 15.83%。
 * 用 vw（相对浏览器视口）而不是容器百分比，与平台「面板宽 / 视口宽」的口径一致，
 * 这样任意窗口尺寸下换行、挤压的程度都和平台一致。
 *
 * flex: 0 0 auto + min-width 300 → **面板宽度优先保证**：
 * 窗口变窄时先压左列/底排，不许把面板挤到没法用（原来 min-width 只有 180，
 * 1440 窗口下面板只剩 228px，比平台的真实窄栏还窄，调出来的换行都是假的）。
 */
.dbg-col--right {
  flex: 0 0 auto;
  width: 15.83vw;
  min-width: 300px;
  overflow: hidden;
}

.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid #23272f;
  border-radius: 6px;
  background: #171a21;
  overflow: hidden;

  &.grow {
    flex: 1;
    min-height: 240px;
  }
}

.pane-head {
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: 11.5px;
  color: #9aa3b2;
  border-bottom: 1px solid #23272f;
  background: #1b1f27;

  .json-err {
    font-style: normal;
    color: #ff6b6b;
  }

  .pane-w {
    font-style: normal;
    font-size: 10.5px;
    padding: 0 5px;
    border-radius: 8px;
    color: #8b93a3;
    background: rgba(127, 127, 127, 0.18);
  }
}

.pane-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.preview-body {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  background:
    linear-gradient(rgba(90, 180, 255, 0.05) 1px, transparent 1px) 0 0 / 32px 32px,
    linear-gradient(90deg, rgba(90, 180, 255, 0.05) 1px, transparent 1px) 0 0 / 32px 32px,
    #0d1016;
}

.loading {
  color: #6b7383;
  padding: 20px;
}

/**
 * 最底部的一排卡片（实例参数 / option 实时 JSON / 参数下发 / 事件日志）。
 * flex:1 1 0 均分宽度，min-width:0 是关键 —— 没有它，内部的 input / textarea
 * 会把各自那一列顶到内容宽度，各列就不再等宽（flex 子项的默认 min-width 是 auto）。
 *
 * 高度用 clamp：**预览优先**。这一排越矮，上方组件预览能显示得越完整；
 * 但太矮又装不下 JSON / 日志，所以留 176px 下限、208px 上限，
 * 中间跟着视口高度走（1080 高时 20vh=216 → 取上限 208）。
 */
.dbg-row {
  flex: 0 0 auto;
  display: flex;
  gap: 10px;
  align-items: stretch;

  > .pane {
    flex: 1 1 0;
    min-width: 0;
    height: clamp(176px, 20vh, 208px);
  }
}

.form-body {
  /* 两列排布，把「实例参数」压扁，让出高度给上方预览区 */
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;

  /* 存档桶提示：跨满两列、退到底部当一行小注 */
  .bucket-hint {
    grid-column: 1 / -1;
    font-size: 11px;
    line-height: 1.4;
    color: #7b8595;
    background: rgba(127, 127, 127, 0.07);
    border-radius: 4px;
    padding: 4px 8px;
    word-break: break-all;
    user-select: text;
    cursor: help;
  }

  label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;

    span {
      flex: 0 0 58px;
      color: #9aa3b2;
    }
  }
}

/* 参数下发 / 事件日志两张卡片的内部排布：内容撑满 + 底部一行动作按钮 */
.par-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 「公共参数 / 全局参数」两行：左侧固定标签宽度，右侧输入框吃掉剩余宽度 */
.par-line {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;

  .mock-input {
    flex: 1 1 auto;
    min-width: 0;
  }
}

.par-label {
  flex: 0 0 58px;
  color: #9aa3b2;
}

.mock-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  /* 窄窗口下三个按钮排不下就换行，不横向溢出把卡片撑破 */
  flex-wrap: wrap;
}

/* 窗口收窄时每张卡片只剩 ~260px，实例参数的「label + 控件」再分两列会被压到换行，
   降成单列反而更好读 */
@media (max-width: 1400px) {
  .form-body {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cfg-body {
  padding: 0;

  > :deep(*) {
    width: 100%;
  }
}

/**
 * JSON 框所在 pane 的高度已被 .dbg-row 定为 208px，所以这里撑满并**取消拖拽**：
 * 留着 resize 的话，手动拖高会让它溢出到框外，三框对齐就破了。
 * box-sizing 必须有，否则 100% 高度叠加 padding 会溢出几个像素出现滚动条。
 */
.json-box {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  resize: none;
  border: 1px solid #23272f;
  border-radius: 4px;
  background: #0d1016;
  color: #a9d5a0;
  font-family: Consolas, Monaco, monospace;
  font-size: 11px;
  line-height: 1.5;
  padding: 8px;
  outline: none;
}

.dbg-foot {
  flex: 0 0 auto;
  border-top: 1px solid #23272f;
  padding: 10px;
  background: #14171d;
}

.mock-input {
  flex: none;
  min-width: 0;
  height: 26px;
  border: 1px solid #23272f;
  border-radius: 4px;
  background: #0d1016;
  color: #cfd6e0;
  font-family: Consolas, Monaco, monospace;
  font-size: 11px;
  padding: 0 8px;
  outline: none;
}

/* 日志框高度改由所在 pane 决定（.dbg-row 定了 208px），所以撑满而不是写死 76px */
.log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #23272f;
  border-radius: 4px;
  background: #0d1016;
  padding: 4px 8px;
  font-family: Consolas, Monaco, monospace;
  font-size: 11px;
  line-height: 1.6;

  .log-line {
    color: #cfd6e0;
    word-break: break-all;

    i {
      color: #6b7383;
      font-style: normal;
      margin-right: 6px;
    }
  }
}
</style>
