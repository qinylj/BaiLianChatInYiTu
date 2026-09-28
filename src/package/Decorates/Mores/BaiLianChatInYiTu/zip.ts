/*
 * @Description: 零依赖 ZIP 写入器（浏览器 / Node 通用）
 *
 * 为什么手写：.docx 与 .xlsx 本质都是 zip 包，而运行组件要保持**零第三方依赖**
 * （jszip / fflate / docx / exceljs 随便一个进来就是几十到几百 KB，
 *   而大屏组件是要跟着页面加载的，不能为"导出"这一个功能背这么多体积）。
 *
 * 为什么只用 stored（method 0，不压缩）：
 *   压缩要调 CompressionStream('deflate-raw')，那是**异步** API，会把整条导出链路
 *   变成 async（还要处理 Safari 老版本不支持的回退）；而 stored 只多算一个 CRC32，
 *   纯同步、任何浏览器都能跑，调用方不用 await。
 *   代价只有体积 —— 公文导出这个量级（几十~几百 KB）对下载速度无影响，
 *   且 zip 头里的压缩后大小与原始大小可以填同一个值，结构反而更简单不易写错。
 *
 * 规范里只有三处偏移量必须对得上（写错的表现是解压软件报"文件已损坏"）：
 *   本地头 offset / 中央目录 offset / EOCD 里中央目录长度与偏移。
 *   所以这里全程用一个游标累加，不靠事后回填。
 */

/** CRC32 查表（多项式 0xedb88320，与 zlib 一致） */
const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** UTF-8 编码：TextEncoder 是浏览器与 Node 的公共 API，不需要 polyfill */
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/** 小端字节累加器：zip 的所有多字节字段都是小端 */
class ByteBuf {
  private chunks: Uint8Array[] = []
  private size = 0
  private push(b: Uint8Array) {
    this.chunks.push(b)
    this.size += b.length
  }
  u16(v: number) {
    const b = new Uint8Array(2)
    b[0] = v & 0xff
    b[1] = (v >>> 8) & 0xff
    this.push(b)
  }
  u32(v: number) {
    const b = new Uint8Array(4)
    b[0] = v & 0xff
    b[1] = (v >>> 8) & 0xff
    b[2] = (v >>> 16) & 0xff
    b[3] = (v >>> 24) & 0xff
    this.push(b)
  }
  raw(b: Uint8Array) {
    this.push(b)
  }
  get offset() {
    return this.size
  }
  toBytes(): Uint8Array {
    const out = new Uint8Array(this.size)
    let at = 0
    for (let i = 0; i < this.chunks.length; i++) {
      out.set(this.chunks[i], at)
      at += this.chunks[i].length
    }
    return out
  }
}

export interface ZipEntry {
  /** 包内路径，用 `/` 分隔，不要以 `/` 开头（如 `word/document.xml`） */
  name: string
  /** 文件内容，字符串按 UTF-8 编码 */
  data: string | Uint8Array
}

/**
 * 组装 zip。
 * @param entries 包内文件，顺序会被保留（docx/xlsx 对顺序不敏感，但 [Content_Types].xml 放第一更符合习惯）
 * @param when    zip 内记录的时间戳；不传则用当前时间
 */
export function buildZip(entries: ZipEntry[], when?: Date): Uint8Array {
  const d = when || new Date()
  // DOS 时间戳的年从 1980 起算，早于 1980 会写出负数——直接用 1980-01-01 兜底
  const year = Math.max(1980, d.getFullYear())
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()

  const body = new ByteBuf()
  const central = new ByteBuf()

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const nameBuf = utf8(e.name)
    const data = typeof e.data === 'string' ? utf8(e.data) : e.data
    const crc = crc32(data)
    const localOffset = body.offset

    /* ---- 本地文件头（30 字节定长 + 文件名 + 数据）---- */
    body.u32(0x04034b50) // 签名 PK\x03\x04
    body.u16(20) // 解压所需版本 2.0
    body.u16(0x0800) // 通用标志位 11：文件名是 UTF-8
    body.u16(0) // 压缩方法 0 = stored
    body.u16(dosTime)
    body.u16(dosDate)
    body.u32(crc)
    body.u32(data.length) // 压缩后大小 == 原始大小（stored）
    body.u32(data.length)
    body.u16(nameBuf.length)
    body.u16(0) // 无扩展字段
    body.raw(nameBuf)
    body.raw(data)

    /* ---- 中央目录项（46 字节定长 + 文件名）---- */
    central.u32(0x02014b50) // 签名 PK\x01\x02
    central.u16(20) // 产生该文件的程序版本
    central.u16(20) // 解压所需版本
    central.u16(0x0800)
    central.u16(0)
    central.u16(dosTime)
    central.u16(dosDate)
    central.u32(crc)
    central.u32(data.length)
    central.u32(data.length)
    central.u16(nameBuf.length)
    central.u16(0) // 扩展字段长度
    central.u16(0) // 注释长度
    central.u16(0) // 起始磁盘号
    central.u16(0) // 内部属性
    central.u32(0) // 外部属性（0 = 普通文件）
    central.u32(localOffset)
    central.raw(nameBuf)
  }

  const bodyBytes = body.toBytes()
  const centralBytes = central.toBytes()

  const end = new ByteBuf()
  end.u32(0x06054b50) // 签名 PK\x05\x06
  end.u16(0) // 当前磁盘号
  end.u16(0) // 中央目录起始磁盘号
  end.u16(entries.length)
  end.u16(entries.length)
  end.u32(centralBytes.length)
  end.u32(bodyBytes.length) // 中央目录相对包首的偏移 = 所有本地项总长
  end.u16(0) // 无注释
  const endBytes = end.toBytes()

  const total = new Uint8Array(bodyBytes.length + centralBytes.length + endBytes.length)
  total.set(bodyBytes, 0)
  total.set(centralBytes, bodyBytes.length)
  total.set(endBytes, bodyBytes.length + centralBytes.length)
  return total
}

export default buildZip
