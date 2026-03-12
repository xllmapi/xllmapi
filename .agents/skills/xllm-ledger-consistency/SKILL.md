---
name: xllm-ledger-consistency
description: 审查或实现 xllmapi 的 token credit 账本、预扣、结算、冲正和供给收益分账逻辑。适用于修改 wallets、ledger_entries、settlement_records 或请求完成后的记账流程时。
---

# xllm-ledger-consistency

用于 xllmapi 的 token credit 账本一致性检查。

## 何时使用

- 修改钱包余额逻辑
- 修改预扣或释放
- 修改 consumer/supplier/platform 分账
- 修改失败请求扣费策略

## 核心规则

1. 账本必须 append-only
2. 预扣与最终结算必须可追踪到同一 `request_id`
3. 无 usage 时默认不扣费
4. 冲正通过新增反向流水实现，不改旧记录

## 检查清单

- 是否存在余额和账本不一致风险
- 是否可能重复结算
- 流式请求断开后是否还能得到终态
- fallback 后是否只对最终命中 offering 结算

## 输出要求

- 写清每个账本 entry 的触发条件
- 写清失败路径的处理
- 写清幂等键
