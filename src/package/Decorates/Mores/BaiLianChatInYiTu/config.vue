<!--
  * @Description: BaiLianChatInYiTu 设置面板
  * 面板拿到的是 Config 实例的 .option（不是 Config 实例本身）
  *
 * 层级约定（逐级减重）：
 *   L1  .grp   一级设置 —— 左侧强调色条 + 底纹，整条可点击收起/展开
 *               基础页 = 框架设置 / 主题设置 / 背景设置 / 默认对话 / 对话设置
 *   L2  .sub2  二级设置 —— 灰色左边框的缩进块，目前两处：框架设置下的「缩放 / 侧栏 / 对话区」
 *   L3  .sub3  三级设置 —— 二级分组内部的子组（侧栏显示 / 品牌区设置 / 分组区设置 /
 *                           顶部信息栏 / 对话前内容区 / 对话内容区 / 输入区设置）
 *   L4  .out-head 组外标题 —— 位置在分组盒子外面的纯文字标题，字号对齐开关标签
 *   L5  .subtitle 小标题 —— 纯文字，用于块内的小节分隔
 * 说明：原「外观」页已取消，主题 / 背景迁入基础页；「尺寸」降级并入「框架设置」并改名「缩放」。
 *       面板只剩 基础 / 大模型 / 智能体 三页（大模型在前）。
 *       所有一级分组**默认收起**（expanded 白名单），点标题才展开。
 *
 * ⚠️ 作用域样式坑：naive-ui 的 **组件根元素**（如 n-ellipsis）不会带上本组件的
 *    scope 属性，写成 `.col-head .col-name { }` 会被编译成 `.col-name[data-v-x]`
 *    而永远匹配不上。这类元素必须用 `:deep(...)` 锚在带 scope 的祖先上。
