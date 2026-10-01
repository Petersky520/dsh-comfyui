/**
 * ComfyUI HTTP API 薄封装（Node 22+ 全局 fetch）。
 * 只依赖 baseUrl，默认 http://127.0.0.1:8188。
 */

export class ComfyError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ComfyError'
    this.status = status
    this.body = body
  }
}

export class ComfyApi {
  /**
   * @param {{ baseUrl: string, outputDir: string }} opts
   */
  constructor(opts) {
    this.baseUrl = String(opts.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '')
    this.outputDir = opts.outputDir
  }

  /**
   * @param {'GET'|'POST'} method
   * @param {string} path 以 / 开头
   */
  async request(method, path, { body, form, signal, raw } = {}) {
    const url = this.baseUrl + path
    let res
    try {
      res = await fetch(url, {
        method,
        signal,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        headers: form ? undefined : (body !== undefined ? { 'content-type': 'application/json' } : undefined),
      })
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      throw new ComfyError(
        `连不上 ComfyUI（${this.baseUrl}）。请先启动 ComfyUI，例如运行 D:\\AI\\ComfyUI-aki-v3\\绘世启动器.exe。底层错误：${e.message}`
      )
    }
    if (raw) {
      if (!res.ok) throw new ComfyError(`ComfyUI 返回 ${res.status}（${method} ${path}）`, res.status)
      return res
    }
    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!res.ok) throw new ComfyError(`ComfyUI 返回 ${res.status}（${method} ${path}）`, res.status, data)
    return data
  }

  get(path, opts) { return this.request('GET', path, opts) }
  post(path, body, opts) { return this.request('POST', path, { ...opts, body }) }

  /** /system_stats + /queue 汇总 */
  async status(signal) {
    const [system, queue] = await Promise.all([
      this.get('/system_stats', { signal }),
      this.get('/queue', { signal }),
    ])
    return {
      ok: true,
      endpoint: this.baseUrl,
      comfyui_version: system?.system?.comfyui_version,
      python_version: system?.system?.python_version,
      devices: system?.devices,
      queue_running: queue?.queue_running?.length ?? 0,
      queue_pending: queue?.queue_pending?.length ?? 0,
    }
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); resolve() }, ms)
    const onAbort = () => { cleanup(); reject(Object.assign(new Error('已取消'), { name: 'AbortError' })) }
    const cleanup = () => { clearTimeout(t); signal?.removeEventListener?.('abort', onAbort) }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}
