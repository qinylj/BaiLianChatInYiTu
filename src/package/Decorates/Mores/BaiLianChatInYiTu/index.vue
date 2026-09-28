<!--
  * @Description: BaiLianChatInYiTu 大模型 / 智能体对话组件
  * 承载：驾驶舱可视化平台「装饰 → 更多」分类
  * 能力：左侧栏（大模型 / 智能体 / 历史对话）+ 主区对话，主题、背景、显隐、清单、参数全部可配
-->
<template>
  <div class="bailian-chat-in-yitu" :class="{ 'is-light': !themePreset.dark }" :style="rootStyle" :data-build="BUILD_TAG">
    <div class="ac-stage" :style="stageStyle">
      <!-- 背景层：只作用于对话区。
           外面套一层裁剪容器，因为 .ac-bg 需要 scale 放大来盖住模糊后的边缘露白，
           而 transform 是以中心为原点放大的，会向上溢出侵入顶部信息栏。 -->
      <div class="ac-bg-clip">
        <div class="ac-bg" :style="bgStyle"></div>
      </div>
      <div class="ac-veil"></div>

      <div class="ac-body">
        <!-- ======================= 左侧栏 ======================= -->
        <aside v-if="o.showSidebar" class="ac-sidebar">
          <div v-if="o.showBrand" class="ac-brand">
            <div class="ac-brand-logo">{{ o.brandIcon || '🤖' }}</div>
            <div class="ac-brand-text">
              <div class="ac-brand-title">{{ o.title }}</div>
              <div class="ac-brand-sub">
                <i class="ac-dot" :data-state="connState"></i>{{ connText }}
              </div>
            </div>
            <button
              v-if="o.showSidebarToggle"
              class="ac-icon-btn"
              title="收起侧栏"
              @click="toggleSidebar"
            >
              <span class="ac-chevron left"></span>
            </button>
          </div>

          <div class="ac-sections">
            <!-- 大模型：高度只占 1.5 份，条目多了自己滚，不再往下顶智能体/历史 -->
            <section v-if="o.showModelSection && enabledModels.length" class="ac-sec models">
              <div class="ac-sec-head">
                <span class="ac-sec-title">{{ o.sectionModelText }}</span>
                <em class="ac-sec-count">{{ enabledModels.length }}</em>
              </div>
              <div class="ac-list scroll">
                <div
                  v-for="m in enabledModels"
                  :key="m.id"
                  class="ac-pick-item"
                  :class="{ active: isActive('model', m.id) }"
                  :style="{ '--a': m.accent || 'var(--ac-accent)' }"
                  @click="switchTarget('model', m.id)"
                >
                  <span class="ac-ava">
                    <img v-if="isImageSrc(m.avatar)" :src="m.avatar" alt="" />
                    <template v-else>{{ m.avatar || '🤖' }}</template>
                  </span>
                  <span class="ac-pick-main">
                    <span class="ac-pick-name">
                      {{ m.name }}
                      <!-- 与智能体同构：大模型也能挂状态标签，底色可按条目单独覆盖 -->
                      <em
                        v-if="m.tagText"
                        class="ac-tag"
                        :style="m.tagBackground ? { '--ac-tag-bg': m.tagBackground } : undefined"
                        >{{ m.tagText }}</em
                      >
                    </span>
                    <span class="ac-pick-desc">{{ m.description }}</span>
                  </span>
                </div>
              </div>
            </section>

            <!-- 智能体 -->
            <section v-if="o.showAgentSection && enabledAgents.length" class="ac-sec agents">
              <div class="ac-sec-head">
                <span class="ac-sec-title">{{ o.sectionAgentText }}</span>
                <em class="ac-sec-count">{{ enabledAgents.length }}</em>
              </div>
              <div class="ac-list scroll">
                <div
                  v-for="a in enabledAgents"
                  :key="a.id"
                  class="ac-pick-item"
                  :class="{ active: isActive('agent', a.id) }"
                  :style="{ '--a': a.accent || 'var(--ac-accent)' }"
                  @click="switchTarget('agent', a.id)"
                >
                  <span class="ac-ava">
                    <img v-if="isImageSrc(a.avatar)" :src="a.avatar" alt="" />
                    <template v-else>{{ a.avatar || '🌊' }}</template>
                  </span>
                  <span class="ac-pick-main">
                    <span class="ac-pick-name">
                      {{ a.name }}
                      <!-- 标签底色可按智能体单独覆盖；没设则继续用主题的 --ac-tag-bg -->
                      <em
                        v-if="a.tagText"
                        class="ac-tag"
                        :style="a.tagBackground ? { '--ac-tag-bg': a.tagBackground } : undefined"
                        >{{ a.tagText }}</em
                      >
                    </span>
                    <span class="ac-pick-desc">{{ a.description }}</span>
                  </span>
                </div>
              </div>
            </section>

            <!-- 历史对话 -->
            <section v-if="o.showHistorySection" class="ac-sec history">
              <div class="ac-sec-head">
                <span class="ac-sec-title">{{ o.sectionHistoryText }}</span>
                <button v-if="o.showNewChatBtn" class="ac-mini-btn" @click="newChat">
                  ＋ {{ o.newChatText }}
                </button>
              </div>
              <div class="ac-list scroll">
                <div v-if="!conversations.length" class="ac-empty">{{ o.emptyHistoryText }}</div>
                <div
                  v-for="c in conversations"
                  :key="c.id"
                  class="ac-conv-item"
                  :class="{ active: c.id === activeId, confirming: confirmDelId === c.id }"
                  :style="{ '--a': accentOfConversation(c) }"
                  @click="openConversation(c.id)"
                >
                  <span class="ac-ava small">
                    <img v-if="isImageSrc(avatarOfConversation(c))" :src="avatarOfConversation(c)" alt="" />
                    <template v-else>{{ avatarOfConversation(c) }}</template>
                  </span>
                  <span class="ac-conv-main">
                    <span class="ac-conv-title">{{ c.title || '新对话' }}</span>
                    <span class="ac-conv-meta">
                      {{ c.targetName }} · {{ c.messages.length }} 条 ·
                      {{ formatClock(c.updatedAt) }}
                    </span>
                  </span>
                  <button class="ac-conv-del" title="删除对话" @click.stop="askRemoveConversation(c.id)">
                    <span class="ac-trash"></span>
                  </button>
                  <!-- 删除不可撤销：点一下就删太危险，先要一次确认（与删除大模型的交互一致）。
                       做成行内确认条而不是浮层 —— 侧栏列表是 overflow-y:auto，浮层会被裁掉 -->
                  <div v-if="confirmDelId === c.id" class="ac-del-confirm" @click.stop>
                    <span class="ac-del-confirm-text">
                      删除「{{ c.title || '新对话' }}」？<em>{{ c.messages.length }} 条消息，删除后不可恢复</em>
                    </span>
                    <button class="ac-del-confirm-btn" @click.stop="cancelRemoveConversation">取消</button>
                    <button class="ac-del-confirm-btn danger" @click.stop="confirmRemoveConversation(c.id)">
                      确认删除
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </aside>

        <!-- ======================= 主区 ======================= -->
        <main class="ac-main">
          <header v-if="o.showTopbar" class="ac-topbar">
            <button
              v-if="!o.showSidebar && o.showSidebarToggle"
              class="ac-icon-btn"
              title="展开侧栏"
              @click="toggleSidebar"
            >
              <span class="ac-burger"><i></i><i></i><i></i></span>
            </button>
            <div class="ac-top-ava" :style="{ '--a': targetAccent }">
              <img v-if="isImageSrc(targetAvatar)" :src="targetAvatar" alt="" />
              <template v-else>{{ targetAvatar }}</template>
            </div>
            <div class="ac-top-text">
              <div class="ac-top-title">{{ targetName }}</div>
              <div class="ac-top-sub">{{ topbarSub }}</div>
            </div>
            <div class="ac-top-right">
              <span class="ac-conn" :data-state="connState">{{ connText }}</span>
              <!-- 停止按钮不在这里：生成中时输入区的发送键会变成停止键（见 .ac-send） -->
              <button
                v-if="o.showActions"
                class="ac-ghost-btn"
                :disabled="!messages.length"
                @click="exportConversation"
              >
                <span class="ac-down-icon"></span>{{ o.exportText }}
              </button>
            </div>
          </header>

          <!-- 消息区 -->
          <div ref="messagesEl" class="ac-messages">
            <!-- 欢迎区：图标 / 欢迎标题 / 欢迎语 / 预设问题 各有一个开关 -->
            <div v-if="!messages.length" class="ac-welcome">
              <div v-if="o.showWelcomeIcon" class="ac-welcome-ava" :style="{ '--a': targetAccent }">
                <img v-if="isImageSrc(targetAvatar)" :src="targetAvatar" alt="" />
                <template v-else>{{ targetAvatar }}</template>
              </div>
              <h3 v-if="o.showWelcomeTitle" class="ac-welcome-title">{{ welcomeTitle }}</h3>
              <p v-if="o.showWelcomeText" class="ac-welcome-text">{{ welcomeText }}</p>
              <div v-if="o.showSuggestions && suggestionList.length" class="ac-sugs">
                <button v-for="(s, i) in suggestionList" :key="i" class="ac-sug" @click="send(s)">
                  {{ s }}
                </button>
              </div>
            </div>

            <!-- 消息列表 -->
            <template v-else>
              <div v-for="m in messages" :key="m.id" class="ac-msg" :class="m.role">
                <div
                  v-if="o.showAvatars"
                  class="ac-msg-ava"
                  :style="{ '--a': m.role === 'user' ? userAccent : targetAccent }"
                >
                  <template v-if="m.role === 'user'">👤</template>
                  <img v-else-if="isImageSrc(targetAvatar)" :src="targetAvatar" alt="" />
                  <template v-else>{{ targetAvatar }}</template>
                </div>
                <div class="ac-msg-body">
                  <!-- 思考过程（面板：基础 → 对话设置 → 显示思考过程）
                       关掉只是不渲染；m.thought 仍照常累积，重新打开就能看到历史那几轮。 -->
                  <!-- 思考过程：生成中自动展开、完成后自动收起（open 跟随 pending，
                       用户手动开合不受影响 —— Vue 只在绑定值变化时才补丁属性） -->
                  <details v-if="o.showThought && m.thought" class="ac-thought" :open="m.pending">
                    <summary>思考过程</summary>
                    <div class="ac-thought-text">{{ m.thought }}</div>
                  </details>
                  <div class="ac-bubble" :class="{ error: m.error }">
                    <span v-if="m.pending && !m.content" class="ac-typing">
                      <i></i><i></i><i></i>
                    </span>
                    <div v-else class="ac-md" v-html="formatMessage(m.content)"></div>
                    <!-- 附件：接口不支持二进制上传，这里把选中的文件以清单形式挂在气泡里 -->
                    <div v-if="m.attachments && m.attachments.length" class="ac-bubble-atts">
                      <span
                        v-for="f in m.attachments"
                        :key="f.id"
                        class="ac-bubble-att"
                        :title="`${f.name}（${formatSize(f.size)}）`"
                      >
                        <img v-if="f.preview" :src="f.preview" alt="" />
                        <i v-else class="ac-ico ac-ico-file"></i>
                        <em>{{ f.name }}</em>
                      </span>
                    </div>
                  </div>

                  <!-- 消息脚注：时间 + 操作图标（复制 / 点赞 / 点踩 / 重答）。
                       图标平时不显示，鼠标移到这条消息上才浮现（见 .ac-msg:hover .ac-acts）。
                       左右对齐跟随消息方向：用户消息右对齐、AI 消息左对齐。 -->
                  <div v-if="o.showTime || !m.pending" class="ac-msg-foot">
                    <span v-if="o.showTime" class="ac-time">{{ formatClock(m.timestamp) }}</span>
                    <span class="ac-acts">
                      <button
                        v-if="!m.pending"
                        class="ac-act"
                        :title="copiedId === m.id ? '已复制' : '复制'"
                        @click="copyMessage(m)"
                      >
                        <svg v-if="copiedId === m.id" class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M3.4 8.5 6.4 11.5 12.7 5.2" />
                        </svg>
                        <svg v-else class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="5.7" y="5.7" width="7.7" height="7.7" rx="1.6" />
                          <path d="M10.4 5.7V4.1A1.7 1.7 0 0 0 8.7 2.4H4.1A1.7 1.7 0 0 0 2.4 4.1v4.6a1.7 1.7 0 0 0 1.7 1.7h1.6" />
                        </svg>
                      </button>
                      <template v-if="o.showFeedback && m.role === 'assistant' && !m.pending && !m.error">
                        <button
                          class="ac-act"
                          :class="{ active: m.vote === 'LIKE' }"
                          title="点赞"
                          @click="vote(m, 'LIKE')"
                        >
                          <svg class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M5.5 7.05 7.9 2.5a1.35 1.35 0 0 1 2.43 1.17L9.7 6.15h2.05a1.35 1.35 0 0 1 1.3 1.72l-1.1 4.2a1.35 1.35 0 0 1-1.3.98H5.5z" />
                            <rect x="2.35" y="7.05" width="3.15" height="6" rx="1.05" />
                          </svg>
                        </button>
                        <button
                          class="ac-act flip"
                          :class="{ active: m.vote === 'DISLIKE' }"
                          title="点踩"
                          @click="vote(m, 'DISLIKE')"
                        >
                          <svg class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M5.5 7.05 7.9 2.5a1.35 1.35 0 0 1 2.43 1.17L9.7 6.15h2.05a1.35 1.35 0 0 1 1.3 1.72l-1.1 4.2a1.35 1.35 0 0 1-1.3.98H5.5z" />
                            <rect x="2.35" y="7.05" width="3.15" height="6" rx="1.05" />
                          </svg>
                        </button>
                      </template>
                      <button
                        v-if="m.role === 'assistant' && !m.pending"
                        class="ac-act"
                        title="重答"
                        @click="regenerate(m)"
                      >
                        <svg class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M13.35 8A5.35 5.35 0 1 1 11.4 4.05" />
                          <path d="M13.5 2.3v3.6h-3.6" />
                        </svg>
                      </button>
                      <!-- 导出单条回答：Word（浏览器里现场生成，零依赖手写 zip + OOXML，
                           默认按党政机关公文格式排版，见 docx.ts）/ 纯文本 .txt / Markdown 原文 .md。
                           TXT 不做结构转换、MD 一个字符都不改（渲染前的原数据），
                           两者都是"先存下来再说"的兜底出口，见 exporter.ts。 -->
                      <template v-if="o.showMsgExport && m.role === 'assistant' && !m.pending && m.content">
                        <button
                          class="ac-act"
                          :class="{ active: exportedKey === m.id + '|docx' }"
                          :disabled="!!exportingId"
                          :title="o.exportWordText"
                          @click="exportMessage(m, 'docx')"
                        >
                          <svg
                            v-if="exportedKey === m.id + '|docx'"
                            class="ac-ico"
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                          >
                            <path d="M3.4 8.5 6.4 11.5 12.7 5.2" />
                          </svg>
                          <!-- 文档轮廓 + 折角 + 中间的 W -->
                          <svg v-else class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M9.2 1.9H4.7A1.7 1.7 0 0 0 3 3.6v8.8a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V5.5z"
                            />
                            <path d="M9.2 1.9v3.6h3.8" />
                            <path d="M5.5 8.6 6.6 11.6 8 9.3l1.4 2.3 1.1-3" />
                          </svg>
                        </button>
                        <button
                          class="ac-act"
                          :class="{ active: exportedKey === m.id + '|txt' }"
                          :disabled="!!exportingId"
                          :title="o.exportTxtText"
                          @click="exportMessage(m, 'txt')"
                        >
                          <svg
                            v-if="exportedKey === m.id + '|txt'"
                            class="ac-ico"
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                          >
                            <path d="M3.4 8.5 6.4 11.5 12.7 5.2" />
                          </svg>
                          <!-- 纯文本：同一张纸，里面是几行文字（不画表格网格） -->
                          <svg v-else class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M9.2 1.9H4.7A1.7 1.7 0 0 0 3 3.6v8.8a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V5.5z"
                            />
                            <path d="M9.2 1.9v3.6h3.8" />
                            <path d="M5.4 8.3h5.2" />
                            <path d="M5.4 10.5h5.2" />
                            <path d="M5.4 12.7h3.1" />
                          </svg>
                        </button>
                        <button
                          class="ac-act"
                          :class="{ active: exportedKey === m.id + '|md' }"
                          :disabled="!!exportingId"
                          :title="o.exportMdText"
                          @click="exportMessage(m, 'md')"
                        >
                          <svg
                            v-if="exportedKey === m.id + '|md'"
                            class="ac-ico"
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                          >
                            <path d="M3.4 8.5 6.4 11.5 12.7 5.2" />
                          </svg>
                          <!-- Markdown 原文：同一张纸 + 中间一个 M（与 Word 那个 W 呼应） -->
                          <svg v-else class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M9.2 1.9H4.7A1.7 1.7 0 0 0 3 3.6v8.8a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V5.5z"
                            />
                            <path d="M9.2 1.9v3.6h3.8" />
                            <path d="M5.4 11.7V8.05l2.6 3.05 2.6-3.05v3.65" />
                          </svg>
                        </button>
                      </template>
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- 参数条（设置面板里叫「显示参数条」，对应 option.showParamBar） -->
          <div v-if="o.showParamBar && paramChips.length" class="ac-params">
            <span v-for="c in paramChips" :key="c.key" class="ac-chip" :title="c.hint">
              <i class="ac-link-icon"></i>{{ c.key }}={{ c.value }}
              <b @click="removeChip(c.key)">×</b>
            </span>
          </div>

          <!-- 输入区 -->
          <div class="ac-composer">
            <!-- 已选附件：随下一条消息一起发出 -->
            <div v-if="attachments.length" class="ac-atts">
              <span
                v-for="f in attachments"
                :key="f.id"
                class="ac-att-chip"
                :title="`${f.name}（${formatSize(f.size)}）`"
              >
                <img v-if="f.preview" :src="f.preview" alt="" />
                <i v-else class="ac-ico ac-ico-file"></i>
                <em>{{ f.name }}</em>
                <b @click="removeAttach(f.id)">×</b>
              </span>
            </div>

            <div class="ac-composer-box" :class="{ 'has-attach': attachments.length }">
              <!-- 附件入口：平时不显示，输入框获得焦点（或已有附件）时才浮现 -->
              <button class="ac-attach-btn" title="添加附件" @click="pickAttach">
                <svg class="ac-ico" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10.1 4.6 5.7 9a1.9 1.9 0 0 0 2.7 2.7l4.5-4.5a3.25 3.25 0 0 0-4.6-4.6L3.6 6.9a4.5 4.5 0 0 0 6.4 6.4l3.1-3.1" />
                </svg>
              </button>
              <input ref="fileEl" class="ac-file" type="file" multiple @change="onFiles" />

              <textarea
                ref="inputEl"
                v-model="inputText"
                class="ac-textarea"
                :placeholder="o.placeholder"
                rows="1"
                @input="autoGrow"
                @keydown="onKeydown"
              ></textarea>

              <!-- 生成中时同一个按钮变成停止键（顶部信息栏的停止按钮已删除） -->
              <button
                class="ac-send"
                :class="{ stopping: busy }"
                :disabled="!busy && !canSend"
                :title="busy ? o.stopText : '发送'"
                @click="busy ? stop() : send()"
              >
                <span v-if="busy" class="ac-stop-icon"></span>
                <span v-else class="ac-send-icon"></span>
              </button>
            </div>
          </div>
          <div class="ac-foot">
            <span>{{ o.inputHint }}</span>
            <span>{{ summaryText }}</span>
          </div>
        </main>
      </div>
    </div>

    <!-- 底部浮现提示：只用于"静默失败"的点（下载被 iframe 拦截、复制不可用），
         不做通用通知系统 —— 大屏上弹 toast 很吵，能不用就不用。 -->
    <div v-if="toast" class="ac-toast">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, PropType } from 'vue'