-->
<template>
  <GlobalSetting :is-use-custom="true" :tabData="tabData">
    <!-- ==================== 基础 ==================== -->
    <template #base>
      <div class="wrap" v-if="optionData">
        <!-- ---------- L1 框架设置（原「显隐设置」，改名后容纳区域显隐 + 尺寸） ---------- -->
        <div class="grp">
          <div class="grp-head" @click="toggle('frame')">
            <span class="grp-arrow" :class="{ open: isOpen('frame') }"></span>
            <span class="grp-title">框架设置</span>
            <em class="grp-badge">{{ hiddenCount }} 项已关</em>
          </div>
          <div v-show="isOpen('frame')" class="grp-body">
            <!-- L2 尺寸：排在「侧栏」之前 —— 它是整块面板的缩放系数，
                 比分区开关更"框架"，先看到更合理 -->
            <div class="sub2">
              <div class="sub2-head">缩放</div>
              <!-- 加 .slider-row：平台这个组合控件把标签/滑块/数字框都写死了宽度，
                   合计 244px 超过二级组盒 230px 的内容宽，右端会顶出盒子边框 -->
              <CustomInputNumberWithSlider
                class="slider-row"
                label="整体缩放"
                :min="0.5"
                :max="2"
                :step="0.05"
                v-model:value="optionData.scale"
              />
            </div>

            <div class="sub2">
              <div class="sub2-head">侧栏</div>
              <CustomSwitch label="显示侧栏" v-model:value="optionData.showSidebar" elMarginBottom="10px" />
              <div class="tip">关闭「显示侧栏」后，顶栏会出现展开按钮（需同时开启「显示侧栏收起按钮」）。</div>

              <!-- L3 侧栏显示：宽度与收起按钮属于「侧栏」这一区自己的设置 -->
              <div class="sub3">
                <div class="sub3-head">侧栏显示</div>
                <InputNumberwithLabel label="侧栏宽度" :min="180" :max="420" v-model:value="optionData.sidebarWidth" />
                <CustomSwitch
                  label="显示侧栏收起按钮"
                  v-model:value="optionData.showSidebarToggle"
                  elMarginBottom="10px"
                />
              </div>

              <CustomSwitch label="显示品牌区" v-model:value="optionData.showBrand" elMarginBottom="10px" />

              <!-- L3 品牌区设置：由原一级设置降级下来，只作用于品牌区 -->
              <div class="sub3">
                <div class="sub3-head">品牌区设置</div>
                <CustomInput label="面板标题" v-model:value="optionData.title" placeholder="AI对话" />
                <CustomInput label="品牌图标" v-model:value="optionData.brandIcon" placeholder="emoji 或图片地址" />
                <CustomInput label="连接状态文案" v-model:value="optionData.connectedText" placeholder="已连接网关" />
              </div>

              <!-- 分组区设置：标题提到组外（字号对齐「显示品牌区」），组本身挂在侧栏组的最后一位 -->
              <div class="out-head">分组区设置</div>
              <div class="sub3">
                <CustomSwitch label="显示「大模型」" v-model:value="optionData.showModelSection" elMarginBottom="10px" />
                <CustomSwitch label="显示「智能体」" v-model:value="optionData.showAgentSection" elMarginBottom="10px" />
                <CustomSwitch label="显示「历史对话」" v-model:value="optionData.showHistorySection" elMarginBottom="10px" />
                <CustomSwitch label="显示「新建对话」按钮" v-model:value="optionData.showNewChatBtn" elMarginBottom="10px" />
              </div>
            </div>

            <!-- L2 对话区：对话侧各区域的分组，四个子组并列 -->
            <div class="sub2">
              <div class="sub2-head">对话区</div>

              <!-- L3 顶部信息栏：已提升到与「对话前内容区」平级 -->
              <div class="sub3">
                <div class="sub3-head">顶部信息栏</div>
                <CustomSwitch label="显示顶部信息栏" v-model:value="optionData.showTopbar" elMarginBottom="10px" />
                <!-- 停止按钮已移到输入区的发送键上（生成中时发送键变停止），这里只剩导出 -->
                <CustomSwitch label="显示导出按钮" v-model:value="optionData.showActions" elMarginBottom="10px" />
              </div>

              <div class="sub3">
                <div class="sub3-head">对话前内容区</div>
                <!-- 欢迎页四件套：图标 / 欢迎标题 / 欢迎语 / 预设问题，
                     每个"显示开关"紧挨着它管的那份内容，读起来才对得上 -->
                <CustomSwitch label="显示图标" v-model:value="optionData.showWelcomeIcon" elMarginBottom="10px" />

                <CustomSwitch label="显示欢迎标题" v-model:value="optionData.showWelcomeTitle" elMarginBottom="10px" />
                <CustomInput
                  label="欢迎标题"
                  v-model:value="optionData.welcomeTitle"
                  placeholder="留空 = 用对话对象名称"
                />

                <CustomSwitch label="显示欢迎语" v-model:value="optionData.showWelcomeText" elMarginBottom="10px" />
                <div class="field">
                  <div class="field-label">欢迎语</div>
                  <n-input
                    v-model:value="optionData.welcomeText"
                    type="textarea"
                    :autosize="{ minRows: 2, maxRows: 4 }"
                    size="small"
                    placeholder="留空 = 用对话对象的欢迎语"
                  />
                </div>

                <CustomSwitch label="显示预设问题" v-model:value="optionData.showSuggestions" elMarginBottom="10px" />
                <div class="subtitle">
                  预设问题
                  <span class="count">{{ optionData.suggestions.length }}</span>
                </div>
                <div v-if="!optionData.suggestions.length" class="tip">
                  当前为空，将使用对话对象自带的预设问题。
                </div>
                <div v-for="(s, i) in optionData.suggestions" :key="i" class="row-item">
                  <n-input v-model:value="optionData.suggestions[i]" size="small" placeholder="输入预设问题" />
                  <n-button size="small" quaternary type="error" @click="optionData.suggestions.splice(i, 1)">删除</n-button>
                </div>
                <n-button size="small" dashed style="width: 100%; margin-top: 4px" @click="optionData.suggestions.push('')">
                  ＋ 添加问题
                </n-button>
              </div>

              <div class="sub3">
                <div class="sub3-head">对话内容区</div>
                <CustomSwitch label="显示头像" v-model:value="optionData.showAvatars" elMarginBottom="10px" />
                <CustomSwitch label="显示消息时间" v-model:value="optionData.showTime" elMarginBottom="10px" />
                <CustomSwitch label="显示点赞 / 点踩" v-model:value="optionData.showFeedback" elMarginBottom="10px" />
                <!-- 对话区字号：气泡 + 欢迎页正文 -->
                <InputNumberwithLabel label="字体大小" :min="10" :max="20" v-model:value="optionData.chatFontSize" />
              </div>

              <!-- 由原一级设置降级下来，与上面三个区域平级 -->
              <div class="sub3">
                <div class="sub3-head">输入区设置</div>
                <CustomSwitch label="显示参数条" v-model:value="optionData.showParamBar" elMarginBottom="10px" />
                <!-- 输入区字号：输入框里的文字 -->
                <InputNumberwithLabel label="字体大小" :min="10" :max="20" v-model:value="optionData.fontSize" />
                <CustomInput label="输入框提示" v-model:value="optionData.placeholder" placeholder="输入消息…" />
                <CustomInput label="底栏提示" v-model:value="optionData.inputHint" placeholder="Enter 发送 · Shift+Enter 换行" />
              </div>
            </div>
          </div>
        </div>

        <!-- ---------- L1 主题设置（由外观页迁入，紧跟在「框架设置」下方） ---------- -->
        <div class="grp">
          <div class="grp-head" @click="toggle('theme')">
            <span class="grp-arrow" :class="{ open: isOpen('theme') }"></span>
            <span class="grp-title">主题设置</span>
            <em class="grp-badge">{{ currentThemeName }}</em>
          </div>
          <div v-show="isOpen('theme')" class="grp-body">
            <div class="theme-grid">
              <div
                v-for="t in THEMES"
                :key="t.id"
                class="theme-cell"
                :class="{ active: optionData.theme === t.id }"
                @click="optionData.theme = t.id"
              >
                <span class="theme-swatch" :style="swatchStyle(t)">
                  <i :style="{ background: t.vars.accent }"></i>
                  <i :style="{ background: t.vars.accent2 }"></i>
                  <i :style="{ background: t.vars.bubbleAi }"></i>
                </span>
                <span class="theme-name">{{ t.name }}</span>
              </div>
            </div>
            <div class="tip">主题决定面板底色、强调色、气泡色、圆角与标题条发光，共 {{ THEMES.length }} 套。</div>

            <!-- ---------- L2 自定义主题（主题下的二级设置） ---------- -->
            <div class="sub2">
              <div class="sub2-head">
                自定义主题
                <em class="sub2-badge" :class="{ on: optionData.themeOverride.use }">
                  {{ optionData.themeOverride.use ? '已启用' : '未启用' }}
                </em>
              </div>
              <CustomSwitch
                label="启用自定义主题"
                v-model:value="optionData.themeOverride.use"
                elMarginBottom="10px"
              />
              <template v-if="optionData.themeOverride.use">
                <NewColorPicker
                  v-bind="$attrs"
                  label="强调色"
                  label-placement="left"
                  v-model:value="optionData.themeOverride.accent"
                />
                <NewColorPicker
                  v-bind="$attrs"
                  label="次强调色"
                  label-placement="left"
                  v-model:value="optionData.themeOverride.accent2"
                />
                <NewColorPicker
                  v-bind="$attrs"
                  label="正文颜色"
                  label-placement="left"
                  v-model:value="optionData.themeOverride.text"
                />
                <NewColorPicker
                  v-bind="$attrs"
                  label="面板底色"
                  label-placement="left"
                  v-model:value="optionData.themeOverride.bg"
                />
                <CustomInput
                  label="圆角"
                  v-model:value="optionData.themeOverride.radius"
                  placeholder="如 8px / 14px"
                />
                <n-button size="small" secondary style="width: 100%" @click="resetThemeOverride">
                  还原为默认色
                </n-button>
              </template>
              <div v-else class="tip">未启用，配色完全跟随上方选中的主题。</div>
            </div>
          </div>
        </div>

        <!-- ---------- L1 背景设置（由外观页迁入） ---------- -->
        <div class="grp">
          <div class="grp-head" @click="toggle('bg')">
            <span class="grp-arrow" :class="{ open: isOpen('bg') }"></span>
            <span class="grp-title">背景设置</span>
            <em class="grp-badge">{{ currentBgName }}</em>
          </div>
          <div v-show="isOpen('bg')" class="grp-body">
            <div class="tip bg-note">背景只作用于对话区，不覆盖顶部信息栏。</div>

            <div class="bg-grid">
              <div
                v-for="b in BACKGROUNDS"
                :key="b.id"
                class="bg-cell"
                :class="{ active: optionData.background === b.id && !optionData.backgroundImage }"
                @click="pickBackground(b.id)"
              >
                <span class="bg-thumb" :style="{ background: b.css === 'none' ? '#0f1117' : b.css }"></span>
                <span class="bg-name">{{ b.name }}</span>
              </div>
            </div>

            <CustomInput
              label="自定义背景图"
              v-model:value="optionData.backgroundImage"
              placeholder="留空则使用上面的内置背景"
            />
            <div class="tip">填了图片地址后优先级高于内置背景，建议用同域或允许跨域的图片。</div>

            <CustomInputNumberWithSlider
              class="slider-row"
              label="遮罩浓度"
              :min="0"
              :max="100"
              v-model:value="optionData.backgroundVeil"
            />
            <CustomInputNumberWithSlider
              class="slider-row"
              label="背景模糊"
              :min="0"
              :max="20"
              v-model:value="optionData.backgroundBlur"
            />
            <div class="tip">文字比较密时，遮罩浓度建议 ≥ 45；否则背景会干扰阅读。</div>
          </div>
        </div>

        <!-- ---------- L1 默认对话 ---------- -->
        <div class="grp">
          <div class="grp-head" @click="toggle('target')">
            <span class="grp-arrow" :class="{ open: isOpen('target') }"></span>
            <span class="grp-title">默认对话</span>
          </div>
          <div v-show="isOpen('target')" class="grp-body">
            <CustomInputSelect label="类型" v-model:value="optionData.targetKind" :options="targetKindOptions" />
            <CustomInputSelect
              label="默认选中"
              v-model:value="optionData.targetId"
              :options="targetIdOptions"
              clearable
            />
            <div class="tip">留空则取清单里第一个启用的对象。</div>
          </div>
        </div>

        <!-- ---------- L1 对话设置（原「会话行为」：管的是会话怎么跑，不是界面上有什么） ---------- -->
        <div class="grp">
          <div class="grp-head" @click="toggle('session')">
            <span class="grp-arrow" :class="{ open: isOpen('session') }"></span>
            <span class="grp-title">对话设置</span>
          </div>
          <div v-show="isOpen('session')" class="grp-body">
            <!-- 思考过程排在「流式输出」上方：它俩是同一个问题的两面 ——
                 流式决定"边生成边出字"，思考过程决定"要不要把思考那路也显示出来"。
                 非流式（整包返回）时思考过程一样能拿到，所以两者互不依赖。 -->
            <CustomSwitch
              label="显示思考过程"
              v-model:value="optionData.showThought"
              elMarginBottom="10px"
            />
            <CustomSwitch label="流式输出" v-model:value="optionData.stream" elMarginBottom="10px" />
            <CustomSwitch label="保存历史对话" v-model:value="optionData.persistHistory" elMarginBottom="10px" />
            <CustomSwitch
              label="首轮自动创建会话"
              v-model:value="optionData.autoCreateSession"
              elMarginBottom="10px"
            />
            <InputNumberwithLabel label="最多保留会话" :min="1" :max="200" v-model:value="optionData.maxHistoryCount" />
            <InputNumberwithLabel label="上下文条数" :min="1" :max="50" v-model:value="optionData.contextLimit" />
            <div class="tip">「上下文条数」只对直连大模型生效；百炼智能体的上下文由网关会话维护。</div>
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== 智能体 ==================== -->
    <template #agents>
      <div class="wrap" v-if="optionData">
        <!-- ---------- L1 百炼网关：只有地址是全局的 ---------- -->
        <div class="grp">
          <div class="grp-head" @click="toggle('gateway')">
            <span class="grp-arrow" :class="{ open: isOpen('gateway') }"></span>
            <span class="grp-title">智能体开发平台2.0网关</span>
            <em class="grp-badge">全部智能体共用</em>
          </div>
          <div v-show="isOpen('gateway')" class="grp-body">
            <CustomInput label="网关地址" v-model:value="optionData.gateway.baseUrl" />
            <div class="tip">
              所有智能体共用这一个地址，改一处即对全部生效。
              地址填到 <code>/gateway/agent/api</code> 为止，后面的 createSession / run 等路径由组件拼接。
            </div>
          </div>
        </div>

        <!-- ---------- L1 智能体清单（与「百炼网关」平级，同样可折叠） ---------- -->
        <div class="grp">
          <div class="grp-head" @click="toggle('agentList')">
            <span class="grp-arrow" :class="{ open: isOpen('agentList') }"></span>
            <span class="grp-title">智能体清单</span>
            <em class="grp-badge">{{ optionData.agents.length }} 个</em>
          </div>
          <div v-show="isOpen('agentList')" class="grp-body">
            <div class="tip">
              每个智能体需要填「APP_KEY」与「智能体编码 agentCode」；版本号、超时按需修改。
            </div>

            <n-collapse arrow-placement="right" :default-expanded-names="[]">
          <n-collapse-item v-for="(a, i) in optionData.agents" :key="a.id" :name="a.id">
            <template #header>
              <span class="col-head">
                <i class="dot" :style="{ background: a.enabled ? a.accent : '#8b93a3' }"></i>
                <!-- 名称被压窄时走省略号，悬停显示全名（n-ellipsis 只在真被截断时才弹 tooltip） -->
                <n-ellipsis class="col-name" :tooltip="{ placement: 'top' }">
                  {{ a.name || '未命名智能体' }}
                </n-ellipsis>
                <em v-if="!a.enabled" class="col-off">已停用</em>
              </span>
            </template>
            <template #header-extra>
              <div class="col-actions">
                <span class="col-switch" @click.stop>
                  <n-switch size="small" v-model:value="a.enabled" />
                </span>
                <n-button class="act" size="tiny" quaternary @click.stop="moveItem(optionData.agents, i, -1)">↑</n-button>
                <n-button class="act" size="tiny" quaternary @click.stop="moveItem(optionData.agents, i, 1)">↓</n-button>
                <n-popconfirm
                  positive-text="确认删除"
                  :positive-button-props="{ type: 'error' }"
                  negative-text="取消"
                  @positive-click="removeItem(optionData.agents, i)"
                >
                  <template #trigger>
                    <n-button class="act act-del" size="tiny" quaternary type="error" @click.stop>删除</n-button>
                  </template>
                  <div class="del-confirm">
                    删除智能体「{{ a.name || '未命名智能体' }}」？
                    <em>删除后该智能体的编码、凭证与参数配置一并丢失，且不可撤销。</em>
                  </div>
                </n-popconfirm>
              </div>
            </template>

            <!-- ---------- L2 对话配置 ---------- -->
            <div class="sub2">
              <div class="sub2-head">对话配置</div>
              <CustomInput label="名称" v-model:value="a.name" />
              <CustomInput label="描述" v-model:value="a.description" />
              <!-- 头像 / 状态标签：label 与输入框同行（label-placement="left"） -->
              <CustomInput
                label="图标"
                label-placement="left"
                v-model:value="a.avatar"
                placeholder="emoji 或图片地址"
              />
              <NewColorPicker
                v-bind="$attrs"
                label="图标背景"
                label-placement="left"
                v-model:value="a.accent"
              />
              <CustomInput
                label="状态标签"
                label-placement="left"
                v-model:value="a.tagText"
                placeholder="如 建设中，留空不显示"
              />
              <NewColorPicker
                v-bind="$attrs"
                label="标签背景"
                label-placement="left"
                v-model:value="a.tagBackground"
              />
              <div class="field">
                <div class="field-label">欢迎语</div>
                <!-- 去掉 autosize 才能拖：naive 的 resizable 类在 autosize 下不生效 -->
                <n-input class="ta-grow" v-model:value="a.welcome" type="textarea" :rows="3" resizable size="small" />
              </div>
              <div class="field">
                <div class="field-label">预设问题（每行一条）</div>
                <n-input
                  class="ta-grow"
                  :value="(a.suggestions || []).join('\n')"
                  type="textarea"
                  :rows="4"
                  resizable
                  size="small"
                  @update:value="v => (a.suggestions = splitLines(v))"
                />
              </div>
            </div>

            <!-- ---------- L2 智能体配置 ---------- -->
            <div class="sub2">
              <div class="sub2-head">智能体配置</div>
              <CustomInput
                label="APP_KEY"
                v-model:value="a.apiKey"
                type="password"
                placeholder="留空则回退到全局网关的 Key"
              />
              <CustomInput label="智能体编码" v-model:value="a.agentCode" placeholder="agentCode" />
              <CustomInput label="智能体版本" v-model:value="a.agentVersion" placeholder="agentVersion，可不填" />
              <InputNumberwithLabel
                class="num-nowrap"
                label="智能体超时(ms)"
                :min="5000"
                :max="600000"
                :step="1000"
                v-model:value="a.timeoutMs"
              />
            </div>

            <!-- ---------- L2 该智能体专属参数（放在该智能体最后） ---------- -->
            <div class="sub2">
              <div class="sub2-head">
                传给该智能体的参数
                <span class="count">{{ (a.paramBindings || []).filter(p => p.enabled).length }}</span>
              </div>
              <div class="tip">
                这里的参数只对「{{ a.name || '本智能体' }}」生效，会放进 run 接口的
                <code>message.metadata</code>。「大屏公共参数」取自平台配置的公共参数。
              </div>

              <div v-if="!a.paramBindings || !a.paramBindings.length" class="tip">该智能体还没有参数。</div>
              <div v-for="(p, pi) in a.paramBindings" :key="p.id" class="param-card">
                <div class="param-head">
                  <n-switch v-model:value="p.enabled" size="small" />
                  <span class="param-title">{{ p.label || p.name || '未命名参数' }}</span>
                  <n-button size="tiny" quaternary type="error" @click="removeItem(a.paramBindings, pi)">删除</n-button>
                </div>
                <CustomInput label="显示名" v-model:value="p.label" placeholder="徽章上展示的键名" />
                <CustomInput label="传给智能体的键名" v-model:value="p.name" placeholder="user" />
                <CustomInputSelect label="取值方式" v-model:value="p.source" :options="paramSourceOptions" />
                <CustomInput
                  v-if="p.source === 'public'"
                  label="大屏公共参数名"
                  v-model:value="p.paramKey"
                  placeholder="与平台「公共参数」同名"
                />
                <CustomInput v-else label="固定值" v-model:value="p.value" placeholder="如 大屏" />
              </div>
              <n-button
                size="small"
                dashed
                style="width: 100%; margin-top: 4px"
                @click="addAgentParam(a)"
              >
                ＋ 添加参数
              </n-button>
            </div>
          </n-collapse-item>
            </n-collapse>

            <n-button size="small" dashed style="width: 100%; margin-top: 8px" @click="addAgent">
              ＋ 添加智能体
            </n-button>
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== 大模型 ==================== -->
    <template #models>
      <div class="wrap" v-if="optionData">
        <!-- ---------- L1 大模型清单（与智能体页的「智能体清单」同构） ---------- -->
        <div class="grp">
          <div class="grp-head" @click="toggle('modelList')">
            <span class="grp-arrow" :class="{ open: isOpen('modelList') }"></span>
            <span class="grp-title">大模型清单</span>
            <em class="grp-badge">{{ optionData.models.length }} 个</em>
          </div>
          <div v-show="isOpen('modelList')" class="grp-body">
            <div class="tip">
              大模型直连 OpenAI 兼容的 /chat/completions 接口，密钥只存在组件配置里（不参与参数绑定）。
            </div>

            <n-collapse arrow-placement="right" :default-expanded-names="[]">
          <n-collapse-item v-for="(m, i) in optionData.models" :key="m.id" :name="m.id">
            <template #header>
              <span class="col-head">
                <i class="dot" :style="{ background: m.enabled ? m.accent : '#8b93a3' }"></i>
                <n-ellipsis class="col-name" :tooltip="{ placement: 'top' }">
                  {{ m.name || '未命名模型' }}
                </n-ellipsis>
                <em v-if="!m.enabled" class="col-off">已停用</em>
              </span>
            </template>
            <template #header-extra>
              <div class="col-actions">
                <span class="col-switch" @click.stop>
                  <n-switch size="small" v-model:value="m.enabled" />
                </span>
                <n-button class="act" size="tiny" quaternary @click.stop="moveItem(optionData.models, i, -1)">↑</n-button>
                <n-button class="act" size="tiny" quaternary @click.stop="moveItem(optionData.models, i, 1)">↓</n-button>
                <n-popconfirm
                  positive-text="确认删除"
                  :positive-button-props="{ type: 'error' }"
                  negative-text="取消"
                  @positive-click="removeItem(optionData.models, i)"
                >
                  <template #trigger>
                    <n-button class="act act-del" size="tiny" quaternary type="error" @click.stop>删除</n-button>
                  </template>
                  <div class="del-confirm">
                    删除大模型「{{ m.name || '未命名模型' }}」？
                    <em>删除后该模型的接口地址、密钥与提示词一并丢失，且不可撤销。</em>
                  </div>
                </n-popconfirm>
              </div>
            </template>

            <!-- ---------- L2 对话配置（与智能体条目完全同构） ---------- -->
            <div class="sub2">
              <div class="sub2-head">对话配置</div>
              <CustomInput label="名称" v-model:value="m.name" />
              <CustomInput label="描述" v-model:value="m.description" />
              <CustomInput
                label="图标"
                label-placement="left"
                v-model:value="m.avatar"
                placeholder="emoji 或图片地址"
              />
              <NewColorPicker
                v-bind="$attrs"
                label="图标背景"
                label-placement="left"
                v-model:value="m.accent"
              />
              <CustomInput
                label="状态标签"
                label-placement="left"
                v-model:value="m.tagText"
                placeholder="如 建设中，留空不显示"
              />
              <NewColorPicker
                v-bind="$attrs"
                label="标签背景"
                label-placement="left"
                v-model:value="m.tagBackground"
              />
              <div class="field">
                <div class="field-label">欢迎语</div>
                <!-- 去掉 autosize 才能拖：naive 的 resizable 类在 autosize 下不生效 -->
                <n-input class="ta-grow" v-model:value="m.welcome" type="textarea" :rows="3" resizable size="small" />
              </div>
              <div class="field">
                <div class="field-label">预设问题（每行一条）</div>
                <n-input
                  class="ta-grow"
                  :value="(m.suggestions || []).join('\n')"
                  type="textarea"
                  :rows="4"
                  resizable
                  size="small"
                  @update:value="v => (m.suggestions = splitLines(v))"
                />
              </div>
            </div>

            <!-- ---------- L2 模型配置 ---------- -->
            <div class="sub2">
              <div class="sub2-head">模型配置</div>
              <CustomInput label="模型名" v-model:value="m.model" placeholder="deepseek-flash / qwen-turbo" />
              <CustomInput label="接口地址" v-model:value="m.baseUrl" placeholder="…/v1/chat/completions" />
              <CustomInput label="API Key" v-model:value="m.apiKey" type="password" />
              <InputNumberwithLabel
                class="num-nowrap"
                label="温度"
                :min="0"
                :max="2"
                :step="0.1"
                v-model:value="m.temperature"
              />
              <InputNumberwithLabel
                class="num-nowrap"
                label="最大 Token"
                :min="1"
                :max="1048576"
                v-model:value="m.maxTokens"
              />
              <!-- 一般额度是「思考 + 正文」合计，这句话不写清就一定会被踩 -->
              <div class="tip">
                上限 1048576（1M上下文）。注意额度一般是「思考过程 + 正文」的合计，
                开着「显示思考过程」时给太小会被思考吃光、正文变空。
              </div>
              <div class="field">
                <div class="field-label">系统提示词</div>
                <n-input class="ta-grow" v-model:value="m.system" type="textarea" :rows="4" resizable size="small" />
              </div>
            </div>
          </n-collapse-item>
            </n-collapse>

            <n-button size="small" dashed style="width: 100%; margin-top: 8px" @click="addModel">
              ＋ 添加大模型
            </n-button>
          </div>
        </div>
      </div>
    </template>

  </GlobalSetting>
