#!/usr/bin/env node
/*
 * 交付包打包：把 dist 里的产物压成可直接上传平台的 zip
 *
 *   node tools/pack.cjs                 输出到工程上级目录
 *   node tools/pack.cjs -o D:/temp      指定输出目录
 *
 * 包名 = <组件>_<版本>_<日期>.zip，例如 BaiLianChatInYiTu_1.0.1_2026-09-28.zip
 * （同一天同版本再打一次会带上时分秒，不再需要手工加 a/b/c 后缀）
 *
 * 自带的 zip 写入是零依赖实现（zlib deflateRaw + 手写文件头），
 * 因为 Git Bash 里没有 zip 命令，而 Compress-Archive 生成的条目名在非 Windows 环境可能解不开。
 * 只放平台需要的两个文件：<组件>@<版本>.js 和 <组件>@<版本>.css。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const zlib = require('zlib')

process.chdir(path.resolve(__dirname, '..'))
const { readVersion, buildStamp } = require('../build/version.js')

/* ---------------- 最小 ZIP 写入器 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

function zipBuffer(entries, now) {
  const { time, date } = dosTime(now || new Date())
  const locals = []
  const centrals = []
  let offset = 0

  entries.forEach(e => {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const raw = fs.readFileSync(e.file)
    const deflated = zlib.deflateRawSync(raw, { level: 9 })
    const useDeflate = deflated.length < raw.length
    const data = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, nameBuf]))

    offset += local.length + nameBuf.length + data.length
  })

  const localBuf = Buffer.concat(locals)
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(localBuf.length, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([localBuf, centralBuf, end])
}

/* ---------------- 主流程 ---------------- */

const argv = process.argv.slice(2)
const outIdx = argv.findIndex(a => a === '-o' || a === '--out')
const outDir = outIdx >= 0 && argv[outIdx + 1] ? path.resolve(argv[outIdx + 1]) : path.resolve('..')

const compName = process.env.COMP_NAME || 'BaiLianChatInYiTu'
const stamp = buildStamp()
let version
try {
  version = readVersion(compName)
} catch (e) {
  console.error(`读取版本号失败：${e.message}`)
  process.exit(1)
}

const distDir = path.resolve('dist')
const wanted = [`${compName}@${version}.js`, `${compName}@${version}.css`]
const missing = wanted.filter(f => !fs.existsSync(path.join(distDir, f)))

if (missing.length) {
  const have = fs.existsSync(distDir) ? fs.readdirSync(distDir).join(', ') || '（空）' : '（dist 不存在）'
  console.error(`\ndist 里缺少：${missing.join(', ')}`)
  console.error(`dist 现有：${have}`)
  console.error(`\ndist 的产物名带着版本号，和源码版本号必须一致。`)
  console.error(`请先编译：npm run build   （要同时自增版本号则用 npm run build:bump）\n`)
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
const base = `${compName}_${version}_${stamp.date}`
let zipPath = path.join(outDir, `${base}.zip`)
// 同一天同一个版本再打一次：带上时分秒，而不是手工加 a/b/c
if (fs.existsSync(zipPath)) zipPath = path.join(outDir, `${compName}_${version}_${stamp.compact}.zip`)

const entries = wanted.map(name => ({ name, file: path.join(distDir, name) }))
fs.writeFileSync(zipPath, zipBuffer(entries))

const sha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex')
const kb = n => `${(n / 1024).toFixed(1)} KB`

console.log(`\n交付包已生成：${zipPath}`)
entries.forEach(e => console.log(`  ${e.name}  ${kb(fs.statSync(e.file).size)}`))
console.log(`  合计 ${kb(fs.statSync(zipPath).size)}   sha256 ${sha}`)
console.log(
  `\n部署：两个文件放到平台组件目录 component/${compName}/${version}/` +
    `\n      组件版本号 ${version}（构建戳 ${stamp.text}）—— 大屏上可用根节点 data-build 属性核对\n`
)