import { CreateComponentType } from '../../../index.d'
import { useEvent } from '@/package/hooks/useEvent.hook'
import { BACKGROUNDS, THEMES } from './presets'
import { option as defaultOption } from './config'
import {
  createSession,
  deleteSession,
  runAgent,
  runModel,
  sendFeedback,
  uid
} from './api'
// 轻量 Markdown 渲染（自研、零依赖，见 markdown.ts）：标题/列表/代码块/表格/强调等
// renderMarkdownToText 是同一套语法的"纯文本版"，复制/导出时用它去掉语法符号
import { renderMarkdown as formatMessage, renderMarkdownToText } from './markdown'
// 复制：富文本 + 纯文本双形态，非安全上下文也有兜底（见 clipboard.ts）
import { copyMessageText } from './clipboard'
// 导出内容构造（纯函数，见 exporter.ts）：
//   html / txt / md 产出字符串；docx 产出字节（公文 Word，见 docx.ts）
import { buildExport, buildOfficeExport, buildMessageText, buildMessageMarkdown } from './exporter'
// 存盘：Blob + <a download>，非安全上下文（大屏 http 内网 IP）也能用（见 download.ts）
import { saveFile } from './download'
import {
  AgentItem,
  ChatAttachment,
  ChatMessage,
  Conversation,
  GatewayOption,
  GlobalParamsLike,
  ModelItem,
  ParamBinding,
  PublicParamRow,
  StreamChunk,
  TargetKind
} from './types'