</template>

<script setup lang="ts">
import { computed, ref, PropType } from 'vue'
import cloneDeep from 'lodash/cloneDeep'
// 局部引入，不依赖宿主平台在 plugins/naive.ts 里是否全局注册过
// （平台的全局清单里没有 NPopconfirm，必须自己引）
import { NEllipsis, NPopconfirm } from 'naive-ui'
import { GlobalSetting } from '@/components/Pages/ChartItemSetting'
import {
  CustomInput,
  CustomInputNumberWithSlider,
  CustomInputSelect,
  CustomSwitch,
  InputNumberwithLabel,
  NewColorPicker
} from '@/components/Form'
import { TableDataType } from '@/types/public.d'
import { option as defaultOption } from './config'
import { ACCENT_SWATCH, BACKGROUNDS, THEMES, tagBackgroundOfTheme } from './presets'
import { uid } from './api'
import { AgentItem, ModelItem, ThemePreset } from './types'

const props = defineProps({
  optionData: {
    type: Object as PropType<typeof option>,
    required: true
  }
})

/** 主题自定义覆盖里必须保持"合法颜色字符串"的字段 */
const THEME_COLOR_KEYS = ['accent', 'accent2', 'text', 'bg', 'radius']

/**
 * 旧版本组件升级上来时，option 里没有新加的键。
 * 这里就地补齐，后面模板才能直接 v-model 到 optionData.xxx。
 * （补在 optionData 上而不是副本上，才会随组件配置一起保存。）
 */
