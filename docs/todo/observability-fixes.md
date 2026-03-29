# 可观测性修复方案

> 设计文档 — 2026-03-30

## 问题清单

### 问题 1：日志查看器只读 out.log，漏掉 error.log（高）
- 根因：遍历路径找到第一个就 break
- 修复：合并 out.log + error.log，按时间排序

### 问题 2：PM2 日志时间戳解析失败（高）
- 根因：PM2 格式 `0|xllmapi | 2026-03-30 03:27:00 +08:00: ...` 不是 JSON
- 修复：正则匹配 PM2 格式提取时间戳，从内容推断 level

### 问题 3：Fallback 成功时单个 offering 失败信息丢失（中）
- 根因：recordFailedRequest 只在全部失败时调用
- 修复：executor 返回 failedAttempts，写入 response_body

### 问题 4：Chat 页面全部失败时无明确提示（中）
- 根因：前端可能没正确处理 error SSE 事件
- 修复：确认 streamResponse error handler 显示错误

### 问题 5：请求详情缺少格式/转换信息（低）
- 修复：新增 client_format/upstream_format/format_converted 字段

### 问题 6：节点状态页分类不合理（中）
- 根因：主动停用的节点被归入异常
- 修复：Tab 分类（全部/正常/停用/异常）+ 搜索 + 分页 + 展开详情 + 状态变化记录
