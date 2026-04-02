# API 规范合规性优化 — 阶段二/三/四

## 阶段二: 跨格式内容块保留

- 2A: 请求转换增强 (tools, images, 参数保留)
- 2B: 响应转换增强 (tool_calls ↔ tool_use)
- 2C: 流式 thinking 块修正 (reasoning_content → thinking block)

## 阶段三: 参数与头部改善

- 3A: 移除 max_tokens 8192 硬限
- 3B: 上游错误格式转换
- 3C: retry-after 头透传
- 3D: model name fallback

## 阶段四: 可观测性

- 4A: 格式转换指标暴露
- 4B: 转换降级告警 header

## 测试

- [ ] converter.test.ts: tools/image/params 转换
- [ ] response-converter.test.ts: tool_calls/thinking JSON + 流式
- [ ] 全量测试通过