const ensureOption = () => {
  const o = props.optionData as any
  if (!o || typeof o !== 'object') return
  Object.keys(defaultOption).forEach(k => {
    if (o[k] === undefined || o[k] === null) o[k] = cloneDeep((defaultOption as any)[k])
  })
  o.themeOverride = { ...(defaultOption as any).themeOverride, ...(o.themeOverride || {}) }
  // ★ 旧配置里色值可能是空串，平台的 NewColorPicker 不接受空值（卸载时 Color('') 会抛错），
  //   这里统一回填成合法默认色，用 themeOverride.use 开关控制是否真正生效。
  THEME_COLOR_KEYS.forEach((k: string) => {
    if (!o.themeOverride[k]) o.themeOverride[k] = (defaultOption as any).themeOverride[k]
  })
  o.gateway = { ...(defaultOption as any).gateway, ...(o.gateway || {}) }
  o.gateway.paths = { ...(defaultOption as any).gateway.paths, ...((o.gateway && o.gateway.paths) || {}) }
  if (!Array.isArray(o.agents)) o.agents = cloneDeep((defaultOption as any).agents)
  if (!Array.isArray(o.models)) o.models = cloneDeep((defaultOption as any).models)
  if (!Array.isArray(o.paramBindings)) o.paramBindings = cloneDeep((defaultOption as any).paramBindings)
  if (!Array.isArray(o.suggestions)) o.suggestions = []

  // 全局参数清单只作为迁移源，做最小的结构规范化
  o.paramBindings.forEach((p: any) => {
    if (!p.id) p.id = uid('param')
    if (p.enabled === undefined) p.enabled = true
    if (!p.source) p.source = 'public'
  })

  o.agents.forEach((a: any, i: number) => {
    if (!a.id) a.id = uid('agent')
    if (!Array.isArray(a.suggestions)) a.suggestions = []
    if (a.enabled === undefined) a.enabled = true
    // 主题色改成可点选之后，空值会让色板没有选中项；旧配置补一个合法色
    if (!a.accent) a.accent = ACCENT_SWATCH[i % ACCENT_SWATCH.length]
    // 「标签背景」是后加的字段：旧配置没有，这里按当前主题的标签底色补，
    // 保证升级上来的观感与之前一致（NewColorPicker 也不接受空串）
    if (!a.tagBackground) a.tagBackground = tagBackgroundOfTheme(o.theme)
    // ★ 凭证下沉：旧配置的 APP_KEY / 超时存在全局网关里，迁移到每个智能体；
    //   只在字段缺失时迁移，已是空串也算"用户明确没填"，保留空串走全局兜底。
    if (a.apiKey === undefined || a.apiKey === null) a.apiKey = o.gateway.apiKey || ''
    if (!Number(a.timeoutMs)) a.timeoutMs = Number(o.gateway.timeoutMs) || 120000
    // ★ 参数下沉：旧配置的智能体没有自己的参数，把全局那份迁移过来
    if (!Array.isArray(a.paramBindings)) a.paramBindings = cloneDeep(o.paramBindings)
    a.paramBindings.forEach((p: any) => {
      if (!p.id) p.id = uid('param')
      if (p.enabled === undefined) p.enabled = true
      if (!p.source) p.source = 'public'
    })
  })
  o.models.forEach((m: any) => {
    if (!m.id) m.id = uid('model')
    if (m.enabled === undefined) m.enabled = true
    if (!m.accent) m.accent = '#4f8cff'
    // ★ 大模型条目与智能体同构：状态标签 / 标签底色 / 欢迎语 / 预设问题
    if (m.tagText === undefined || m.tagText === null) m.tagText = ''
    // 平台 NewColorPicker 不接受空串，旧配置按当前主题的标签底色补齐
    if (!m.tagBackground) m.tagBackground = tagBackgroundOfTheme(o.theme)
    if (m.welcome === undefined || m.welcome === null) m.welcome = ''
    if (!Array.isArray(m.suggestions)) m.suggestions = []
  })
}
ensureOption()

