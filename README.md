<div align="center">

# xllmapi

**一个支持平台节点和分布式节点的大模型共享网络**

`统一API` -> `https://api.xllmapi.com` -> [`获取Key`](https://xllmapi.com/app/api-keys) 

[官网](https://xllmapi.com) · [文档](https://docs.xllmapi.com) · [API](https://api.xllmapi.com) · [论坛](https://forum.d2learn.org/category/25/xllmapi) · [注册邀请](https://forum.d2learn.org/topic/180)

</div>

## 最近动态

- xllmapi模型共享网络平台开启小范围内测 - [注册邀请](https://forum.d2learn.org/topic/180) - 2026/3/27

> [!CAUTION]
> 平台最近开启内测, 内测用户在测试中可以免费使用模型, 欢迎加入内测群进行交流讨论. 在测试中遇到问题可以在 [`xllmapi 论坛`](https://forum.d2learn.org/category/25/xllmapi) 中进行反馈, 被采纳的建议会赠送一定的tokens做为感谢

## 什么是 xllmapi

xllmapi 是一个大模型共享网络。每个人都可以把自己的模型接入网络获取 xtoken，从而使用网络上的其他模型。每个人可以对自己的模型节点进行自由定价和token消耗限制。平台也提供了统一的 API，支持 OpenAI 和 Anthropic 格式自动识别和转换，一个接口访问所有模型。

## 快速开始

```bash
curl https://api.xllmapi.com/v1/chat/completions \
  -H "Authorization: Bearer xk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "deepseek-chat", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## 支持的模型

| 模型 | Model ID | 说明 |
|------|----------|------|
| DeepSeek V3.2 | `deepseek-chat` | 通用对话、代码生成 |
| DeepSeek V3.2 (思考) | `deepseek-reasoner` | 深度推理 |
| MiniMax M2.7 | `MiniMax-M2.7` | Thinking 深度思考 |
| Kimi K2.5 | `kimi-for-coding` | Agent、代码生成 |

更多模型持续接入中。

## 模型共享网络 - [模型网络](https://xllmapi.com/mnetwork)

将你的模型接入 xllmapi 网络，获取 xtoken 使用其他模型

| 接入方式 | 说明 | 状态 |
|----------|------|------|
| 平台节点 | 在控制台创建平台模型节点 | 已开放 |
| 分布式节点 | 在电脑/服务器上运行模型节点 | 近期开放 |

其中分布式节点程序, 初期可能会以开源的方式发布一个cli的简单版本

## 交流与反馈

> 目前 平台 主要基于 [xllmapi 论坛](https://forum.d2learn.org/category/25/xllmapi) 进行交流, 如果你有好的想法或遇到问题可以前往发帖讨论, 对于有价值的帖子会赠送一些tokens以示感谢.

`问题贴格式`

```
## 问题描述

...

## 复现步骤

...

## 预期结果

...

## 尝试的解决办法

...

## 相关参考链接

```

`想法/功能贴格式`

```
## 功能描述

...

## 具体解决的需求

...

## 可能实现的方式

...

## 相关参考链接

```

## 社区

- [**论坛**](https://forum.d2learn.org/category/25/xllmapi) — 使用讨论、功能建议、问题求助
- **内测用户交流群(Q)**: 1092372680 — 即时交流
- [**GitHub**](https://github.com/xllmapi)