/*
 * 构建标识：版本号的唯一来源是本文件末尾那个不带 setup 的 script lang="ts" 块里的 `version` 字段，
 * 构建戳由 build/version.js 在编译时注入（define 成字面量）。
 * 没有注入时（比如被别人单独拷走这个 .vue 用）走 typeof 兜底，不会 ReferenceError。
 * 注意：这里别写出完整的 script 开标签字面量，打包脚本靠它定位版本块（见 build/resolve-file.js）。
 */
declare const __BL_VERSION__: string | undefined
declare const __BL_BUILD__: string | undefined
const BUILD_TAG =
  typeof __BL_VERSION__ === 'undefined'
    ? `dev / ${typeof __BL_BUILD__ === 'undefined' ? '未注入' : __BL_BUILD__}`
    : `${__BL_VERSION__} / ${__BL_BUILD__}`

const props = defineProps({
  chartConfig: {
    type: Object as PropType<CreateComponentType>,
    required: true
  },
  useChartDataFetch: {
    type: Function,
    default: () => {}
  },
  globalParams: {
    type: Object as PropType<GlobalParamsLike>,
    default: () => ({})
  },
  bus: {
    type: Object as any,
    default: () => ({})
  },
  // 平台注入的公共参数（Playground / 大屏都会传）
  publicParamList: {
    type: Array as PropType<PublicParamRow[]>,
    default: () => []
  },
  themeColor: {
    type: Object as any,
    default: () => ({})
  }
})

const emit = defineEmits<{
  (e: 'finishedFn'): void
  (e: 'targetChange', payload: { kind: TargetKind; id: string; name: string }): void
  (e: 'ask', payload: { text: string }): void
  (e: 'reply', payload: { text: string; sessionId: string }): void
  (e: 'error', payload: { message: string }): void
}>()

const { useCustomRendered } = useEvent()
useCustomRendered(() => emit('finishedFn'))

/* ------------------------------------------------------------------ *
 * option 读取（含旧版本配置兼容）
 * ------------------------------------------------------------------ */

/** 逐键兜底：旧版本组件升级上来时，新加的键在旧 option 里不存在，直接取默认值 */
const mergeOption = (raw: any) => {
  const def: any = defaultOption
  const out: any = {}
  const src = raw && typeof raw === 'object' ? raw : {}
  Object.keys(def).forEach(k => {
    const v = src[k]
    out[k] = v === undefined || v === null ? def[k] : v
  })
  // 非顶层对象做二级兜底，避免旧配置缺字段导致渲染期报错
  out.themeOverride = { ...def.themeOverride, ...(src.themeOverride || {}) }
  // 旧配置里色值可能是空串，这里回填默认色，避免任何地方拿到空字符串当颜色用
  ;(['accent', 'accent2', 'text', 'bg', 'radius'] as const).forEach(k => {
    if (!out.themeOverride[k]) out.themeOverride[k] = (def.themeOverride as any)[k]
  })
  out.gateway = { ...def.gateway, ...(src.gateway || {}) }
  out.gateway.paths = { ...def.gateway.paths, ...((src.gateway && src.gateway.paths) || {}) }
  if (!Array.isArray(out.agents)) out.agents = def.agents
  if (!Array.isArray(out.models)) out.models = def.models
  if (!Array.isArray(out.paramBindings)) out.paramBindings = def.paramBindings
  if (!Array.isArray(out.suggestions)) out.suggestions = []
  // 下沉到智能体的字段：旧配置的智能体还没有自己的 paramBindings / apiKey / timeoutMs，
  // 用全局那份兜底。用 map 返回新数组而不是就地改元素，
  // 避免在 def.agents 被复用为源时把模块级默认值改掉。
  out.agents = out.agents.map((a: any) => {
    const needParams = !Array.isArray(a.paramBindings)
    const needKey = a.apiKey === undefined || a.apiKey === null
    const needTimeout = !Number(a.timeoutMs)
    if (!needParams && !needKey && !needTimeout) return a
    return {
      ...a,
      paramBindings: needParams ? JSON.parse(JSON.stringify(out.paramBindings || [])) : a.paramBindings,
      apiKey: needKey ? out.gateway.apiKey || '' : a.apiKey,
      timeoutMs: needTimeout ? Number(out.gateway.timeoutMs) || 120000 : a.timeoutMs
    }
  })
  return out
}

const o = computed<any>(() => mergeOption(props.chartConfig && props.chartConfig.option))

/**
 * 按对话对象解析出真正要用的网关配置。
 * 只有「地址 + 路径」是全局共用的；APP_KEY 与超时优先取该智能体自己的，
 * 智能体没填时回退到全局网关的值 —— 这样旧配置（凭证还写在全局）依旧能跑，
 * 新配置又能让每个智能体用各自的密钥。
 */
const gatewayFor = (agent?: AgentItem | null): GatewayOption => {
  const g: any = o.value.gateway || {}
  const key = (agent && agent.apiKey) || g.apiKey || ''
  const ms = Number(agent && agent.timeoutMs) || Number(g.timeoutMs) || 120000
  return { ...g, apiKey: key, timeoutMs: ms }
}

/**
 * 按 id 找智能体。
 * 故意用全量清单（含已停用）—— 历史会话可能属于后来被停用的智能体，
 * 删除会话 / 反馈时仍要能取到它自己的 Key。
 */
const findAgent = (id?: string): AgentItem | null =>
  ((o.value.agents || []) as AgentItem[]).find(a => a && a.id === id) || null

/* ------------------------------------------------------------------ *
 * 尺寸 / 缩放
 * ------------------------------------------------------------------ */

const attr = computed(() => (props.chartConfig && props.chartConfig.attr) || { w: 900, h: 620 })
const panelW = computed(() => Number(attr.value.w) || 900)
const panelH = computed(() => Number(attr.value.h) || 620)
const scale = computed(() => {
  const s = Number(o.value.scale)
  return s > 0 ? s : 1
})

const stageStyle = computed(() => ({
  width: `${100 / scale.value}%`,
  height: `${100 / scale.value}%`,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left'
}))

/* ------------------------------------------------------------------ *
 * 主题
 * ------------------------------------------------------------------ */

const THEME_VAR_KEYS = [
  'bg', 'panel', 'panelSolid', 'panel2', 'border', 'borderStrong', 'text', 'textDim',
  'textFaint', 'accent', 'accent2', 'accentSoft', 'accentBorder', 'accentGrad',
  'bubbleUser', 'bubbleAi', 'danger', 'ok', 'warn', 'radius', 'shadow', 'glow',
  'headerGrad', 'tagFg', 'tagBg', 'tagBd'
]
const cssVarName = (key: string) => '--ac-' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())

const themePreset = computed(() => THEMES.find(t => t.id === o.value.theme) || THEMES[0])

