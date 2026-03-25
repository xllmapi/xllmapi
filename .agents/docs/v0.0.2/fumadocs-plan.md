# fumadocs 文档项目方案（面向用户）

## Context

xllmapi 用户文档站。只包含平台使用相关内容，不包含开发/部署文档。

## 文档目录/菜单

```
左侧菜单                           文件
────────────────────────────────────────
📖 快速开始
  ├─ 平台介绍                      getting-started/introduction.mdx
  ├─ 注册与登录                     getting-started/auth.mdx
  ├─ 获取 API Key                  getting-started/api-key.mdx
  └─ 第一次调用                     getting-started/first-call.mdx

🌐 模型网络
  ├─ 概述                          model-network/overview.mdx
  ├─ 连接模型（使用者）              model-network/connect-model.mdx
  ├─ 平台节点（供应者）              model-network/platform-node.mdx
  ├─ 分布式节点（供应者）            model-network/distributed-node.mdx
  ├─ 模型列表                      model-network/models.mdx
  └─ Token 经济与结算               model-network/economy.mdx

📡 API 使用
  ├─ 概述                          api/overview.mdx
  ├─ OpenAI 格式                   api/openai.mdx
  ├─ Anthropic 格式                api/anthropic.mdx
  ├─ xllmapi 统一格式              api/xllmapi-unified.mdx
  └─ 错误码                        api/errors.mdx

🤖 Agent 配置
  ├─ OpenCode                      agents/opencode.mdx
  ├─ Claude Code                   agents/claude-code.mdx
  ├─ OpenClaw                      agents/openclaw.mdx
  └─ 通用 OpenAI 客户端             agents/generic-openai.mdx

💬 社区与支持
  ├─ 常见问题                      community/faq.mdx
  ├─ 社区交流                      community/groups.mdx
  └─ 反馈与建议                     community/feedback.mdx
```

## 实施计划

| 步骤 | 内容 |
|------|------|
| 1 | 初始化 fumadocs 项目 |
| 2 | 配置菜单结构 |
| 3 | 写快速开始（4 页） |
| 4 | 写 API 使用（5 页） |
| 5 | 写 Agent 配置（4 页） |
| 6 | 写模型网络（6 页） |
| 7 | 写社区与支持（FAQ + 社区交流 + 反馈） |
| 8 | Header 文档链接改外链 |

## Verification

1. `npm run dev` 本地可访问
2. 菜单结构和顺序正确
3. 文档渲染 + 代码高亮 + 复制
