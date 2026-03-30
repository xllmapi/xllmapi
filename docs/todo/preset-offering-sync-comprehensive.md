# Preset→Offering 配置同步机制全面修复

**日期**: 2026-03-30
**分支**: `fix/preset-offering-sync-comprehensive`

## 问题

Admin 修改 preset 配置后不生效。credential/offering 创建时快照 preset 值，之后不同步。运行时 JOIN 条件脆弱（依赖 provider_type 匹配 + URL LIKE）。

## 修复

1. Admin 保存 preset 时验证 URL 与 API 格式一致
2. offering 查询中 providerType 和 baseUrl 用 preset 覆盖
3. resolveEndpoint 支持 Anthropic-only（无 baseUrl）
4. hasEndpoint 更新
5. contextLength 从 preset models COALESCE
