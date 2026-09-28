/*
 * @Description: 组件版本号工具 —— 唯一数据源 / 自增 / 构建戳
 *
 * 版本号在工程里只允许写在一个地方：组件 index.vue 末尾那个**独立的**
 * `<script lang="ts">` 块里的 `version: '1.0.0'`。
 * 打包脚本（build/resolve-file.js）用正则从同一处提取，供三处消费：
 *   1) AMD 模块名    BaiLianChatInYiTu@1.0.0
 *   2) 产物文件名    BaiLianChatInYiTu@1.0.0.js / .css
 *   3) 资源基础路径  ../component/BaiLianChatInYiTu/1.0.0/
 * 所以本文件也只在那一处读写，避免"改了 A 忘了 B"。
 *
 * 环境变量：
 *   BUMP=patch|minor|major   编译前把版本号自增并**写回** index.vue（默认不改）
 *   BUMP_WRITE=0             只算出新版本号用于本次产物命名，不写回源文件（预演用）
 *
 * 注意：`<script setup lang="ts">` 不会被下面两个正则命中（setup 位置不匹配），
 * 所以规则加进 setup 块也不会污染版本解析。
 */
'use strict'

const fs = require('fs')
const { getComponents } = require('./resolve-file')

// `version: '1.0.0'`（也兼容双引号）
const VERSION_ENTRY_RE = /(version\s*:\s*["'])(\d+\.\d+\.\d+)(["'])/g
// 只匹配不带 setup 的纯 <script lang="ts"> 块，且必须独占一行开头
// （不锚行首的话，注释里出现同名标签字面量会把匹配带偏，见 resolve-file.js 同名注释）
const PLAIN_SCRIPT_RE = /^<script\s+lang="ts">([\s\S]*?)<\/script>/gm

const NO_BUMP_VALUES = ['', '0', 'none', 'off', 'false', 'no']

/* 组件名 → index.vue 绝对路径（复用工程的组件扫描逻辑，别写死路径） */
function indexVueFile(compName) {
  const hit = getComponents().find(it => it.name === compName)
  if (!hit) {
    throw new Error(`找不到组件【${compName}】，检查 src/package/**/${compName}/export.ts 是否存在`)
  }
  return hit.entry.replace(/export\.ts$/, 'index.vue')
}

/* 取最后一个纯 <script lang="ts"> 块：index.vue 里它就是版本声明块 */
function plainScriptBlock(src) {
  const blocks = [...src.matchAll(PLAIN_SCRIPT_RE)]
  if (!blocks.length) {
    throw new Error('index.vue 里找不到 `<script lang="ts">` 版本声明块')
  }
  const tail = blocks[blocks.length - 1]
  return { raw: tail[0], at: tail.index }
}

function versionHits(scope) {
  return [...scope.matchAll(VERSION_ENTRY_RE)].map(m => m[2])
}

/* 读当前版本号 */
function readVersion(compName) {
  const file = indexVueFile(compName)
  const src = fs.readFileSync(file, 'utf8')
  const { raw } = plainScriptBlock(src)
  const hits = versionHits(raw)
  if (hits.length !== 1) {
    throw new Error(
      `${file} 的 <script lang="ts"> 块里应有且仅有 1 处 version 声明，实际 ${hits.length} 处：${
        hits.join(', ') || '（0 处）'
      }`
    )
  }
  return hits[0]
}

/* 把版本号写回 index.vue，返回 { file, from, to, changed } */
function writeVersion(compName, next) {
  parseVersion(next) // 格式校验，非法直接抛
  const file = indexVueFile(compName)
  const src = fs.readFileSync(file, 'utf8')
  const { raw, at } = plainScriptBlock(src)
  const hits = versionHits(raw)
  if (hits.length !== 1) {
    throw new Error(`${file} 的 <script lang="ts"> 块里应有且仅有 1 处 version 声明，实际 ${hits.length} 处`)
  }
  const from = hits[0]
  if (from === next) {
    return { file, from, to: next, changed: false }
  }
  const patched = raw.replace(VERSION_ENTRY_RE, (_m, head, _v, tail) => `${head}${next}${tail}`)
  const out = src.slice(0, at) + patched + src.slice(at + raw.length)
  fs.writeFileSync(file, out, 'utf8')
  return { file, from, to: next, changed: true }
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v == null ? '' : v).trim())
  if (!m) {
    throw new Error(`版本号必须形如 x.y.z（纯数字），收到：${JSON.stringify(v)}`)
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/* 按级别算出下一个版本号 */
function nextVersion(current, level) {
  const { major, minor, patch } = parseVersion(current)
  const key = String(level == null ? '' : level).trim().toLowerCase()
  if (key === 'major') return `${major + 1}.0.0`
  if (key === 'minor') return `${major}.${minor + 1}.0`
  if (key === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`不支持的递增级别：${level}（可选 patch / minor / major）`)
}

/* 构建戳：产物里、日志里、zip 名里都用它区分"同一个版本号的第几次编译" */
function buildStamp(d) {
  const now = d || new Date()
  const p = (n, w) => String(n).padStart(w || 2, '0')
  const y = now.getFullYear()
  const md = `${p(now.getMonth() + 1)}${p(now.getDate())}`
  const date = `${y}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  return {
    date,
    time,
    text: `${date} ${time}`,
    compactDate: `${y}${md}`,
    compact: `${y}${md}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  }
}

/*
 * 打包入口统一调用：拿到本次编译要用的版本号（并可选地先把自增写回源文件）
 * 返回 { version, from, file, changed, stamp }
 */
function resolveVersion(compName) {
  const bump = String(process.env.BUMP == null ? '' : process.env.BUMP).trim().toLowerCase()
  const writeBack = !NO_BUMP_VALUES.includes(
    String(process.env.BUMP_WRITE == null ? '1' : process.env.BUMP_WRITE).trim().toLowerCase()
  )
  const current = readVersion(compName)
  const stamp = buildStamp()

  if (NO_BUMP_VALUES.includes(bump)) {
    return { version: current, from: null, file: indexVueFile(compName), changed: false, stamp }
  }

  const target = nextVersion(current, bump)
  const res = writeBack
    ? writeVersion(compName, target)
    : { file: indexVueFile(compName), from: current, to: target, changed: false }
  return { version: target, from: current, ...res, stamp }
}

module.exports = {
  readVersion,
  writeVersion,
  parseVersion,
  nextVersion,
  buildStamp,
  resolveVersion,
  indexVueFile
}