/* --------------------------- 一级设置折叠 --------------------------- */

/**
 * 记录"被展开"的分组（白名单），默认**全部收起**。
 *
 * 面板一打开先是一列分组标题，看清"有哪些设置"再按需展开 ——
 * 否则基础页五个 L1 组全铺开，要滚很多屏才找得到想改的那一项。
 * 用白名单而不是"记录被收起的"，新增分组也会自动保持收起，不会漏。
 */
const expanded = ref<string[]>([])
const isOpen = (key: string) => expanded.value.indexOf(key) >= 0
const toggle = (key: string) => {
  const i = expanded.value.indexOf(key)
  expanded.value = i < 0 ? [...expanded.value, key] : expanded.value.filter(k => k !== key)
}

const tabData = [
  { name: '基础', slotName: 'base' },
  // 大模型直连最常用（填个地址+Key 就能聊），排在需要百炼网关配合的智能体前面
  { name: '大模型', slotName: 'models' },
  { name: '智能体', slotName: 'agents' }
] as TableDataType[]

const targetKindOptions = [
  { label: '智能体（百炼）', value: 'agent' },
  { label: '大模型（直连）', value: 'model' }
]

const paramSourceOptions = [
  { label: '大屏公共参数', value: 'public' },
  { label: '固定值', value: 'static' }
]

