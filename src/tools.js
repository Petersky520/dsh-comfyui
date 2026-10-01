/**
 * 工具定义：通过 ctx.tools.register 注册到 dsh。
 * 全部基于 defineTool（@deepseek-ai/dsh-tools），输出统一为 JSON + 文本渲染。
 */

import fs from 'node:fs'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ComfyError, sleep } from './comfy-api.js'

const JSON_OUT = { type: 'json' }

function renderJson(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/** ComfyUI 的模型目录（/models/<folder>） */
const MODEL_FOLDERS = [
  'checkpoints', 'diffusion_models', 'unet', 'loras', 'vae',
  'clip', 'clip_vision', 'controlnet', 'upscale_models', 'embeddings', 'style_models',
]

/** 从 history 条目里收集所有输出文件（图片/视频/音频） */
function collectOutputs(entry) {
  const files = []
  for (const [nodeId, out] of Object.entries(entry?.outputs ?? {})) {
    for (const key of ['images', 'gifs', 'videos', 'audio']) {
      for (const f of out?.[key] ?? []) {
        if (f?.filename) files.push({ nodeId, kind: key, filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' })
      }
    }
  }
  return files
}

export function buildTools(api) {
  const tools = []

  // 1. comfy_status —— 在线状态 / 显卡 / 队列
  tools.push(defineTool({
    name: 'comfy_status',
    description: '检查本机 ComfyUI 是否在线，返回版本、显卡显存和队列状态。做任何 ComfyUI 操作前先调它。',
    parameters: {},
    output: {
      schema: JSON_OUT,
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    execute: async (_args, exec) => api.status(exec.signal),
  }))

  // 2. comfy_list —— 列出模型文件
  tools.push(defineTool({
    name: 'comfy_list',
    description: '列出 ComfyUI 的模型文件。kind 可选 checkpoints/diffusion_models/unet/loras/vae/clip/clip_vision/controlnet/upscale_models/embeddings/style_models/all。提交工作流前用它核对模型文件名。',
    parameters: {
      kind: { type: 'string', enum: [...MODEL_FOLDERS, 'all'], required: true, description: '模型目录类别，或 all' },
    },
    output: {
      schema: JSON_OUT,
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      if (args.kind === 'all') {
        const out = {}
        for (const folder of MODEL_FOLDERS) {
          try { out[folder] = await api.get(`/models/${folder}`, { signal: exec.signal }) }
          catch { out[folder] = [] }
        }
        return { ok: true, models: out }
      }
      const list = await api.get(`/models/${args.kind}`, { signal: exec.signal })
      return { ok: true, kind: args.kind, models: list }
    },
  }))

  // 3. comfy_node_info —— 节点定义查询
  tools.push(defineTool({
    name: 'comfy_node_info',
    description: '查询 ComfyUI 节点定义。传 nodeClass 返回该节点的输入/输出/控件定义；不传则返回全部节点类名清单（用于确认某个节点是否存在）。',
    parameters: {
      nodeClass: { type: 'string', description: '节点类名，如 KSampler、CheckpointLoaderSimple；省略则只列出全部类名' },
    },
    output: {
      schema: JSON_OUT,
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      if (args.nodeClass) {
        const info = await api.get(`/object_info/${encodeURIComponent(args.nodeClass)}`, { signal: exec.signal })
        return { ok: true, nodeClass: args.nodeClass, info }
      }
      const all = await api.get('/object_info', { signal: exec.signal })
      return { ok: true, count: Object.keys(all ?? {}).length, classes: Object.keys(all ?? {}) }
    },
  }))

  // 4. comfy_submit —— 提交 API 格式工作流
  tools.push(defineTool({
    name: 'comfy_submit',
    description: '提交一个 **API 格式**（含 class_type 的对象，非界面导出的 UI 格式）的 ComfyUI 工作流。可用 workflow 直接传 JSON 对象，或用 workflowPath 指向本地 .json 文件。dry_run=true 时不真正提交，只做格式预检。注意：本工具不做 UI→API 转换；若只有界面导出的工作流，请改用 mcp__comfyui__comfy_convert / comfy_submit（MCP 桥接版）或先自行转换。',
    parameters: {
      workflow: { type: 'json', description: 'API 格式工作流对象（{ "3": {class_type, inputs}, ... }）' },
      workflowPath: { type: 'string', description: '本地 API 格式工作流 .json 文件路径（与 workflow 二选一）' },
      dry_run: { type: 'boolean', description: 'true 时只校验不提交，默认 false' },
    },
    output: {
      schema: JSON_OUT,
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      let workflow = args.workflow
      if (!workflow && args.workflowPath) {
        workflow = JSON.parse(fs.readFileSync(args.workflowPath, 'utf8'))
      }
      if (!workflow || typeof workflow !== 'object') {
        throw new ComfyError('必须提供 workflow（对象）或 workflowPath（文件路径）之一')
      }
      // 粗检：API 格式每个节点应有 class_type
      const bad = Object.entries(workflow).filter(([, n]) => !n || typeof n !== 'object' || !n.class_type)
      if (bad.length) {
        throw new ComfyError(`这些节点缺少 class_type，疑似 UI 格式而非 API 格式：${bad.map(([id]) => id).join(', ')}。请先用转换器处理。`)
      }
      if (args.dry_run) return { ok: true, dry_run: true, node_count: Object.keys(workflow).length }
      try {
        const res = await api.post('/prompt', { prompt: workflow }, { signal: exec.signal })
        return { ok: true, prompt_id: res.prompt_id, number: res.number }
      } catch (e) {
        if (e instanceof ComfyError && e.status === 400 && e.body?.node_errors) {
          return { ok: false, error: e.body.error, node_errors: e.body.node_errors }
        }
        throw e
      }
    },
  }))

  // 5. comfy_queue —— 队列操作
  tools.push(defineTool({
    name: 'comfy_queue',
    description: '查看或操作 ComfyUI 队列：status 查看（默认）、clear 清空待执行队列、interrupt 中断当前正在执行的任务。',
    parameters: {
      action: { type: 'string', enum: ['status', 'clear', 'interrupt'], description: '操作类型，默认 status' },
    },
    output: {
      schema: JSON_OUT,
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const action = args.action ?? 'status'
      if (action === 'status') {
        const q = await api.get('/queue', { signal: exec.signal })
        return { ok: true, running: q?.queue_running?.length ?? 0, pending: q?.queue_pending?.length ?? 0 }
      }
      if (action === 'clear') {
        await api.post('/queue', { clear: true }, { signal: exec.signal })
        return { ok: true, action: 'clear' }
      }
      await api.post('/interrupt', {}, { signal: exec.signal })
      return { ok: true, action: 'interrupt' }
    },
  }))

  // 6. comfy_history —— 查询执行结果
  tools.push(defineTool({
    name: 'comfy_history',
    description: '查询某个 prompt_id 的执行历史与输出文件清单（不下载文件；要下载请用 comfy_watch 或 comfy_fetch）。',
    parameters: {
      prompt_id: { type: 'string', required: true },
    },
    output: {
      schema: JSON_OUT,
      render: (_args, value) => renderJson(value),
    },
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const h = await api.get(`/history/${encodeURIComponent(args.prompt_id)}`, { signal: exec.signal })
      const entry = h?.[args.prompt_id]
      if (!entry) return { ok: false, message: '暂无该 prompt_id 的历史（可能仍在队列中或已过期）' }
      return { ok: true, status: entry.status, outputs: collectOutputs(entry) }
    },
  }))

  // 7. comfy_watch —— 等待完成并下载结果
  tools.push(defineTool({
    name: 'comfy_watch',
    description: '等待某个 prompt_id 执行完成，把输出文件下载到本地目录并返回落盘路径。图片类 timeout 给 300 秒左右，视频类建议 1800 秒以上。',
    parameters: {
      prompt_id: { type: 'string', required: true },
      timeout: { type: 'integer', description: '等待秒数，默认 600' },
      save_dir: { type: 'string', description: '下载目录，默认用插件配置的 outputDir' },
    },
    output: {
      schema: JSON_OUT,
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const timeoutSec = args.timeout ?? 600
      const deadline = Date.now() + timeoutSec * 1000
      let entry = null
      while (Date.now() < deadline) {
        const h = await api.get(`/history/${encodeURIComponent(args.prompt_id)}`, { signal: exec.signal })
        const e = h?.[args.prompt_id]
        if (e) {
          const st = e.status
          if (st?.completed) { entry = e; break }
          if (st?.status_str === 'error') {
            return { ok: false, message: '执行失败', status: st }
          }
        }
        await sleep(2000, exec.signal)
      }
      if (!entry) throw new ComfyError(`等待超时（${timeoutSec} 秒），任务可能仍在队列中`)
      const files = collectOutputs(entry)
      const saveDir = args.save_dir || api.outputDir
      fs.mkdirSync(saveDir, { recursive: true })
      const saved = []
      for (const f of files) {
        const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type })
        const res = await api.get(`/view?${qs}`, { signal: exec.signal, raw: true })
        const buf = Buffer.from(await res.arrayBuffer())
        const outPath = path.join(saveDir, `${args.prompt_id.slice(0, 8)}_${f.filename}`)
        fs.writeFileSync(outPath, buf)
        saved.push(outPath)
      }
      return { ok: true, saved_files: saved, count: saved.length }
    },
  }))

  // 8. comfy_upload —— 上传图片到 ComfyUI input 目录
  tools.push(defineTool({
    name: 'comfy_upload',
    description: '把本地图片上传到 ComfyUI 的 input 目录（图生图/视频的首帧等场景）。返回上传后的文件名，供 LoadImage 节点引用。',
    parameters: {
      image_path: { type: 'string', required: true, description: '本地图片绝对路径' },
      subfolder: { type: 'string', description: 'input 下的子目录，默认空' },
      overwrite: { type: 'boolean', description: '同名是否覆盖，默认 true' },
    },
    output: {
      schema: JSON_OUT,
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const buf = fs.readFileSync(args.image_path)
      const form = new FormData()
      form.append('image', new Blob([buf]), path.basename(args.image_path))
      if (args.subfolder) form.append('subfolder', args.subfolder)
      form.append('overwrite', String(args.overwrite ?? true))
      const res = await api.request('POST', '/upload/image', { form, signal: exec.signal })
      return { ok: true, name: res?.name, subfolder: res?.subfolder ?? '', type: res?.type ?? 'input' }
    },
  }))

  return tools
}
