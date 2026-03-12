---
name: xllm-core-provider-adapter
description: 为 xllmapi 的 C++ core 新增或审查 provider 适配能力。适用于接入 OpenAI、Anthropic、OpenAI-compatible 端点，或修改 llmapi/tinyhttps 执行链路、provider 配置、usage 提取与错误归一化时。
---

# xllm-core-provider-adapter

用于 xllmapi 的 `core-router-executor` provider 适配工作。

## 何时使用

- 新增 provider 或 compatible endpoint
- 修改 provider config 组装逻辑
- 修改 usage 提取
- 修改错误归一化
- 调整 `llmapi` 与 `tinyhttps` 的出站执行链路

## 工作方式

1. 先确认目标 provider 是否属于：
   - `openai`
   - `anthropic`
   - `openai_compatible`
2. 优先复用 `/home/speak/workspace/github/mcpplibs/llmapi` 已有能力，不重复实现 provider 协议。
3. 若需新 provider，先在 core 内抽象：
   - provider 类型枚举
   - config 组装
   - usage 映射
   - normalized error 映射
4. 所有 provider 差异必须收敛到统一响应结构。

## 约束

- 不在 TS 平台层处理真实 provider 协议
- 不在日志中输出明文 credential
- 非流式与流式都要考虑 usage 和错误收口
- 新增 provider 时优先保证 chat，再补 embeddings 或 tools

## 输出要求

- 给出新增/修改的 provider 类型
- 说明路由层是否需要感知差异
- 明确 usage 字段来源
- 明确 fallback 是否安全