/** 只列出当前类型下的候选项，避免选了对面类型导致首屏回退 */
const targetIdOptions = computed(() => {
  const o = props.optionData as any
  if (!o) return []
  const list = o.targetKind === 'model' ? o.models : o.agents
  return (list || []).map((i: any) => ({ label: i.name || i.id, value: i.id }))
})

/** 框架设置分组头上显示的"关掉了几项"，让人不用展开也知道有没有动过 */
const SWITCH_KEYS = [
  'showSidebar', 'showSidebarToggle', 'showBrand',
  'showModelSection', 'showAgentSection', 'showHistorySection', 'showNewChatBtn',
  'showTopbar', 'showActions', 'showParamBar', 'showSuggestions',
  'showWelcomeIcon', 'showWelcomeTitle', 'showWelcomeText',
  'showAvatars', 'showTime', 'showFeedback'
]
const hiddenCount = computed(() => {
  const o = props.optionData as any
  if (!o) return 0
  return SWITCH_KEYS.filter(k => o[k] === false).length
})

const currentThemeName = computed(() => {
  const o = props.optionData as any
  const t = THEMES.find(x => x.id === (o && o.theme))
  return t ? t.name : ''
})

const currentBgName = computed(() => {
  const o = props.optionData as any
  if (!o) return ''
  if (o.backgroundImage) return '自定义图'
  const b = BACKGROUNDS.find(x => x.id === o.background)
  return b ? b.name : ''
})

const swatchStyle = (t: ThemePreset) => ({
  background: t.vars.bg,
  borderColor: t.vars.borderStrong
})

const pickBackground = (id: string) => {
  const o = props.optionData as any
  o.background = id
  // 选了内置背景就把自定义图清掉，否则界面上点了没反应
  o.backgroundImage = ''
}

