---
name: xllm-core-routing-review
description: 审查或实现 xllmapi C++ core 的 offering 筛选、评分、熔断、fallback 和路由策略。适用于修改 route engine、健康度、价格权重、失败降权或备用路由逻辑时。
---

# xllm-core-routing-review

用于 xllmapi 的 C++ 路由与调度逻辑。

## 何时使用

- 修改 offering 候选筛选
- 修改评分公式
- 新增 routing mode
- 调整 fallback、熔断、降权
- 排查“命中错误 offering”或“低质量 offering 被优先调度”

## 审查顺序

1. 先确认 TS 平台层预过滤是否已做：
   - offering 审核
   - 用户状态
   - 最小余额检查
2. 再看 C++ core 运行时过滤：
   - 健康状态
   - 近时错误率
   - 熔断状态
3. 最后检查评分公式与 tie-break 规则。

## 默认原则

- 先保证成功率，再压成本
- fallback 只在未产生可计费 usage 时触发
- 认证错误优先视为 credential 问题
- 网络错误、超时、5xx 分开统计

## 输出要求

- 标出路由输入
- 标出评分字段和权重
- 标出 fallback 触发条件
- 标出可能导致错误计费的边界
