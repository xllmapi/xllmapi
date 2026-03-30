# Fix: preset JOIN 空字符串 URL 导致 offering 重复

## 问题

`findOfferingsForModel` 和 `findUserOfferingsForModel` 的 SQL 中 LEFT JOIN provider_presets 使用 LIKE 匹配：

```sql
LEFT JOIN provider_presets p ON (
  RTRIM(c.base_url, '/') LIKE RTRIM(p.base_url, '/') || '%'
  OR RTRIM(c.base_url, '/') LIKE RTRIM(p.anthropic_base_url, '/') || '%'
)
```

当 preset 的 `base_url` 为空字符串时（如 kimi-coding 只有 anthropic 端点），`LIKE '' || '%'` = `LIKE '%'`，匹配所有 credential URL，导致不相关的 offering 被错误关联到该 preset。

**影响**：MiMo offering 返回 2 行（一行匹配 kimi-coding，一行匹配 xiaomi-mimo），第一行用了错误的 customHeaders 和 providerLabel，尝试 Anthropic 端点 401。

## 修复

在 JOIN 条件中排除空字符串：

```sql
LEFT JOIN provider_presets p ON (
  (p.base_url IS NOT NULL AND p.base_url != '' AND RTRIM(c.base_url, '/') LIKE RTRIM(p.base_url, '/') || '%')
  OR (p.anthropic_base_url IS NOT NULL AND p.anthropic_base_url != '' AND RTRIM(c.base_url, '/') LIKE RTRIM(p.anthropic_base_url, '/') || '%')
)
```

需要修改 `postgres-platform-repository.ts` 中所有使用该 JOIN 模式的查询。

## 验证

1. `npm run build` + `npm run test:platform-api`
2. 验证 MiMo offering 不再返回重复行
3. 验证 Kimi Coding offering 仍然正确关联到 kimi-coding preset