const splitLines = (v: string) =>
  String(v || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

const resetThemeOverride = () => {
  const o = props.optionData as any
  // 只还原成默认色，保持"启用覆盖"开关仍然是开着的，否则按钮点完面板会自己收起来
  o.themeOverride = { ...cloneDeep((defaultOption as any).themeOverride), use: true }
}

const moveItem = (list: any[], index: number, delta: number) => {
  const to = index + delta
  if (to < 0 || to >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(to, 0, item)
}

const removeItem = (list: any[], index: number) => {
  list.splice(index, 1)
}

const addAgent = () => {
  const o = props.optionData as any
  const item: AgentItem = {
    id: uid('agent'),
    name: '新智能体',
    description: '请填写描述',
    avatar: '🤖',
    accent: '#22c55e',
    // 新智能体给一份空白凭证，用户按自己的百炼应用填
    apiKey: '',
    timeoutMs: 120000,
    agentCode: '',
    agentVersion: '',
    welcome: '',
    suggestions: [],
    tagText: '',
    // 新智能体的标签底色跟随「当前主题」，用户不调也和主题浑然一体
    tagBackground: tagBackgroundOfTheme(o.theme),
    enabled: true,
    // 新智能体给一条最常用的公共参数，省得从零填
    paramBindings: [
      { id: uid('param'), label: 'user', name: 'user', source: 'public', paramKey: 'user', value: '', enabled: true }
    ]
  }
  o.agents.push(item)
}

const addModel = () => {
  const o = props.optionData as any
  const item: ModelItem = {
    id: uid('model'),
    name: '新大模型',
    description: '请填写描述',
    avatar: '🧠',
    accent: '#4f8cff',
    // 与智能体同构的四个字段：不填就和主题保持一致
    tagText: '',
    tagBackground: tagBackgroundOfTheme(o.theme),
    welcome: '',
    suggestions: [],
    model: 'qwen-turbo',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    apiKey: '',
    system: '你是一个专业、严谨的助手，回答尽量简洁准确。',
    temperature: 0.7,
    maxTokens: 32768,
    enabled: true
  }
  o.models.push(item)
}

/** 给某个智能体加一条参数 */
const addAgentParam = (a: any) => {
  if (!Array.isArray(a.paramBindings)) a.paramBindings = []
  a.paramBindings.push({
    id: uid('param'),
    label: '新参数',
    name: '',
    source: 'public',
    paramKey: '',
    value: '',
    enabled: true
  })
}
</script>

<style lang="scss" scoped>
@import '@/styles/pages/form.scss';

.wrap {
  width: 100%;
  padding: 0 20px;
  box-sizing: border-box;

  .subtitle {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 17px;
    font-size: 12px;
    font-weight: 500;
    color: var(--n-text-color, #fff);
    line-height: 17px;
    margin-bottom: 10px;

    .count {
      font-style: normal;
      font-size: 11px;
      padding: 0 5px;
      border-radius: 8px;
      color: #8b93a3;
      background: rgba(127, 127, 127, 0.18);
    }
  }
}

/* ---------------- L1 一级设置：可折叠 ---------------- */
.grp {
  margin-bottom: 8px;
}

.grp-head {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 9px;
  box-sizing: border-box;
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
  border-left: 2px solid #3a89ff;
  background: rgba(58, 137, 255, 0.1);
  transition: background 0.16s;

  &:hover {
    background: rgba(58, 137, 255, 0.17);
  }
}

/* 展开时朝下，收起时朝右 */
.grp-arrow {
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid rgba(255, 255, 255, 0.62);
  transform: rotate(-90deg);
  transition: transform 0.18s;

  &.open {
    transform: rotate(0deg);
  }
}

.grp-title {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color, #fff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.grp-badge {
  flex: 0 0 auto;
  font-style: normal;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 8px;
  color: #9fb4cc;
  background: rgba(127, 127, 127, 0.2);
}

.grp-body {
  padding: 10px 0 2px 8px;
}

/* ---------------- L2 二级设置：带左边框的缩进块 ----------------
   框架设置下的「侧栏 / 对话区 / 尺寸」、主题下的「自定义主题」
   与两个清单条目里的「对话配置 / 智能体配置 / 参数」
   共用这一套分组盒（底色 + 左侧色条），保持一致 */
.sub2 {
  margin: 4px 0 12px;
  padding: 9px 10px 4px;
  border-radius: 5px;
  border-left: 2px solid rgba(127, 127, 127, 0.34);
  background: rgba(127, 127, 127, 0.07);
}

/* 可手动拖高的多行文本框。
   基座 `@/styles/pages/form.scss` 里有全局 `.n-input { height: 30px }` +
   `.n-input-wrapper { height: … }`，会把 textarea 压成一行；而 naive 的
   `resizable` 只在 **非 autosize** 时才挂 `resize: vertical`（见 Input.mjs）。
   两者叠加导致"能拖但初始只有一行"，所以这里显式给一个确定高度：
   wrapper 有确定 height，textarea 的 height:100% 才是有效值，拖大后也能跟着填满。 */
.ta-grow {
  height: auto;

  :deep(.n-input-wrapper) {
    height: 68px;
    min-height: 40px;
  }

  :deep(.n-input__textarea-el) {
    height: 100%;
    line-height: 1.5;
  }
}

/* 「智能体超时(ms)」标签偏长，n-form-item 默认的左侧网格布局会把它挤成两行/裁掉，
   这里直接改成块级堆叠：标签在上、控件在下，与本组其它字段一致 */
.num-nowrap {
  :deep(.n-form-item) {
    display: block;
  }

  :deep(.n-form-item-label) {
    display: block;
    width: 100%;
    white-space: nowrap;
    text-align: left;
    padding: 0;
    margin-bottom: 6px;
  }

  :deep(.n-form-item-blank) {
    width: 100%;
  }
}

/* ---------------- 滑块行（CustomInputNumberWithSlider）----------------
   平台这个组合控件把三样东西的宽度全写死了：
     标签 62px + 滑块 112px + 数字框 70px = 244px。
   而二级组盒（.sub2，面板 302px 宽时）内容区只有 230px，
   加上 `.n-form-item-blank` 默认 `min-width: auto`（下限 = 内容宽 182px），
   它压不到 168px，于是整行右端顶出盒子边框（用户截图里的现象）。

   修法：滑块是三者里唯一该"弹性"的 —— 标签和数字框保持原尺寸，
   把滑块从写死的 112px 改成吃剩余空间；blank 的 basis 归零、解除 min-content 下限，
   这样窄面板下也不会再把内容挤出去。
   适用：尺寸组「整体缩放」、背景设置「遮罩浓度 / 背景模糊」。 */
.slider-row {
  :deep(.n-form-item) {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
  }

  :deep(.n-form-item .n-form-item-label) {
    /* 固定宽度：若参与收缩，「整体缩放」这种 4 字标签会被压掉笔画 */
    flex: 0 0 62px;
    width: 62px;
  }

  :deep(.n-form-item .n-form-item-blank) {
    flex: 1 1 0;
    width: auto;
    min-width: 0;
    justify-content: space-between;
    gap: 6px;
  }

  :deep(.n-form-item .n-slider) {
    flex: 1 1 0;
    width: auto;
    min-width: 56px;
  }

  :deep(.n-form-item .n-input-number) {
    /* 数字框保持原宽（里面还有上下步进按钮，压窄会切字） */
    flex: 0 0 70px;
    width: 70px;
  }
}

.sub2-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 500;
  color: #9aa3b2;
  margin-bottom: 9px;

  .count {
    font-style: normal;
    font-size: 10.5px;
    padding: 0 5px;
    border-radius: 8px;
    color: #8b93a3;
    background: rgba(127, 127, 127, 0.18);
  }

  /* 二级设置的开关状态徽章：启用时点亮成强调色 */
  .sub2-badge {
    font-style: normal;
    font-size: 10px;
    padding: 0 5px;
    border-radius: 8px;
    color: #8b93a3;
    background: rgba(127, 127, 127, 0.18);

    &.on {
      color: #4fa3ff;
      background: rgba(58, 137, 255, 0.18);
    }
  }
}

/* ---------------- L3 三级设置：二级分组内部的子组 ----------------
   「侧栏显示 / 品牌区设置 / 分组区设置 / 对话区下的四个区域」这类小分组。
   底色必须比 .sub2 更深一档：父层已经是 rgba(127,127,127,.07)，
   子层若用同一个值叠上去完全看不出盒子，等于"背景没生效"，
   所以这里用 .14，让层级在视觉上真的分得开。 */
.sub3 {
  margin: 0 0 10px;
  padding: 8px 9px 2px;
  border-radius: 4px;
  border-left: 2px solid rgba(127, 127, 127, 0.32);
  background: rgba(127, 127, 127, 0.14);

  &:last-child {
    margin-bottom: 2px;
  }
}

.sub3-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  color: #8b93a3;
  margin-bottom: 8px;
}

/* ---------------- 组外标题 ----------------
   位置在分组盒子外面（不是 .sub2-head / .sub3-head），
   字号 / 字重 / 颜色逐项对齐「显示品牌区」这类开关标签的实测值（12px / 400），
   所以它读起来和同一层里的开关文本一样大，只是不自带分组底纹。
   用在「分组区设置」上。 */
.out-head {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 400;
  line-height: 17px;
  color: rgba(255, 255, 255, 0.9);
  margin: 0 0 6px;

  &:first-child {
    margin-top: 0;
  }
}

.bg-note {
  color: #7f8a9a;
}

.tip {
  font-size: 11px;
  line-height: 1.6;
  color: #808792;
  margin: 2px 0 10px;

  code {
    padding: 0 3px;
    border-radius: 3px;
    background: rgba(127, 127, 127, 0.22);
    font-family: Consolas, Monaco, monospace;
  }
}

.field {
  margin-bottom: 10px;

  .field-label {
    font-size: 12px;
    color: #aaaaaa;
    margin-bottom: 6px;
  }
}

.row-item {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

/* 主题选择 */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}

.theme-cell {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px;
  border-radius: 6px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  cursor: pointer;
  transition: border-color 0.16s, background 0.16s;

  &:hover {
    border-color: rgba(58, 137, 255, 0.6);
  }

  &.active {
    border-color: #3a89ff;
    background: rgba(58, 137, 255, 0.12);
  }
}

.theme-swatch {
  display: flex;
  gap: 3px;
  height: 22px;
  padding: 3px;
  border-radius: 4px;
  border: 1px solid rgba(127, 127, 127, 0.3);

  i {
    flex: 1;
    border-radius: 2px;
  }
}

.theme-name {
  font-size: 11px;
  color: #bcc9d4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 背景选择 */
.bg-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  margin-bottom: 10px;
}

.bg-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;

  &:hover .bg-thumb {
    border-color: rgba(58, 137, 255, 0.6);
  }

  &.active .bg-thumb {
    border-color: #3a89ff;
    box-shadow: 0 0 0 1px #3a89ff inset;
  }
}

