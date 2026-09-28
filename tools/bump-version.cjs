#!/usr/bin/env node
/*
 * 版本号命令行工具
 *
 *   node tools/bump-version.cjs                 查看当前版本号
 *   node tools/bump-version.cjs patch           1.0.0 → 1.0.1（写回 index.vue）
 *   node tools/bump-version.cjs minor           1.0.1 → 1.1.0
 *   node tools/bump-version.cjs major           1.1.0 → 2.0.0
 *   node tools/bump-version.cjs --set 1.2.3     直接指定（回滚版本号时用）
 *   ...加 --dry 只看结果不落盘
 *
 * 编译时自增请走 BUMP=patch npm run build（或 npm run build:bump），
 * 两者共用 build/version.js，规则完全一致。
 */
'use strict'

const path = require('path')
// webpack 配置里的路径都是相对工程根的，这里统一切到工程根，保证从任何目录调用都一致
process.chdir(path.resolve(__dirname, '..'))

const { readVersion, writeVersion, nextVersion, resolveVersion, indexVueFile } = require('../build/version.js')

const argv = process.argv.slice(2)
const dry = argv.includes('--dry') || argv.includes('-n')
const args = argv.filter(a => a !== '--dry' && a !== '-n')
const compName = process.env.COMP_NAME || 'BaiLianChatInYiTu'

const setIdx = args.findIndex(a => a === '--set' || a === '-s')
const setTo = setIdx >= 0 ? args[setIdx + 1] : null
const level = args.find(a => !a.startsWith('-') && a !== setTo)

try {
  const current = readVersion(compName)
  console.log(`组件 ${compName}`)
  console.log(`源文件 ${indexVueFile(compName)}`)
  console.log(`当前版本 ${current}`)

  let target = null
  if (setTo) {
    target = setTo
  } else if (level) {
    target = nextVersion(current, level)
  }

  if (!target) {
    const stamp = resolveVersion(compName).stamp
    console.log(`构建戳（如果现在编译）${stamp.text}`)
    console.log('\n未指定级别，仅查看。加 patch / minor / major 或 --set x.y.z 才会改动。')
    process.exit(0)
  }

  if (dry) {
    console.log(`\n[dry] 将改为 ${target}（未写盘）`)
    process.exit(0)
  }

  const res = writeVersion(compName, target)
  if (res.changed) {
    console.log(`\n已更新 ${res.from} → ${res.to}`)
    console.log('记得重新编译：npm run build')
  } else {
    console.log(`\n版本号已是 ${res.to}，无需改动`)
  }
} catch (e) {
  console.error(`\n出错：${e.message}`)
  process.exit(1)
}
