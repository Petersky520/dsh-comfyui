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

本包是一个标准 dsh bundle：`package.json` 里声明了
`dsh.bundle.patch`，同目录的 `cordis.patch.yml` 负责把 `comfyui-native`
条目 insert 进配置树。**不需要**手改 profile 的 `cordis.patch.yml`。

1. 把本包加进 profile 依赖（以 desktop 为例）：

   ```jsonc
   // ~/.dsh/profiles/desktop/package.json
   "dependencies": {
     "dsh-comfyui": "file:D:/Plugins/dsh-comfyui"
   }
   ```

2. 把包名加进同一个文件的 bundle 层栈：

   ```jsonc
   "dsh": {
     "profile": {
       "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-comfyui" ]
     }
   }
   ```

3. 在 profile 目录装依赖，然后重启 dsh：

   ```powershell
   cd ~/.dsh/profiles/desktop
   pnpm install
   ```

挂载后的条目 id 是 `comfyui-native`。要在**不改本包**的前提下覆盖配置（补丁
只能命中已存在的 id）：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: comfyui-native
  name: dsh-comfyui
  config:
    baseUrl: http://127.0.0.1:8188
    outputDir: D:/somewhere/else
```

## 疑难排查（都是这个插件实际踩过的坑）

1. **在 profile 的 `cordis.patch.yml` 里直接写一个新 id 的条目是无效的。**
   那里的条目是补丁，只能覆盖配置树里已存在的 id；新 id 会被
   `patch: entry "xxx" not found` 跳过。新增插件必须写成 `insert:` 列表——
   本包是把这条 `insert` 放进了自己的 bundle patch（`cordis.patch.yml`）。
2. **打包运行的桌面端里，profile 自己的 patch 层中的裸包名是从 dsh 安装
   目录解析的，不是 profile 目录**，所以 profile 本地的插件在那一层必须写成
   相对路径（`./node_modules/dsh-comfyui/index.js`）。放进 bundle 层则可以用
   裸包名——bundle 是按自身目录解析的。检查 `name: dsh-comfyui` 对
   `comfyui-native` 这一行是正确的。
3. **`file:` 依赖是拷贝，不是软链。** 改完本包源码后 `pnpm install` 常报
   "Already up to date" 而不会同步，需要手动刷新
   `~/.dsh/profiles/<profile>/node_modules/dsh-comfyui`，或先删掉该目录再装。
4. **peerDependencies 会触发 dsh 的版本闸门。** 声明范围必须覆盖宿主版本
   （本包写 `^0.1.5-rc.2 || ^0.2.0-rc.2`）；否则 bundle 会被拒绝挂载，提示
   `Plugin dsh-comfyui@x.y.z is incompatible with dsh <version>`，需要用
   `dsh plugin allow-version` 或插件管理器显式授予 exemption。

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