const toRgba = (color: string, alpha: number) => {
  const m = /^#?([\da-f]{6})$/i.exec(String(color || '').trim())
  if (!m) return color
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const themeVars = computed<Record<string, string>>(() => {
  const vars: Record<string, string> = { ...(themePreset.value.vars as any) }
  const ov = o.value.themeOverride || {}
  // 只有显式开启「自定义覆盖」才应用，否则完全跟随主题预设。
  // （色值字段一律是合法颜色，不再用空串表示"不覆盖"——平台 ColorPicker 不接受空值）
  if (ov.use) {
    if (ov.accent) {
      vars.accent = ov.accent
      vars.accentSoft = toRgba(ov.accent, 0.16)
      vars.accentBorder = toRgba(ov.accent, 0.44)
      vars.accentGrad = `linear-gradient(135deg, ${ov.accent2 || ov.accent}, ${ov.accent})`
      vars.bubbleUser = `linear-gradient(135deg, ${ov.accent2 || ov.accent}, ${ov.accent})`
    }
    if (ov.accent2) vars.accent2 = ov.accent2
    if (ov.text) vars.text = ov.text
    if (ov.bg) vars.bg = ov.bg
    if (ov.radius) vars.radius = ov.radius
  }
  return vars
})

const rootStyle = computed(() => {
  const style: Record<string, string> = {}
  THEME_VAR_KEYS.forEach(k => {
    const v = themeVars.value[k]
    if (v) style[cssVarName(k)] = v
  })
  style.width = `${panelW.value}px`
  style.height = `${panelH.value}px`
  // 字号拆成两个变量，各管一摊：
  //   --ac-fs-input  输入框里的文字（面板：对话区 → 输入区设置）
  //   --ac-fs-chat   消息气泡 + 欢迎页正文（面板：对话区 → 对话内容区）
  // 这里**不再设根元素 font-size** —— 旧写法把输入区字号挂在根上，语义含混：
  // 任何没写 font-size 的后代都会悄悄跟着变（比如 textarea 的 inherit 就是这样生效的），
  // 谁该跟、谁不该跟全凭运气。改成显式变量后，只有引用变量的那两处会变。
  style['--ac-fs-input'] = `${Number(o.value.fontSize) || 13}px`
  style['--ac-fs-chat'] = `${Number(o.value.chatFontSize) || 12.5}px`
  style['--ac-sidebar-w'] = `${Number(o.value.sidebarWidth) || 268}px`
  style['--ac-veil'] = String(Math.min(100, Math.max(0, Number(o.value.backgroundVeil) || 0)) / 100)
  style['--ac-blur'] = `${Number(o.value.backgroundBlur) || 0}px`
  // 背景层要避开的顶部高度：显示顶栏时让出顶栏，不显示时铺满
  style['--ac-topbar-h'] = o.value.showTopbar ? '58px' : '0px'
  return style
})

const bgStyle = computed(() => {
  const custom = String(o.value.backgroundImage || '').trim()
  if (custom) {
    const url = /^(https?:\/\/|data:image\/|\/|\.)/i.test(custom) ? custom : ''
    if (url) return { background: `url("${url}") center / cover no-repeat` }
  }
  const preset = BACKGROUNDS.find(b => b.id === o.value.background)
  return { background: (preset && preset.css) || 'none' }
})

/* ------------------------------------------------------------------ *
 * 对话对象（智能体 / 大模型）
 * ------------------------------------------------------------------ */

const enabledAgents = computed<AgentItem[]>(() =>
  (o.value.agents || []).filter((a: AgentItem) => a && a.enabled !== false)
)
const enabledModels = computed<ModelItem[]>(() =>
  (o.value.models || []).filter((m: ModelItem) => m && m.enabled !== false)
)

// 运行时选中的对象；面板改「默认对话对象」时才回同步，
// 这样组件里点一下切换不会把配置写回去
const localKind = ref<TargetKind>(o.value.targetKind === 'model' ? 'model' : 'agent')
const localId = ref<string>(o.value.targetId || '')
watch(
  () => o.value.targetKind,
  v => {
    localKind.value = v === 'model' ? 'model' : 'agent'
  }
)
watch(
  () => o.value.targetId,
  v => {
    localId.value = v || ''
  }
)

const kindOf = (item: any): TargetKind => (enabledAgents.value.indexOf(item) >= 0 ? 'agent' : 'model')

const target = computed<any>(() => {
  const primary: any[] = localKind.value === 'model' ? enabledModels.value : enabledAgents.value
  const secondary: any[] = localKind.value === 'model' ? enabledAgents.value : enabledModels.value
  return primary.find(i => i.id === localId.value) || primary[0] || secondary[0] || null
})

const targetKind = computed<TargetKind>(() => (target.value ? kindOf(target.value) : localKind.value))
const isActive = (kind: TargetKind, id: string) => targetKind.value === kind && target.value?.id === id

const targetName = computed(() => (target.value && target.value.name) || '未配置对话对象')
const targetAvatar = computed(() => (target.value && target.value.avatar) || '🤖')
const targetAccent = computed(() => (target.value && target.value.accent) || themeVars.value.accent)
const userAccent = computed(() => themeVars.value.accent2)

const welcomeTitle = computed(() => o.value.welcomeTitle || targetName.value)
const welcomeText = computed(() => {
  if (o.value.welcomeText) return o.value.welcomeText
  return (target.value && target.value.welcome) || '请描述需要处置的事件情况。'
})
const suggestionList = computed<string[]>(() => {
  if (Array.isArray(o.value.suggestions) && o.value.suggestions.length) return o.value.suggestions
  const own = target.value && target.value.suggestions
  return Array.isArray(own) ? own : []
})

/* ------------------------------------------------------------------ *
 * 公共参数 & 传给智能体的参数
 * ------------------------------------------------------------------ */

const publicParams = computed<Record<string, any>>(() => {
  const out: Record<string, any> = {}
  const list = props.publicParamList
  if (Array.isArray(list)) {
    list.forEach(p => {
      if (p && p.name) out[p.name] = p.content
    })
  }
  const gp = props.globalParams
  if (gp && gp.params && typeof gp.params === 'object') Object.assign(out, gp.params)
  return out
})

interface Chip {
  key: string
  label: string
  value: string
  hint: string
  locked: boolean
}

/**
 * 本次运行内被 × 掉的参数（只影响界面展示，不写回配置，刷新/重载即恢复）。
 * 注意：必须声明在 paramChips 之前 —— computed 的 getter 会引用它，声明在后会踩 TDZ。
 */
const dismissedParams = ref<string[]>([])

const paramChips = computed<Chip[]>(() => {
  // ★ 参数挂在每个智能体自己身上（agent.paramBindings），不同业务带的 metadata 不同。
  //   大模型是直连 /chat/completions 的，协议里没有 metadata 概念，因此不参与参数绑定。
  const t: any = target.value
  const list: ParamBinding[] =
    t && kindOf(t) === 'agent' && Array.isArray(t.paramBindings) ? t.paramBindings : []
  const out: Chip[] = []
  list.forEach(b => {
    if (!b || b.enabled === false) return
    const key = b.name || b.label
    if (!key) return
    const isPublic = b.source === 'public'
    const raw = isPublic ? publicParams.value[b.paramKey || key] : b.value
    const value = raw === null || raw === undefined || raw === '' ? '' : String(raw)
    if (!value) return
    out.push({
      key,
      label: b.label || key,
      value,
      hint: isPublic ? `取自大屏公共参数：${b.paramKey || key}` : '组件内配置的固定值',
      locked: false
    })
  })
  // 运行时被手动删掉的，本次运行内不再下发
  return out.filter(c => !dismissedParams.value.includes(c.key))
})

/** 本次运行内被 × 掉的参数（不写回配置） */
const removeChip = (key: string) => {
  if (dismissedParams.value.indexOf(key) < 0) dismissedParams.value = [...dismissedParams.value, key]
}

const buildMetadata = () => {
  const md: Record<string, any> = {}
  paramChips.value.forEach(c => {
    md[c.key] = c.value
  })
  return md
}

/* ------------------------------------------------------------------ *
 * 会话与历史
 * ------------------------------------------------------------------ */

const storeKey = computed(() => `bailian-chat-in-yitu:${(props.chartConfig && props.chartConfig.id) || 'default'}`)

/**
 * 旧桶前缀：组件从 AgentChatE01 改名而来，老会话还躺在 `agent-chat-e01:<实例id>` 里。
 * 不搬的话，用户看到的就是"改了个名，历史全没了" —— 数据其实一条都没丢，只是换了桶。
 */
const LEGACY_PREFIX = 'agent-chat-e01:'
const legacyStoreKey = computed(
  () => `${LEGACY_PREFIX}${(props.chartConfig && props.chartConfig.id) || 'default'}`
)

/**
 * 把旧桶的历史搬到新桶：只在「新桶空 + 旧桶有货」时做，搬完删旧桶。
 * 全程尽量而为 —— 搬不动就留着旧桶下次再试，**绝不覆盖新桶里已有的数据**。
 */
const migrateLegacyStore = () => {
  try {
    const from = legacyStoreKey.value
    const raw = window.localStorage.getItem(from)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) {
      /* 空桶没有迁移价值，顺手清掉，别让它一直占着配额 */
      window.localStorage.removeItem(from)
      return
    }
    /* 先写新桶、再删旧桶：万一中途配额炸了，旧数据还在 */
    /* ★ 只在「新桶为空」时才搬。用户已经在新名下攒了新会话，就绝不能用老数据把它盖掉 */
    if (window.localStorage.getItem(storeKey.value)) return
    window.localStorage.setItem(storeKey.value, raw)
    window.localStorage.removeItem(from)
  } catch (e) {
    /* 迁移失败不影响本次对话 */
  }
}

const conversations = ref<Conversation[]>([])
const activeId = ref<string>('')
const activeConv = computed<Conversation | null>(
  () => conversations.value.find(c => c.id === activeId.value) || null
)
const messages = computed<ChatMessage[]>(() => (activeConv.value ? activeConv.value.messages : []))

const loadStore = () => {
  if (!o.value.persistHistory) return
  /* 改名后的第一次加载：先把旧桶的历史搬过来，再走正常读取 */
  migrateLegacyStore()
  try {
    const raw = window.localStorage.getItem(storeKey.value)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      conversations.value = parsed
        .filter((c: any) => c && c.id)
        .map((c: any) => ({ ...c, messages: Array.isArray(c.messages) ? c.messages : [] }))
      const limit = Number(o.value.maxHistoryCount) || 30
      conversations.value = conversations.value.slice(0, Math.max(1, limit))
      if (conversations.value[0]) activeId.value = conversations.value[0].id
    }
  } catch (e) {
    // 历史损坏 / 隐私模式下读不到，直接当空
    conversations.value = []
  }
}

const saveStore = () => {
  if (!o.value.persistHistory) return
  try {
    const limit = Math.max(1, Number(o.value.maxHistoryCount) || 30)
    if (conversations.value.length > limit) {
      conversations.value = conversations.value.slice(0, limit)
    }
    window.localStorage.setItem(storeKey.value, JSON.stringify(conversations.value))
  } catch (e) {
    // 配额超限就放弃持久化，不影响本次对话
  }
}

