/**
 * dsh-comfyui — 原生 ComfyUI 插件入口。
 *
 * 直连本机 ComfyUI HTTP API（默认 http://127.0.0.1:8188），把 8 个 comfy_* 工具
 * 注册进 ctx.tools，让 dsh 智能体无需 MCP 桥接即可驱动 ComfyUI 创作。
 *
 * 与 mcp-client 桥接版（mcp__comfyui__*）的关系：两者可并存——
 * 桥接版工具名带 mcp__comfyui__ 前缀且含 UI→API 工作流转换器；
 * 本插件是轻量原生实现，工具名为 comfy_*，不做格式转换。
 *
 * 配置（cordis.patch.yml 中该条目的 config）：
 *   baseUrl:   ComfyUI 地址，默认 http://127.0.0.1:8188
 *   outputDir: comfy_watch 的默认下载目录
 */

import { ComfyApi } from './src/comfy-api.js'
import { buildTools } from './src/tools.js'

export const name = 'dsh-comfyui'

export const inject = ['tools']

export function apply(ctx, config = {}) {
  const api = new ComfyApi({
    baseUrl: config.baseUrl || 'http://127.0.0.1:8188',
    outputDir: config.outputDir || 'D:/AI/dsh workflow/comfyui_output',
  })

  for (const def of buildTools(api)) {
    ctx.tools.register(def)
  }
}
