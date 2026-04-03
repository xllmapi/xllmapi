# 缓存 Token 支持 — 差异化计费

## 问题

上游 OpenAI/Anthropic 返回缓存 token 字段 (cache_read_input_tokens 等)，
但 xllmapi 将其合并进 inputTokens，丢失粒度，无法差异化计费。

## 方案

1. ProxyUsage 扩展 cacheReadTokens/cacheCreationTokens
2. 适配器拆分提取缓存字段
3. 数据库迁移：api_requests 加缓存列, offerings 加 cache_read_discount
4. Settlement 差异化计费
5. 前端 12 个页面同步更新

## 验证

- [ ] 适配器正确拆分缓存字段
- [ ] Settlement 差异化计费生效
- [ ] 前端正确显示缓存信息
- [ ] 全量测试通过