const newConversation = (t: any, forceNew = false): Conversation => {
  const kind = kindOf(t)
  if (!forceNew) {
    const cur = activeConv.value
    if (cur && cur.targetKind === kind && cur.targetId === t.id) return cur
    const reuse = conversations.value.find(
      c => c.targetKind === kind && c.targetId === t.id && !c.messages.length
    )
    if (reuse) {
      activeId.value = reuse.id
      return reuse
    }
  }
  const conv: Conversation = {
    id: uid('conv'),
    title: '',
    targetKind: kind,
    targetId: t.id,
    targetName: t.name,
    sessionId: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  conversations.value = [conv, ...conversations.value]
  activeId.value = conv.id
  /**
   * ★ 返回「响应式数组里的代理对象」，而不是上面那个裸对象。
   *   返回裸对象时，调用方后续对它的任何修改（追加流式文字、把 pending 置回 false）
   *   都发生在响应式系统之外，不会触发重渲染 ——
   *   表现就是「点了停止 / 请求出错后，气泡一直停在『正在输入』，
   *   直到界面上别的地方碰巧有响应式变化才刷新出来」。
   */
  return conversations.value.find(c => c.id === conv.id) || conv
}

const newChat = () => {
  if (busy.value) stop()
  dismissedParams.value = []
  const t = target.value
  if (!t) return
  newConversation(t, true)
  saveStore()
}

const openConversation = (id: string) => {
  if (busy.value) stop()
  activeId.value = id
  const c = activeConv.value
  if (c && c.targetKind && c.targetId) {
    localKind.value = c.targetKind
    localId.value = c.targetId
  }
  nextTick(scrollToBottom)
}

/**
 * 删除会话要先确认（对齐面板里「删除大模型」的交互）：
 * 会话是唯一留存的对话记录，点错一下就没了，且本地与网关两侧都删。
 * 这里只记"待确认的那一条 id"，真正的删除仍走 removeConversation。
 */
const confirmDelId = ref('')
const askRemoveConversation = (id: string) => {
  /* 再点一次同一个图标 = 收起，不用专门去点取消 */
  confirmDelId.value = confirmDelId.value === id ? '' : id
}
const cancelRemoveConversation = () => {
  confirmDelId.value = ''
}
const confirmRemoveConversation = async (id: string) => {
  confirmDelId.value = ''
  await removeConversation(id)
}
/* 点别处 / 按 Esc 都算放弃 */
const onDocClickForDel = (e: MouseEvent) => {
  if (!confirmDelId.value) return
  const t = e.target as HTMLElement | null
  if (t && t.closest('.ac-del-confirm, .ac-conv-del')) return
  confirmDelId.value = ''
}
const onKeyForDel = (e: KeyboardEvent) => {
  if (e.key === 'Escape') confirmDelId.value = ''
}

const removeConversation = async (id: string) => {
  const conv = conversations.value.find(c => c.id === id)
  conversations.value = conversations.value.filter(c => c.id !== id)
  if (activeId.value === id) activeId.value = conversations.value[0] ? conversations.value[0].id : ''
  saveStore()
  // 顺带把网关上的会话删掉，失败不影响本地。
  // 会话是按对话对象建的，取它自己那份凭证去删。
  if (conv && conv.sessionId) {
    const convGw = gatewayFor(conv.targetKind === 'agent' ? findAgent(conv.targetId) : null)
    if (convGw.apiKey) {
      try {
        await deleteSession(convGw, conv.sessionId)
      } catch (e) {
        /* 忽略 */
      }
    }
  }
}

const accentOfConversation = (c: Conversation) => {
  const list: any[] = c.targetKind === 'model' ? enabledModels.value : enabledAgents.value
  const hit = list.find(i => i.id === c.targetId)
  return (hit && hit.accent) || themeVars.value.accent
}
const avatarOfConversation = (c: Conversation) => {
  const list: any[] = c.targetKind === 'model' ? enabledModels.value : enabledAgents.value
  const hit = list.find(i => i.id === c.targetId)
  return (hit && hit.avatar) || (c.targetKind === 'model' ? '🤖' : '🌊')
}

const switchTarget = (kind: TargetKind, id: string) => {
  if (busy.value) stop()
  dismissedParams.value = []
  localKind.value = kind
  localId.value = id
  const t = target.value
  emit('targetChange', { kind, id, name: (t && t.name) || '' })
  if (t) newConversation(t)
  nextTick(scrollToBottom)
}

/* ------------------------------------------------------------------ *
 * 发送 / 流式
 * ------------------------------------------------------------------ */

const inputText = ref('')
const busy = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const messagesEl = ref<HTMLElement | null>(null)
let abortCtrl: AbortController | null = null

/* ---------------- 附件 ----------------
 * 对话接口只吃文本，没有二进制上传通道，所以附件走"选中 → 挂在消息上 →
 * 以文件名清单随文本一起发出"的路径：界面上如实展示用户选了哪些文件，
 * 模型侧则拿到一份文件名备注，能据此追问内容。 */

/** 生成 dataURL 预览的体积上限：base64 会让 localStorage 配额很快见底 */
const PREVIEW_MAX = 512 * 1024

/** 已选待发附件 */
const attachments = ref<ChatAttachment[]>([])
const fileEl = ref<HTMLInputElement | null>(null)

const formatSize = (n: number) => {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

const pickAttach = () => {
  // 点隐藏的 file input。用户取消选择时不会影响输入框里已有的文字。
  if (fileEl.value) fileEl.value.click()
}

const onFiles = (e: Event) => {
  const input = e.target as HTMLInputElement
  const files: File[] = Array.from(input.files || [])
  files.forEach(f => {
    const item: ChatAttachment = { id: uid('att'), name: f.name, size: f.size, type: f.type || '' }
    if (/^image\//i.test(f.type) && f.size <= PREVIEW_MAX) {
      const reader = new FileReader()
      reader.onload = () => {
        item.preview = String(reader.result || '')
      }
      reader.readAsDataURL(f)
    }
    attachments.value.push(item)
  })
  // 必须清空，否则连续选同一个文件不会再触发 change 事件
  input.value = ''
}

const removeAttach = (id: string) => {
  attachments.value = attachments.value.filter(a => a.id !== id)
}

/** 附件清单转成给模型看的备注（纯文本通道，没有真正的文件上传） */
const attachNote = (list?: ChatAttachment[]) => {
  if (!list || !list.length) return ''
  return `\n\n【附件】${list.map(a => `${a.name}（${formatSize(a.size)}）`).join('、')}`
}

const canSend = computed(() => (!!inputText.value.trim() || !!attachments.value.length) && !busy.value)

const autoGrow = () => {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 96) + 'px'
}

const scrollToBottom = () => {
  const el = messagesEl.value
  if (el) el.scrollTop = el.scrollHeight
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Enter') return
  if (e.shiftKey) return
  e.preventDefault()
  if (canSend.value) send()
}

const ensureSession = async (
  conv: Conversation,
  agent: AgentItem,
  gw: GatewayOption,
  signal: AbortSignal
) => {
  if (conv.sessionId) return conv.sessionId
  const sid = await createSession(gw, agent.agentCode, agent.agentVersion, signal)
  conv.sessionId = sid
  return sid
}

const onChunkInto = (msg: ChatMessage) => (chunk: StreamChunk) => {
  // 用户中途切走了会话也继续收流，增量始终写回发起时那条消息
  /* 上游只给了 </think>、没给 <think> 时，闭合标签之前的输出其实都是思考过程。
     流式下那段文字已经当正文渲染出去了，没法在 api 层回头改，
     所以在收到这个标记时把已累积的正文整段挪进思考块（本片新到的正文随后接上）。 */
  if (chunk.strayClose && msg.content) {
    msg.thought += msg.content
    msg.content = ''
  }
  if (chunk.thought) msg.thought += chunk.thought
  if (chunk.text) msg.content += chunk.text
  if (chunk.image) {
    msg.content += `${msg.content ? '\n' : ''}![图片](${chunk.image})`
  }
  if (chunk.requestId) msg.requestId = chunk.requestId
  if (chunk.taskId) msg.taskId = chunk.taskId
  scrollToBottom()
}

const send = async (preset?: string) => {
  const text = String(preset != null ? preset : inputText.value).trim()
  const atts = attachments.value.slice()
  // 只选了附件、没打字也允许发出
  if ((!text && !atts.length) || busy.value) return
  const t = target.value
  if (!t) {
    pushLocalError('未配置对话对象，请先在右侧设置面板里添加智能体或大模型')
    return
  }
  if (preset == null) inputText.value = ''
  attachments.value = []
  nextTick(autoGrow)

  const conv = newConversation(t)
  ;(conv as any).targetName = t.name

  conv.messages.push({
    id: uid('u'),
    role: 'user',
    content: text,
    attachments: atts.length ? atts : undefined,
    thought: '',
    timestamp: Date.now(),
    error: false,
    pending: false,
    requestId: '',
    taskId: '',
    vote: ''
  })
  if (!conv.title && text) conv.title = text.length > 16 ? text.slice(0, 16) + '…' : text

  let aiMsg: ChatMessage = {
    id: uid('a'),
    role: 'assistant',
    content: '',
    thought: '',
    timestamp: Date.now(),
    error: false,
    pending: true,
    requestId: '',
    taskId: '',
    vote: ''
  }
  conv.messages.push(aiMsg)
  /* ★ 立刻从响应式数组里取回这条消息的代理对象。
     push 进去的是裸对象，直接改它不会触发重渲染：流式增量写了、pending 改了，
     界面却不动（要等别处有响应式变化才"补刷"）。取回代理后下面所有赋值都在响应式内。 */
  aiMsg = conv.messages[conv.messages.length - 1] as ChatMessage
  conv.updatedAt = Date.now()
  busy.value = true
  scrollToBottom()
  emit('ask', { text })

  abortCtrl = new AbortController()
  const signal = abortCtrl.signal

  try {
    const kind = kindOf(t)
    if (kind === 'agent') {
      const agent = t as AgentItem
      // 地址全局共用，密钥与超时取该智能体自己的（未填则回退全局）
      const gw = gatewayFor(agent)
      const sessionId = await ensureSession(conv, agent, gw, signal)
      await runAgent(
        gw,
        sessionId,
        { text: text + attachNote(atts), metadata: buildMetadata() },
        onChunkInto(aiMsg),
        o.value.stream !== false,
        signal
      )
    } else {
      const model = t as ModelItem
      const history = conv.messages
        .filter(m => !m.pending && m.id !== aiMsg.id && (m.content || (m.attachments && m.attachments.length)))
        .slice(-Math.max(1, Number(o.value.contextLimit) || 10))
        .map(m => ({ role: m.role, content: (m.content || '') + attachNote(m.attachments) }))
      await runModel(
        {
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          model: model.model,
          system: model.system,
          temperature: model.temperature,
          maxTokens: model.maxTokens,
          // 大模型没有自己的超时字段，沿用网关的超时作为兜底
          timeoutMs: Number(o.value.gateway.timeoutMs) || 120000
        },
        history,
        onChunkInto(aiMsg),
        o.value.stream !== false,
        signal
      )
    }
    // 只拿到思考、没拿到正文也要说一声，否则气泡是空的（模型把内容全写进 <think> 且没闭合时会这样）
    if (!aiMsg.content && !aiMsg.thought) aiMsg.content = '（本轮无返回内容）'
    else if (!aiMsg.content) aiMsg.content = '（本轮只返回了思考过程，没有正文）'
    emit('reply', { text: aiMsg.content, sessionId: conv.sessionId })
    if (props.bus && typeof props.bus.emit === 'function') {
      props.bus.emit('agent-chat:reply', { text: aiMsg.content, sessionId: conv.sessionId })
    }
  } catch (err: any) {
    const aborted = err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))
    if (aborted) {
      aiMsg.content = aiMsg.content || ''
      aiMsg.content += `${aiMsg.content ? '\n\n' : ''}_（已停止）_`
    } else {
      const msg = (err && err.message) || String(err)
      aiMsg.error = true
      aiMsg.content += `${aiMsg.content ? '\n\n' : ''}⚠️ ${msg}`
      emit('error', { message: msg })
      if (props.bus && typeof props.bus.emit === 'function') {
        props.bus.emit('agent-chat:error', { message: msg })
      }
    }
  } finally {
    aiMsg.pending = false
    busy.value = false
    abortCtrl = null
    conv.updatedAt = Date.now()
    saveStore()
    nextTick(scrollToBottom)
  }
}

const pushLocalError = (message: string) => {
  const t = target.value
  const conv = t ? newConversation(t) : activeConv.value
  if (!conv) return
  conv.messages.push({
    id: uid('e'),
    role: 'assistant',
    content: `⚠️ ${message}`,
    thought: '',
    timestamp: Date.now(),
    error: true,
    pending: false,
    requestId: '',
    taskId: '',
    vote: ''
  })
  saveStore()
}

const stop = () => {
  if (abortCtrl) {
    try {
      abortCtrl.abort()
    } catch (e) {
      /* 忽略 */
    }
  }
  busy.value = false
}

/** 刚被复制的消息 id，用于把复制图标短暂换成对勾 */
const copiedId = ref('')

/**
 * 复制一条消息。
 *
 * 给的是**渲染后的内容**，不是 Markdown 原文：
 *   - 富文本片（text/html）= renderMarkdown 的结果，粘到 Word / 邮件里还是标题、列表、表格；
 *   - 纯文本片（text/plain）= renderMarkdownToText 的结果，语法符号已经剥掉，
 *     粘到记事本 / 输入框里不会出现一堆 `**` 和 `|`。
 * 具体怎么落到剪贴板（execCommand 富文本优先，逐级兜底）见 clipboard.ts。
 */
const copyMessage = async (msg: ChatMessage) => {
  const text = msg.content || ''
  if (!text) return
  const ok = await copyMessageText(formatMessage(text), renderMarkdownToText(text))
  if (!ok) return
  copiedId.value = msg.id
  window.setTimeout(() => {
    if (copiedId.value === msg.id) copiedId.value = ''
  }, 1500)
}

/**
 * 重答：砍掉这条回答所在的整轮（用户提问 + 其后的全部消息），
 * 用它原本的文字与附件重新走一遍 send —— 复用同一条链路（会话、参数、事件都一致）。
 * 用户此刻正在输入的内容与已选附件做完还回去，不被这次重答吞掉。
 */
const regenerate = (msg: ChatMessage) => {
  if (busy.value) return
  const conv = activeConv.value
  if (!conv) return
  const idx = conv.messages.findIndex(x => x.id === msg.id)
  if (idx < 0) return
  let userIdx = -1
  for (let i = idx - 1; i >= 0; i--) {
    if (conv.messages[i].role === 'user') {
      userIdx = i
      break
    }
  }
  if (userIdx < 0) return
  const userMsg = conv.messages[userIdx]
  const askText = userMsg.content || ''
  const askAtts = userMsg.attachments
  conv.messages.splice(userIdx, conv.messages.length - userIdx)
  conv.updatedAt = Date.now()
  dismissedParams.value = []

  const keepText = inputText.value
  const keepAtts = attachments.value
  attachments.value = askAtts && askAtts.length ? askAtts.map(a => ({ ...a })) : []
  send(askText)
  // send 的同步段已经把这两样读走并清空，这里把用户原本在编辑的内容还回去
  inputText.value = keepText
  attachments.value = keepAtts
}

