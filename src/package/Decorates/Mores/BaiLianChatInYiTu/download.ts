/*
 * @Description: 触发浏览器下载
 *
 * 为什么不用 showSaveFilePicker（文件系统访问 API）：它要求安全上下文，
 * 而大屏跑在 http://内网IP 上，那里 navigator.clipboard 都是 undefined，更别说它。
 * Blob + <a download> 没有这个限制，是唯一在 http/iframe 里都稳的路子。
 *
 * ★ iframe 里有个已知限制：父页面没给 allow-downloads 时，点下载不会报错也**不会有任何反应**。
 *   大屏预览页常见这种情况，所以这里的返回值告诉调用方"到底点出去了没有"，
 *   由界面去提示用户改用"新窗口打开大屏"或复制内容，而不是静默失败。
 */

/** 统一把字节复制到独立 ArrayBuffer：Blob 不接受带偏移的视图，直接传 buffer 会串数据 */
const toBlob = (data: string | Uint8Array, mime: string): Blob => {
  if (typeof data === 'string') return new Blob([data], { type: mime })
  const buf = new ArrayBuffer(data.byteLength)
  new Uint8Array(buf).set(data)
  return new Blob([buf], { type: mime })
}

/**
 * 存盘。返回是否成功点出下载。
 * 注意：返回 true 只代表"请求已发出"，浏览器是否真的落盘由下载设置决定
 * （有些环境会静默存到默认目录）。
 */
export function saveFile(fileName: string, data: string | Uint8Array, mime: string): boolean {
  let url = ''
  try {
    url = URL.createObjectURL(toBlob(data, mime))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.rel = 'noopener'
    a.style.position = 'fixed'
    a.style.left = '-10000px'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    return true
  } catch (e) {
    return false
  } finally {
    // 立刻 revoke 会让部分浏览器来不及取内容，放到下一轮事件循环
    if (url) {
      const u = url
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(u)
        } catch (e) {
          /* 已经释放过就忽略 */
        }
      }, 4000)
    }
  }
}

export default saveFile
