# 自在播 · ZaiZaiBo

![electron](https://img.shields.io/badge/electron-44.5.1-brightgreen.svg)
![vue](https://img.shields.io/badge/vue-3.5-brightgreen.svg)
![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)
![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)
![TypeScript](https://img.shields.io/badge/typescript-7-blue.svg)

> 一站式直播互动助手桌面应用：连接直播间采集弹幕、智能朗读、背景音乐、自动报时、游戏大厅与卡密激活，基于 pnpm monorepo 的 Electron + Vue 3 模板构建。

自在播（`electron-vite-template`）是一个面向主播的桌面端直播辅助工具。它通过独立直播间窗口注入脚本采集弹幕，结合微软 Edge 在线 TTS 实现智能朗读，并提供背景音乐、语音输出设备切换、自动报时、游戏窗口与卡密激活等直播常用能力。

底层基于 `electron-vite-template` 模板：域分组类型化 IPC、contextBridge 安全模型、pnpm monorepo、vp run 缓存构建、可选 V8 字节码保护与双更新方案（整包 + 增量热更新）开箱即用。

## 功能特性

### 直播互动
- **直播弹幕采集** — 弹出独立直播间窗口加载抖音直播间，对 webContents 子 frame 注入脚本读取弹幕与在线人数；登录态持久化，支持隐藏窗口（移出屏幕）保持 JS 后台运行
- **智能朗读（TTS）** — 基于 `msedge-tts` 调用微软 Edge 在线 TTS，支持多音色预设、引导话术、音量/语速调节，复用 WebSocket 连接并带失败重试与合成结果缓存
- **自动报时** — 定时语音播报，自定义播报内容与频率
- **游戏大厅** — 一键打开游戏窗口，支持音频输出路由（静音/音量/指定声卡）

### 音频与设备
- **背景音乐** — 内置 BGM + 用户自定义音乐，播放列表与音量控制
- **语音输出设备切换** — 通过 `setSinkId` 将 TTS / 音乐路由到指定输出设备；自动检测虚拟声卡（macOS BlackHole、Windows VB-CABLE）以支持直播推流混音

### 应用与系统
- **卡密激活** — 基于机器码的卡密充值与授权校验
- **系统设置** — 通用配置、输出设备选择等
- **自定义窗口控制** — 跨平台自定义标题栏（macOS 红绿灯 / Windows 最小化/最大化/关闭），托盘管理
- **i18n** — 简体中文 / English

### 工程能力
- **域分组类型化 IPC** — 所有通道在 `packages/ipc-contract` 中按域声明（`app` / `browser` / `download` / `print` / `updater` / `window`），通道名、载荷、返回值全链路类型推导
- **安全模型** — 全窗口 `contextIsolation` + `sandbox` 开启、`nodeIntegration` 关闭，渲染进程唯一通道为 preload 暴露的白名单桥
- **pnpm monorepo** — `apps/desktop` 应用本体 + `packages/ipc-contract` 共享合同 + `tools` 构建工具链
- **vp run 缓存构建** — vite-plus 流水线按文件粒度缓存，源码未变直接命中
- **可选字节码保护** — 主进程可编译为 V8 字节码（QQ 同源方案），默认构建不参与
- **双更新方案** — `electron-updater` 整包更新 + 增量热更新（主进程/渲染进程内容替换，无需重装）
- **三端打包** — Windows (x64/ia32)、macOS、Linux

## 环境要求

- **Node.js ≥ 24** — 构建脚本依赖 Node 原生 TypeScript 支持
- **pnpm** — 唯一包管理器（`corepack enable` 通过 `packageManager` 字段对齐版本）

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/umbrella22/electron-vite-template.git
cd electron-vite-template

# 安装依赖
pnpm install

# 启动开发（热重载，localhost:9080）
pnpm dev

# 构建并打包当前平台
pnpm build

# 仅构建不生成安装包（快速校验打包）
pnpm build:dir

# 打包指定平台
pnpm build:win64   # Windows x64
pnpm build:win32   # Windows ia32
pnpm build:mac     # macOS

# Web 目标构建
pnpm build:web

# 打包热更新资源
pnpm pack:resources
```

## 项目结构

```
├── apps/
│  └── desktop/                 # 应用本体（自在播）
│     ├── src/
│     │  ├── main/              # 主进程
│     │  │  ├── config/         #    窗口配置 / 静态路径 / 常量
│     │  │  ├── hooks/          #    菜单、F12 禁用、异常钩子
│     │  │  └── services/       #    弹幕采集 / TTS / 音频设备 / 游戏窗口 / 更新 ...
│     │  ├── preload/           # preload 桥（contextBridge 白名单）
│     │  └── renderer/          # Vue 3 渲染进程
│     │     ├── views/          #    页面：直播主页 / 连接直播 / 智能朗读 / 背景音乐 /
│     │     │                   #          自动报时 / 游戏大厅 / 卡密充值 / 系统设置
│     │     ├── store/modules/  #    Pinia：speech / bgm / connect / clock / template
│     │     ├── components/     #    标题栏 / 侧边栏 / 状态栏
│     │     └── utils/          #    类型化 IPC、请求、通知等
│     ├── build.json            # electron-builder 配置（productName: 自在播）
│     └── updateConfig.json     # 增量热更新配置
├── packages/
│  └── ipc-contract/            # IPC 通道合同（app/browser/download/print/updater/window）
├── tools/
│  ├── build/                   # 构建工具链（rolldown + vite-plus，dev-runner 编排）
│  └── bytecode/                # 可选主进程字节码保护
├── doc/                        # VitePress 文档站（中文）
└── package.json                # 根脚本编排 + 共享 devDependencies
```

## 文档

📘 **[在线文档](https://umbrella22.github.io/electron-vite-template/)**（中文）

涵盖快速上手、目录结构、IPC 合同体系、安全模型、构建打包、热更新、字节码保护与 CI 工作流。

## 说明

- 本仓库基于 [electron-vite-template](https://github.com/umbrella22/electron-vite-template) 模板开发，产品名称为「自在播」
- 欢迎提交 Issue 与 PR
