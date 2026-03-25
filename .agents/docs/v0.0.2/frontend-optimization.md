# 前端优化方案

## Context

当前官网首页描述偏向"共享 API Key"，需要改为强调"共享模型能力"。同时需要优化多个 UI 区域：首页内容、Agent 配置示例、文档框架、导航栏。

## 1. 首页改版 (`pages/HomePage.tsx` + `lib/i18n.ts`)

### 1.1 Hero 区

**标题**：`大模型共享网络` → 保持动态模型名滚动
**副标题**：改为 `一个 API 接入所有模型`
**CTA**：
- 左：`开始使用` → 跳 `/auth`
- 右：`阅读文档` → 跳 `/docs`

**下方新增 API 连接展示框**：
```
┌─────────────────────────────────────────────────────┐
│ $ export OPENAI_API_BASE=https://api.xllmapi.com/v1 │  [复制]
│ $ export OPENAI_API_KEY=xk-your-api-key             │
└─────────────────────────────────────────────────────┘
                                           [获取 API Key →]
```
- Shell 风格暗色背景，带复制按钮
- "获取 API Key" 链接 → 已登录跳 `/app/api-keys`，未登录跳 `/auth`

### 1.2 模型滚动展示

替换当前"支持的模型厂商"logo 列表 → 改为**多行交叉滚动的模型名**：
```
→  GPT-4o  Claude-4  DeepSeek-V3  Gemini-2  Llama-4  Kimi  MiniMax  ...
←  Claude-Sonnet  GPT-4o-mini  DeepSeek-R1  Gemma-3  Qwen  Mistral  ...
→  Claude-Opus  GPT-o4-mini  Moonshot  MiniMax-M2.7  Yi  ...
```
CSS `@keyframes` 无限滚动，3 行交替方向。

### 1.3 四个特性卡片（改写）

| # | 标题 | 描述 |
|---|------|------|
| 1 | **共享模型网络** | 支持创建平台模型节点和分布式模型两种方式接入到模型网络 |
| 2 | **多 API 格式兼容** | 一个 API 自动识别 OpenAI 和 Anthropic 格式 |
| 3 | **共享获取收益** | 只需共享一个模型的能力，即可获取 Token 收入并访问网络上的所有模型 |
| 4 | **安全可控** | 用户拥有模型的完全控制权，可自定义使用量限制。平台只共享模型调用能力，不共享 Key |

### 1.4 Agent 配置示例（新增区域）

多选项卡展示主流 Agent 的配置方式：

```
[ OpenCode ]  [ Claude Code ]  [ OpenClaw ]
```

每个 tab 显示对应的配置文件或命令，带复制按钮。

**OpenCode tab**:
```json
{
  "provider": {
    "xllmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.xllmapi.com/xllmapi/v1",
        "apiKey": "<YOUR_API_KEY>"
      },
      "models": { "deepseek-chat": { "name": "DeepSeek" } }
    }
  }
}
```

**Claude Code tab**:
```json
{
  "apiProvider": "openai-compatible",
  "openaiBaseUrl": "https://api.xllmapi.com/v1",
  "openaiApiKey": "<YOUR_API_KEY>"
}
```

**OpenClaw tab**:
```bash
OPENAI_API_BASE=https://api.xllmapi.com/v1
OPENAI_API_KEY=<YOUR_API_KEY>
```

## 2. 导航栏 (`components/layout/Header.tsx`)

- 加 GitHub 图标链接到 `https://github.com/xllmapi/xllmapi`（用 SVG icon）
- 放在语言切换按钮旁边

## 3. 文档 — fumadocs 独立项目

### 方案：独立 Next.js + fumadocs 文档站

文档作为独立项目，不嵌入当前 Vite + React 前端。

**仓库**：`xllmapi/xllmapi-docs`（或 monorepo 内 `apps/docs/`）

**技术栈**：Next.js 14+ / fumadocs-core + fumadocs-ui

**部署**：`docs.xllmapi.com`（Vercel / Cloudflare Pages / 自托管）

**文档结构**：
```
content/docs/
  getting-started.mdx      — 快速开始
  authentication.mdx       — 认证（API Key / Session）
  api/
    openai.mdx             — OpenAI 兼容 API
    anthropic.mdx          — Anthropic 兼容 API
    xllmapi-unified.mdx    — xllmapi 统一 API
  models.mdx               — 模型列表
  agents/
    opencode.mdx           — OpenCode 配置
    claude-code.mdx        — Claude Code 配置
    openclaw.mdx           — OpenClaw 配置
  provider/
    getting-started.mdx    — 接入模型（供应商指南）
    distributed-node.mdx   — 分布式节点
  economy.mdx              — Token 经济与结算
```

**当前前端处理**：
- `Header.tsx` 导航栏"文档"链接改为指向 `https://docs.xllmapi.com`（外链）
- 现有 `DocsPage.tsx` 保留作为临时 fallback，加顶部 banner 引导到新文档站
- 未来完全迁移后删除 DocsPage

**本次实施**：先搭建 fumadocs 项目骨架 + 写核心文档页（快速开始、API、Agent 配置），后续持续补充。

## 文件清单

### 前端（apps/web/src/）
| 文件 | 改动 |
|------|------|
| `pages/HomePage.tsx` | 重写 hero、特性卡片、模型滚动、Agent 示例 |
| `components/layout/Header.tsx` | 加 GitHub 图标 + 文档链接改外链 |
| `lib/i18n.ts` | 更新首页文案（中英文） |

### 文档（独立项目）
| 文件 | 改动 |
|------|------|
| `apps/docs/` 或新仓库 | fumadocs 项目初始化 |
| `content/docs/*.mdx` | 文档内容 |

## 实施顺序

1. **首页改版** — HomePage.tsx + i18n（改动最大）
2. **Header 优化** — GitHub 图标 + 文档外链
3. **fumadocs 文档项目** — 独立初始化 + 核心文档

## Verification

1. 首页：模型名多行滚动流畅
2. API 框可复制
3. "获取 API Key" 登录/未登录跳转正确
4. Agent 配置 tabs 切换正常
5. GitHub 图标点击跳转正确
6. fumadocs 本地 `npm run dev` 能跑，文档页面正常渲染
