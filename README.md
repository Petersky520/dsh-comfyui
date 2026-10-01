# dsh-comfyui

DeepSeek Harness（dsh）原生 ComfyUI 插件：直连本机 ComfyUI HTTP API，
把 ComfyUI 出图/出视频能力注册为 dsh 原生工具，让智能体直接驱动 ComfyUI 创作。

## 与 MCP 桥接版的关系

| | 本插件（原生） | `@deepseek-ai/dsh-mcp-client` 桥接 |
|---|---|---|
| 工具名 | `comfy_status` 等 8 个 | `mcp__comfyui__*` 共 9 个 |
| 工作流格式 | 只接受 **API 格式** | 自带 UI→API 转换器（`comfy_convert`） |
| 依赖 | 无（纯 Node fetch） | Python venv + MCP 服务端进程 |

两者可并存，互不冲突。需要提交「界面导出」的 UI 格式工作流时，用桥接版的
`comfy_convert` 转换后再交给任意一版提交即可。

## 工具清单

| 工具 | 作用 |
|---|---|
| `comfy_status` | 在线状态、显卡显存、队列（**每次先调它**） |
| `comfy_list` | 列出模型文件（checkpoints/loras/vae/…/all） |
| `comfy_node_info` | 查节点定义 / 全部节点类名 |
| `comfy_submit` | 提交 API 格式工作流（支持 `dry_run` 预检） |
| `comfy_queue` | 队列查看 / 清空 / 中断 |
| `comfy_history` | 查执行结果与输出文件清单 |
| `comfy_watch` | 等任务完成并把结果下载到本地 |
| `comfy_upload` | 上传图片到 ComfyUI input 目录 |

## 安装

1. 把本包加入 profile 依赖（以 desktop 为例）：

   ```jsonc
   // ~/.dsh/profiles/desktop/package.json
   "dependencies": {
     "dsh-comfyui": "file:D:/Plugins/dsh-comfyui"
   }
   ```

2. 在 profile 的 `cordis.patch.yml` 加一条加载条目：

   ```yaml
   - id: comfyui-native
     name: dsh-comfyui
     config:
       baseUrl: http://127.0.0.1:8188          # 可省，默认值
       outputDir: D:/AI/dsh workflow/comfyui_output  # 可省，默认值
   ```

3. 在 profile 目录执行 `pnpm install`，重启 dsh。

## 典型创作流程

```
comfy_status                      → 确认 ComfyUI 在线
comfy_list(kind=checkpoints)      → 核对模型文件名
comfy_submit(workflowPath=...)    → 拿到 prompt_id
comfy_watch(prompt_id)            → 等完成，拿到落盘文件路径
```

## 前提

ComfyUI 需已在 8188 端口运行（如秋叶整合包 `绘世启动器.exe`）。
插件不会替你启动 ComfyUI；`comfy_status` 返回连不上时请先启动它。