const vote = async (msg: ChatMessage, v: 'LIKE' | 'DISLIKE') => {
  const conv = activeConv.value
  if (!conv || !msg.requestId) return
  const next = msg.vote === v ? '' : v
  msg.vote = next
  if (!next) return
  try {
    // 反馈走网关，同样要带上该会话所属智能体自己的凭证
    await sendFeedback(gatewayFor(conv.targetKind === 'agent' ? findAgent(conv.targetId) : null), {
      sessionId: conv.sessionId,
      requestId: msg.requestId,
      taskId: msg.taskId,
      vote: next
    })
  } catch (e) {
    /* 反馈失败不影响对话 */
  }
}

/* ------------------------------------------------------------------ *
 * 导出
 * ------------------------------------------------------------------ */

/**
 * 导出当前会话。
 * 内容由 exporter.ts 构造（纯函数）：
 *   html（默认）= 渲染后的排版，自包含单文件，双击可看 / 可直接粘进 Word
 *   txt  = 渲染后的纯文本，带 BOM（Windows 记事本不糊中文）
 *   md   = 原始 Markdown 源码，留档用
 *   docx = 公文格式 Word（内容是字节，不是字符串）
 * 具体格式由 option.exportFormat 决定。
 */
const exportConversation = () => {
  const conv = activeConv.value
  if (!conv || !conv.messages.length) return
  const res = buildExport(conv, o.value.exportFormat, new Date().toLocaleString('zh-CN'), {
    preset: o.value.docxPreset,
    titleFont: o.value.docxTitleFont
  })
  // Office 格式给的是字节，其余是字符串 —— 统一交给 saveFile 落盘
  const data = res.bytes ? res.bytes : res.content
  if (!saveFile(res.fileName, data, res.mime)) showToast('导出失败：浏览器拦截了下载')
}

/* ------------------------------------------------------------------ *
 * 消息级导出（脚注里的「导出 Word / 导出 TXT / 导出 MD」按钮）
 * ------------------------------------------------------------------ */

/** 正在生成文件的消息 id：生成是同步的，但长文档要几十毫秒，用状态兜住重复点击 */
const exportingId = ref('')
/** 刚导出成功的按钮，值为 `${消息id}|${格式}` —— 三个按钮各自变对勾 */
const exportedKey = ref('')

/** 消息级导出的三种格式 */
type MsgExportKind = 'docx' | 'txt' | 'md'

/** 失败提示里的中文名 */
const exportKindLabel: Record<MsgExportKind, string> = {
  docx: '导出 Word',
  txt: '导出 TXT',
  md: '导出 Markdown'
}

/**
 * 把单条回答导出成文件。
 *
 *   docx —— 浏览器里现场生成：零依赖手写 zip + OOXML（见 zip.ts / docx.ts），
 *           不经过服务端，也不引任何第三方 Office 库 —— 运行组件是要跟着大屏一起加载的。
 *   txt  —— "渲染后的纯文本"（见 exporter.buildMessageText），不做结构转换，
 *           所以永远不会因为某段 Markdown 没被认出来而丢内容。
 *   md   —— "渲染前的原数据"（见 exporter.buildMessageMarkdown），
 *           一个字符都不改：不转结构、不改换行、不加 BOM，方便留档 / 二次加工 / diff。
 *
 * Word 的文档标题这里不指定：exporter 会取正文里第一个标题当标题、并把那一行从正文摘掉，
 * 否则同一句话会先以二号小标宋居中显示一次、下面又以一级标题显示一次，看着像出错。
 * 正文里没有标题时才退化成"首段前 24 字"，再没有就用"文档"
 * （TXT / MD 的文件名走同一套规则，同一条回答导出的三个文件前缀一致）。
 */
const exportMessage = (msg: ChatMessage, kind: MsgExportKind) => {
  if (exportingId.value) return
  const text = msg.content || ''
  if (!text) return
  exportingId.value = msg.id
  try {
    const res =
      kind === 'txt'
        ? buildMessageText(text)
        : kind === 'md'
          ? buildMessageMarkdown(text)
          : buildOfficeExport(text, {
              preset: o.value.docxPreset,
              titleFont: o.value.docxTitleFont,
              meta: [`导出时间：${new Date().toLocaleString('zh-CN')}`]
            })
    // Word 给的是字节，TXT / MD 给的是字符串 —— 统一交给 saveFile 落盘
    const data = res.bytes && res.bytes.length ? res.bytes : res.content
    if (!data.length) throw new Error('empty')
    if (!saveFile(res.fileName, data, res.mime)) throw new Error('blocked')
    exportedKey.value = `${msg.id}|${kind}`
    window.setTimeout(() => {
      if (exportedKey.value === `${msg.id}|${kind}`) exportedKey.value = ''
    }, 1600)
  } catch (e) {
    // 大屏常在 iframe 里预览，父页面没给 allow-downloads 时点击是静默无效的 ——
    // 这种情况必须说出来，否则用户以为按钮坏了（见 download.ts 顶部说明）
    showToast(exportKindLabel[kind] + '失败：浏览器拦截了下载，试试在新窗口打开大屏，或先复制内容')
  } finally {
    exportingId.value = ''
  }
}

/* ------------------------------------------------------------------ *
 * 轻量提示条
 * ------------------------------------------------------------------ */

/**
 * 底部浮现一行提示，2.6 秒后自动消失。
 * 只在"静默失败"的地方用（下载被 iframe 拦截、复制不可用），不做通用通知系统。
 */
const toast = ref('')
let toastTimer = 0
const showToast = (text: string) => {
  toast.value = text
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 2600)
}

/* ------------------------------------------------------------------ *
 * 渲染辅助
 * ------------------------------------------------------------------ */

const isImageSrc = (v: string) =>
  !!v && /^(https?:\/\/|data:image\/|\/|\.\/|\.\.\/)/i.test(String(v).trim())

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n))
const formatClock = (ts: number) => {
  const d = new Date(ts || Date.now())
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/* ------------------------------------------------------------------ *
 * 状态文案
 * ------------------------------------------------------------------ */

const configured = computed(() => {
  const t = target.value
  if (!t) return false
  if (targetKind.value === 'agent') {
    // Key 看该智能体自己的（未填回退全局），编码必须填
    return !!(gatewayFor(t as AgentItem).apiKey && (t as AgentItem).agentCode)
  }
  return !!(t as ModelItem).baseUrl
})

const connState = computed(() => {
  if (busy.value) return 'running'
  return configured.value ? 'ok' : 'warn'
})

const connText = computed(() => {
  if (busy.value) return o.value.runningText
  if (!configured.value) return targetKind.value === 'agent' ? '未配置网关密钥' : '未配置模型地址'
  return o.value.connectedText
})

const topbarSub = computed(() => {
  const conv = activeConv.value
  // 生成中优先：否则流式回复时副标题还停在"未建立会话"，看着像没连上
  if (busy.value) return o.value.runningText
  if (!conv) return o.value.idleText
  if (conv.sessionId) return `会话 ${conv.sessionId.slice(0, 8)}…`
  /* 没有会话号时分两种情况：
     - 大模型是直连 /chat/completions，本来就不会创建会话，
       这时写"未建立会话（首轮自动创建）"是错的（永远等不到首轮）；
     - 智能体首轮之前确实会建会话，才用 idleText 那句。 */
  if (conv.targetKind === 'model') return o.value.directText
  return o.value.idleText
})

const summaryText = computed(
  () => `${enabledAgents.value.length} 个智能体 · ${enabledModels.value.length} 个大模型`
)

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */

const toggleSidebar = () => {
  // o 是 mergeOption 出来的新对象，改它不会落回配置；
  // 必须写到真实的 option 上，否则下一次 computed 重算就还原了。
  const raw = props.chartConfig && props.chartConfig.option
  if (raw) (raw as any).showSidebar = !o.value.showSidebar
}

const destroy = () => {
  if (busy.value) stop()
  dismissedParams.value = []
}

// 平台「隐藏即销毁」会调这个（官方拼写就是 destory，两个名字都暴露以防万一）
defineExpose({ destoryComponent: destroy, destroyComponent: destroy })

watch(
  () => o.value.persistHistory,
  v => {
    if (v) saveStore()
  }
)

// 组件实例 id 变化（列表里复制粘贴组件）时切换存储桶
watch(storeKey, () => {
  conversations.value = []
  activeId.value = ''
  loadStore()
})

loadStore()

if (typeof props.useChartDataFetch === 'function') {
  try {
    props.useChartDataFetch()
  } catch (e) {
    /* 该 hook 由平台注入，缺图表上下文时可能抛错，不影响对话功能 */
  }
}

/* 删除确认的"点别处/按 Esc 取消"：捕获阶段监听，避免被行内的 @click.stop 吃掉 */
onMounted(() => {
  /* 出包后在大屏上"这张页面跑的是哪一版"一目了然：根节点 data-build 属性 + 一行控制台日志 */
  console.info(`[BaiLianChatInYiTu] 版本 ${BUILD_TAG}`)
  document.addEventListener('click', onDocClickForDel, true)
  document.addEventListener('keydown', onKeyForDel)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClickForDel, true)
  document.removeEventListener('keydown', onKeyForDel)
  destroy()
})
</script>

<script lang="ts">
export default {
  name: 'BaiLianChatInYiTu',
  version: '1.0.6'
}
</script>

<style lang="scss" scoped>
/* ==========================================================================
   全部颜色走 CSS 变量（--ac-*），变量由组件根节点内联注入，主题切换不需要改这里
   ========================================================================== */
.bailian-chat-in-yitu {
  position: relative;
  overflow: hidden;
  border-radius: var(--ac-radius);
  background: var(--ac-bg);
  color: var(--ac-text);
  font-family: PingFang SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.6;
  box-sizing: border-box;

  * {
    box-sizing: border-box;
  }
}