.bg-thumb {
  display: block;
  height: 38px;
  border-radius: 5px;
  border: 1px solid rgba(127, 127, 127, 0.3);
  background-size: cover !important;
  background-position: center !important;
  transition: border-color 0.16s;
}

.bg-name {
  font-size: 10.5px;
  color: #8b93a3;
  text-align: center;
}

/* 清单折叠项 */
.col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 7px;
  }

  /* ⚠️ 名称（.col-name）是 n-ellipsis 的根元素，**不带本组件的 scope 属性**，
     写在这里会被编译成 `.col-name[data-v-x]` 而永不命中，
     于是它一直用着 n-collapse 继承来的 14px。
     真正的样式放在下面 `:deep(.col-head .col-name)` 里（锚在带 scope 的 .col-head 上）。 */

  .col-off {
    font-style: normal;
    font-size: 10px;
    color: #f59e0b;
    white-space: nowrap;
    flex: 0 0 auto;
  }
}

.col-actions {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 2px;
  flex: 0 0 auto;
}

/* 启用开关（无文字标签），置于上移按钮左侧 */
.col-switch {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  margin-right: 6px;
  cursor: pointer;
}

/* form.scss 把 .n-button 全局设成 80×30，会把条目头挤爆 —— 这里按需收窄 */
.col-actions .act {
  flex: 0 0 auto;
  width: 24px;
  min-width: 24px;
  height: 24px;
  padding: 0;
  font-size: 12px;
}

.col-actions .act-del {
  width: 40px;
  min-width: 40px;
}

/* 删除前的二次确认气泡 */
.del-confirm {
  max-width: 210px;
  font-size: 12px;
  line-height: 1.5;

  em {
    display: block;
    margin-top: 4px;
    font-style: normal;
    font-size: 11px;
    opacity: 0.62;
  }
}

:deep(.n-collapse-item__header) {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

/* header-extra 默认 flex-shrink:1，会被 header-main 挤扁导致 ↑ ↓ 删除 显示不全 */
:deep(.n-collapse-item__header-extra) {
  flex: 0 0 auto;
  padding-left: 6px;
}

:deep(.n-collapse-item__header-main) {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

/* 条目头里「展开箭头之前那段名称文字」（.col-name = n-ellipsis 的根元素）。
   必须用 :deep() 锚在带 scope 的 .col-head 上 —— 直接写 `.col-head .col-name`
   会被编译成 `.col-name[data-v-x]`，而组件根元素拿不到这个属性，规则永不生效
   （这正是它一直显示成 n-collapse 继承来的 14px 的原因）。
   尺寸逐项对齐「百炼网关 → 网关地址」标签的实测值：12px / 400 / 17px。 */
:deep(.col-head .col-name) {
  font-size: 12px;
  line-height: 17px;
  flex: 1 1 auto;
  min-width: 0;
}

:deep(.n-collapse-item-arrow) {
  flex: 0 0 auto;
}

:deep(.n-collapse-item__content-inner) {
  padding-left: 0 !important;
  padding-top: 6px !important;
}

/* 参数卡片 */
.param-card {
  padding: 8px;
  margin-bottom: 8px;
  border-radius: 6px;
  border: 1px solid rgba(127, 127, 127, 0.24);
  background: rgba(127, 127, 127, 0.06);
}

.param-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;

  .param-title {
    flex: 1;
    font-size: 12px;
    color: #bcc9d4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* tab 精简到 5 个后不挤了，稍微收一点内边距让整体更紧凑 */
:deep(.n-tabs-nav) {
  .n-tabs-tab {
    padding: 6px 2px !important;
    font-size: 12px;
  }
}
</style>