.ac-stage {
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 背景只作用于对话区：顶部让出信息栏的高度。
   --ac-topbar-h 由 rootStyle 按「是否显示顶栏」给值（显示=58px / 不显示=0px），
   这样顶栏区域始终显示主题底色 + 标题条渐变，不会被背景图盖住。 */
.ac-bg-clip,
.ac-veil {
  position: absolute;
  top: var(--ac-topbar-h, 0px);
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
}

/* 裁剪容器：让 .ac-bg 放大后多出来的部分被裁掉，而不是溢到顶栏上 */
.ac-bg-clip {
  overflow: hidden;
}

.ac-bg {
  position: absolute;
  inset: 0;
  filter: blur(var(--ac-blur));
  transform: scale(1.04); // 模糊后边缘会露白，稍微放大盖住（溢出部分由 .ac-bg-clip 裁掉）
}

.ac-veil {
  background: rgba(0, 0, 0, var(--ac-veil));
}

// 浅色主题上黑色遮罩会把背景压成灰的，换成白色遮罩
.bailian-chat-in-yitu.is-light .ac-veil {
  background: rgba(255, 255, 255, var(--ac-veil));
}

.ac-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ---------------------------- 侧栏 ---------------------------- */
.ac-sidebar {
  width: var(--ac-sidebar-w);
  flex: 0 0 var(--ac-sidebar-w);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--ac-panel);
  border-right: 1px solid var(--ac-border);
  backdrop-filter: blur(8px);
}

.ac-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 58px;
  flex: 0 0 58px;
  padding: 0 12px;
  background-image: var(--ac-header-grad);
  border-bottom: 1px solid var(--ac-border);
}

.ac-brand-logo {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border-radius: 8px;
  background: var(--ac-accent-soft);
  border: 1px solid var(--ac-accent-border);
}

.ac-brand-text {
  flex: 1;
  min-width: 0;
}

.ac-brand-title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ac-brand-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--ac-text-dim);
}

.ac-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ac-text-faint);

  &[data-state='ok'] {
    background: var(--ac-ok);
    box-shadow: 0 0 6px var(--ac-ok);
  }

  &[data-state='running'] {
    background: var(--ac-accent);
    box-shadow: 0 0 6px var(--ac-accent);
    animation: ac-blink 1.1s infinite;
  }

  &[data-state='warn'] {
    background: var(--ac-warn);
  }
}

.ac-icon-btn {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ac-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.16);
  color: var(--ac-text-dim);
  cursor: pointer;
  padding: 0;

  &:hover {
    color: var(--ac-text);
    border-color: var(--ac-border-strong);
  }
}

.ac-chevron {
  width: 7px;
  height: 7px;
  border-left: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);

  &.left {
    transform: rotate(45deg);
  }
}

.ac-burger {
  display: flex;
  flex-direction: column;
  gap: 3px;

  i {
    display: block;
    width: 12px;
    height: 1.5px;
    background: currentColor;
  }
}

.ac-sections {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 0 8px;
}

.ac-sec {
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* 分区再矮也不能把标题挤没了：head 是 34px 定高，溢出时宁可裁列表 */
  overflow: hidden;

  /* 侧栏三区高度锁死为 2 : 4 : 4（合计 10 份）。
     ★ flex-basis 必须写 0 —— 份额与内容多少无关，条目再多也只吃自己那一份，
       多出来的在区内滚动；写成 auto 的话大模型一多就会把智能体、历史顶没了。
     ★ 用 flex-grow 比例而不是写死百分比：任一区被面板开关关掉时，
       剩下的区会按同样比例重新分掉全部空间，不用写第二套规则。 */
  &.models {
    flex: 2 1 0;
  }

  &.agents {
    flex: 4 1 0;
  }

  &.history {
    flex: 4 1 0;
    border-top: 1px solid var(--ac-border);
    margin-top: 6px;
    padding-top: 6px;
  }
}

.ac-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  flex: 0 0 34px;
  padding: 0 12px 0 9px;
}

.ac-sec-title {
  font-size: 12px;
  color: var(--ac-text-dim);
  border-left: 2px solid var(--ac-accent);
  padding-left: 8px;
  background: linear-gradient(90deg, var(--ac-accent-soft), transparent 70%);
  line-height: 1.4;
}

.ac-sec-count {
  font-style: normal;
  font-size: 11px;
  color: var(--ac-text-faint);
}

.ac-mini-btn {
  border: 1px solid var(--ac-border);
  background: transparent;
  color: var(--ac-text-dim);
  font-size: 11px;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    color: var(--ac-text);
    border-color: var(--ac-accent-border);
    background: var(--ac-accent-soft);
  }
}

.ac-list {
  padding: 0 8px;
  /* 吃掉分区除标题外的全部高度：分区高度是定死的，列表必须能跟着缩才能滚起来 */
  flex: 1 1 auto;
  min-height: 0;

  &.scroll {
    overflow-y: auto;
    min-height: 0;
  }

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--ac-border-strong);
    border-radius: 3px;
  }
}

.ac-empty {
  font-size: 11px;
  color: var(--ac-text-faint);
  padding: 6px 4px;
}

/* 大模型 / 智能体条目 */
.ac-pick-item,
.ac-conv-item {
  display: flex;
  align-items: center;
  gap: 9px;
  /* 删除确认条要占第二行整宽，所以行本身允许换行 */
  flex-wrap: wrap;
  padding: 8px 9px;
  border-radius: calc(var(--ac-radius) - 4px);
  border: 1px solid transparent;
  cursor: pointer;
  margin-bottom: 3px;
  transition: background 0.16s, border-color 0.16s;

  &:hover {
    background: var(--ac-panel-2);
  }

  &.active {
    background: color-mix(in srgb, var(--a) 14%, transparent);
    border-color: color-mix(in srgb, var(--a) 46%, transparent);
  }
}

.ac-ava {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--a) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--a) 42%, transparent);

  &.small {
    width: 26px;
    height: 26px;
    flex-basis: 26px;
    font-size: 13px;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.ac-pick-main,
.ac-conv-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ac-pick-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ac-text);
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ac-tag {
  flex: 0 0 auto;
  font-style: normal;
  font-size: 9px;
  line-height: 15px;
  padding: 0 5px;
  border-radius: 3px;
  color: var(--ac-tag-fg);
  background: var(--ac-tag-bg);
  border: 1px solid var(--ac-tag-bd);
}

.ac-pick-desc,
.ac-conv-meta {
  font-size: 10.5px;
  color: var(--ac-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ac-conv-title {
  font-size: 12px;
  color: var(--ac-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ac-conv-del {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--ac-text-faint);
  cursor: pointer;

  &:hover {
    color: var(--ac-danger);
  }
}

.ac-conv-item:hover .ac-conv-del,
/* 确认中即使鼠标移开也要留着图标（再点一次同一个图标 = 取消） */
.ac-conv-item.confirming .ac-conv-del {
  display: flex;
}

/* 删除确认条：占满整行（侧栏是 overflow-y:auto，浮层会被裁，所以做行内） */
.ac-del-confirm {
  flex: 0 0 100%;
  margin-top: 6px;
  padding: 6px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ac-danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--ac-danger) 40%, transparent);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
}

.ac-del-confirm-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.35;
  color: var(--ac-text);

  em {
    display: block;
    margin-top: 2px;
    font-style: normal;
    font-size: 10.5px;
    opacity: 0.62;
  }
}

.ac-del-confirm-btn {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--ac-border-strong);
  background: transparent;
  color: var(--ac-text-faint);
  cursor: pointer;

  &:hover {
    color: var(--ac-text);
    border-color: var(--ac-text-faint);
  }

  /* 与面板里删除大模型的确认键一致：确认用危险色 */
  &.danger {
    border-color: color-mix(in srgb, var(--ac-danger) 60%, transparent);
    background: color-mix(in srgb, var(--ac-danger) 18%, transparent);
    color: var(--ac-danger);

    &:hover {
      background: var(--ac-danger);
      color: #fff;
    }
  }
}

.ac-trash {
  width: 9px;
  height: 10px;
  border: 1.3px solid currentColor;
  border-top: none;
  border-radius: 0 0 2px 2px;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: -2.6px;
    left: -2px;
    width: 11px;
    height: 1.3px;
    background: currentColor;
  }
}

/* ---------------------------- 主区 ---------------------------- */
.ac-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ac-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 58px;
  flex: 0 0 58px;
  padding: 0 14px;
  /* 顶栏自带底色，不再依赖背景层 —— 背景被要求不作用于顶部信息栏 */
  background-color: var(--ac-panel);
  background-image: var(--ac-header-grad);
  border-bottom: 1px solid var(--ac-border);
}

.ac-top-ava {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--a, var(--ac-accent)) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--a, var(--ac-accent)) 42%, transparent);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.ac-top-text {
  flex: 1;
  min-width: 0;
}

.ac-top-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ac-top-sub {
  font-size: 11px;
  color: var(--ac-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ac-top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ac-conn {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 20px;
  border: 1px solid var(--ac-border);
  background: rgba(0, 0, 0, 0.16);
  color: var(--ac-text-dim);

  &[data-state='ok'] {
    color: var(--ac-ok);
    border-color: color-mix(in srgb, var(--ac-ok) 40%, transparent);
  }

  &[data-state='running'] {
    color: var(--ac-accent);
    border-color: var(--ac-accent-border);
  }

  &[data-state='warn'] {
    color: var(--ac-warn);
    border-color: color-mix(in srgb, var(--ac-warn) 42%, transparent);
  }
}

.ac-ghost-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
  border-radius: 6px;
  border: 1px solid var(--ac-border);
  background: rgba(0, 0, 0, 0.16);
  color: var(--ac-text-dim);
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--ac-text);
    border-color: var(--ac-border-strong);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.ac-stop-icon {
  width: 8px;
  height: 8px;
  border-radius: 1px;
  background: currentColor;
}

.ac-down-icon {
  width: 8px;
  height: 8px;
  border-right: 1.4px solid currentColor;
  border-bottom: 1.4px solid currentColor;
  transform: rotate(45deg) translate(-1px, -1px);
}

/* 消息区 */
.ac-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 18px 6px;

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--ac-border-strong);
    border-radius: 4px;
  }
}

.ac-welcome {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 20px 24px;
}

.ac-welcome-ava {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 14px;
  background: color-mix(in srgb, var(--a, var(--ac-accent)) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--a, var(--ac-accent)) 44%, transparent);
  box-shadow: var(--ac-glow);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.ac-welcome-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 8px;
}

.ac-welcome-text {
  /* 与消息气泡同一个字号变量：都属于「对话区的正文」 */
  font-size: var(--ac-fs-chat, 12.5px);
  color: var(--ac-text-dim);
  margin: 0 0 18px;
  max-width: 520px;
}

.ac-sugs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.ac-sug {
  font-size: 12px;
  padding: 6px 13px;
  border-radius: 20px;
  border: 1px solid var(--ac-border);
  background: var(--ac-panel-2);
  color: var(--ac-text-dim);
  cursor: pointer;
  transition: all 0.16s;

  &:hover {
    color: var(--ac-text);
    border-color: var(--ac-accent-border);
    background: var(--ac-accent-soft);
  }
}

/* 消息条目 */
.ac-msg {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;

  &.user {
    flex-direction: row-reverse;

    .ac-msg-body {
      align-items: flex-end;
    }

    .ac-bubble {
      background: var(--ac-bubble-user);
      color: #fff;
      border-radius: var(--ac-radius) var(--ac-radius) 4px var(--ac-radius);
    }

    .ac-msg-foot {
      justify-content: flex-end;
    }
  }
}

.ac-msg-ava {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--a, var(--ac-accent)) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--a, var(--ac-accent)) 42%, transparent);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.ac-msg-body {
  display: flex;
  flex-direction: column;
  max-width: 78%;
  min-width: 0;
}

.ac-bubble {
  padding: 9px 13px;
  /* 对话区字号（面板：对话内容区 → 字体大小） */
  font-size: var(--ac-fs-chat, 12.5px);
  line-height: 1.62;
  word-break: break-word;
  background: var(--ac-bubble-ai);
  border: 1px solid var(--ac-border);
  border-radius: var(--ac-radius) var(--ac-radius) var(--ac-radius) 4px;

  &.error {
    border-color: color-mix(in srgb, var(--ac-danger) 46%, transparent);
  }

  :deep(.ac-img) {
    max-width: 100%;
    border-radius: 6px;
    display: block;
    margin: 6px 0;
  }

  :deep(code) {
    font-family: Consolas, Monaco, monospace;
    font-size: 11.5px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.22);
  }
}

/* Markdown 正文（.ac-md 里是 markdown.ts 渲染出来的 HTML）
   以前只处理了图片与行内代码，标题/列表/代码块/引用/表格全走浏览器默认样式 ——
   模型答的是标准 Markdown，看着却像"没渲染"。这里把块级样式补齐，
   同时把间距压紧，避免一条回答被默认 margin 撑得很松散。 */
.ac-md {
  display: block;
  word-break: break-word;

  :deep(> *:first-child) {
    margin-top: 0;
  }

  :deep(> *:last-child) {
    margin-bottom: 0;
  }

  :deep(p) {
    margin: 0 0 6px;
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 9px 0 5px;
    font-weight: 700;
    line-height: 1.35;
    color: var(--ac-text);
  }

  :deep(h1) {
    font-size: 1.32em;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--ac-border);
  }

  :deep(h2) {
    font-size: 1.18em;
  }

  :deep(h3) {
    font-size: 1.06em;
  }

  :deep(h4),
  :deep(h5),
  :deep(h6) {
    font-size: 1em;
    color: var(--ac-text-dim);
  }

  :deep(ul),
  :deep(ol) {
    margin: 4px 0 6px;
    padding-left: 1.6em;
  }

  :deep(ul) {
    list-style: disc;
  }

  :deep(ol) {
    list-style: decimal;
  }

  :deep(li) {
    margin: 2px 0;
  }

  :deep(li > ul),
  :deep(li > ol) {
    margin: 2px 0 0;
  }

  :deep(blockquote) {
    margin: 6px 0;
    padding: 4px 10px;
    border-left: 3px solid var(--ac-accent-border);
    border-radius: 0 4px 4px 0;
    background: var(--ac-accent-soft);
    color: var(--ac-text-dim);
  }

  :deep(hr) {
    margin: 10px 0;
    border: 0;
    border-top: 1px solid var(--ac-border);
  }

  :deep(a) {
    color: var(--ac-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  :deep(strong) {
    font-weight: 700;
    color: var(--ac-text);
  }

  :deep(del) {
    opacity: 0.62;
  }

  /* 代码块：整块底色 + 独立滚动，别让长行把气泡撑破 */
  :deep(pre.ac-pre) {
    margin: 6px 0;
    padding: 8px 10px;
    border: 1px solid var(--ac-border);
    border-radius: 6px;
    background: rgba(127, 127, 127, 0.16);
    overflow: auto;
    max-height: 260px;
    font-family: Consolas, Monaco, monospace;
    font-size: 11.5px;
    line-height: 1.55;

    code {
      padding: 0;
      background: none;
      font-size: inherit;
      white-space: pre;
    }
  }

  /* 表格：包一层滚动容器，窄气泡里也能左右拖 */
  :deep(.ac-table-wrap) {
    margin: 6px 0;
    max-width: 100%;
    overflow: auto;
  }

  :deep(table) {
    border-collapse: collapse;
    font-size: 0.96em;
  }

  :deep(th),
  :deep(td) {
    padding: 3px 9px;
    border: 1px solid var(--ac-border);
    text-align: left;
    white-space: nowrap;
  }

  :deep(th) {
    font-weight: 600;
    background: var(--ac-panel2);
  }
}

.ac-msg-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 18px;
  font-size: 10.5px;
  color: var(--ac-text-faint);
  margin-top: 4px;
  padding: 0 2px;
}

.ac-time {
  line-height: 1;
}

/* 消息操作图标（复制 / 点赞 / 点踩 / 重答）
   平时完全隐藏 —— opacity 与 pointer-events 一起关，避免出现"看不见但能点"的幽灵按钮；
   鼠标移到这条消息上才浮现。 */
.ac-acts {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.16s;
}

.ac-msg:hover .ac-acts,
.ac-acts:focus-within {
  opacity: 1;
}

.ac-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--ac-text-faint);
  cursor: pointer;
  transition: color 0.14s, background 0.14s;

  &:hover {
    color: var(--ac-text);
    background: var(--ac-accent-soft);
  }

  &.active {
    color: var(--ac-accent);
    background: var(--ac-accent-soft);
  }

  /* 点踩 = 点赞图标翻转 180°，省一份 path */
  &.flip .ac-ico {
    transform: rotate(180deg);
  }

  /* 导出进行中：三个导出按钮一起禁用，避免同一秒内重复触发下载 */
  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
}

/* 底部临时提示：只在"静默失败"时出现（下载被 iframe 拦截、复制不可用），
   2.6 秒自动消失。pointer-events:none 保证它不挡住底下的输入区。 */
.ac-toast {
  position: absolute;
  left: 50%;
  bottom: 88px;
  transform: translateX(-50%);
  z-index: 30;
  max-width: min(88%, 460px);
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.55;
  text-align: center;
  color: var(--ac-text);
  background: var(--ac-panel-solid);
  border: 1px solid var(--ac-border-strong);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  pointer-events: none;
  animation: ac-toast-in 0.18s ease-out;
}

@keyframes ac-toast-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

/* 统一线性图标：无填充、描边跟随文字颜色 */
.ac-ico {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 气泡内展示的附件清单 */
.ac-bubble-atts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed color-mix(in srgb, currentColor 26%, transparent);
}

.ac-bubble-att {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);

  img {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    border-radius: 3px;
    object-fit: cover;
  }

  em {
    font-style: normal;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.ac-thought {
  font-size: 11.5px;
  color: var(--ac-text-faint);
  margin-bottom: 6px;
  border-left: 2px solid var(--ac-border-strong);
  padding-left: 8px;

  summary {
    cursor: pointer;
    list-style: none;
    user-select: none;

    &::-webkit-details-marker {
      display: none;
    }

    &::before {
      content: '▸ ';
    }
  }

  &[open] summary::before {
    content: '▾ ';
  }
}

.ac-thought-text {
  margin-top: 4px;
  white-space: pre-wrap;
  max-height: 180px;
  overflow: auto;

  /* 滚动条与消息区/侧栏统一：细条 + 主题色 thumb，
     否则这里是整块组件里唯一一个浏览器默认白滚动条，非常扎眼 */
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--ac-border-strong);
    border-radius: 3px;
  }
}

.ac-typing {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 16px;

  i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ac-text-faint);
    animation: ac-typing 1.4s infinite ease-in-out;

    &:nth-child(2) {
      animation-delay: 0.2s;
    }

    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}

/* 参数徽章 */
.ac-params {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 18px 0;
}

.ac-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 3px 7px 3px 8px;
  border-radius: 20px;
  border: 1px solid var(--ac-border);
  background: var(--ac-panel-2);
  color: var(--ac-text-dim);

  b {
    cursor: pointer;
    color: var(--ac-text-faint);
    font-weight: 400;
    padding: 0 2px;

    &:hover {
      color: var(--ac-danger);
    }
  }
}

.ac-link-icon {
  width: 8px;
  height: 8px;
  border: 1.3px solid currentColor;
  border-radius: 50%;
  opacity: 0.75;
}

/* 输入区 */
.ac-composer {
  flex: 0 0 auto;
  padding: 8px 18px 0;
}

/* 已选待发附件清单（在输入框上方） */
.ac-atts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.ac-att-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 200px;
  padding: 3px 7px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--ac-text-dim);
  background: var(--ac-panel-2);
  border: 1px solid var(--ac-border);

  img {
    width: 15px;
    height: 15px;
    flex: 0 0 15px;
    border-radius: 3px;
    object-fit: cover;
  }

  em {
    font-style: normal;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  b {
    font-weight: 400;
    padding: 0 1px;
    color: var(--ac-text-faint);
    cursor: pointer;

    &:hover {
      color: var(--ac-danger);
    }
  }
}

.ac-composer-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 6px 6px 12px;
  border-radius: var(--ac-radius);
  border: 1px solid var(--ac-border);
  background: var(--ac-panel-solid);
  box-shadow: var(--ac-shadow);
  transition: border-color 0.16s, box-shadow 0.16s;

  &:focus-within {
    border-color: var(--ac-accent-border);
    box-shadow: var(--ac-shadow), var(--ac-glow);
  }
}

/* 真正干活的 file input，藏在按钮后面 */
.ac-file {
  display: none;
}

/* 附件入口：默认不显示，输入框获得焦点（或已有附件）时才浮现 */
.ac-attach-btn {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  align-self: flex-end;
  margin-bottom: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ac-text-faint);
  cursor: pointer;
  opacity: 0;
  /* 和 opacity 一起关：否则会出现"看不见但能点到"的幽灵按钮 */
  pointer-events: none;
  transition: opacity 0.16s, color 0.14s, background 0.14s;

  &:hover {
    color: var(--ac-text);
    background: var(--ac-accent-soft);
  }
}

.ac-composer-box:focus-within .ac-attach-btn,
.ac-composer-box.has-attach .ac-attach-btn {
  opacity: 1;
  pointer-events: auto;
}

.ac-textarea {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--ac-text);
  font-family: inherit;
  /* 原来是 font-size: inherit —— 靠"根元素设了 font-size"间接生效，改成显式变量 */
  font-size: var(--ac-fs-input, 13px);
  line-height: 1.7;
  padding: 5px 0;
  max-height: 96px;

  &::placeholder {
    color: var(--ac-text-faint);
  }

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--ac-border-strong);
    border-radius: 3px;
  }
}

.ac-send {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: var(--ac-accent-grad);
  color: #fff;
  transition: opacity 0.16s, transform 0.16s;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* 生成中：同一颗按钮变成停止键，换成危险色区分（顶部信息栏的停止按钮已删除） */
  &.stopping {
    background: var(--ac-danger);
  }
}

.ac-send-icon {
  width: 0;
  height: 0;
  border-left: 7px solid currentColor;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  margin-left: 3px;
}

.ac-foot {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 18px 9px;
  font-size: 10.5px;
  color: var(--ac-text-faint);
}

/* ---------------------------- 动画 ---------------------------- */
@keyframes ac-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@keyframes ac-typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.55;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>
