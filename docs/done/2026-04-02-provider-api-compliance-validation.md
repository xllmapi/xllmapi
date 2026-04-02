# 供应商 API 规范校验功能

## 问题

MiMo、hanbbq 等供应商的 Anthropic streaming 端点存在非标准行为（`message_start.input_tokens=0`），导致 token 计费错误。需要在配置阶段就能发现这些问题。

## 方案

### 后端：新增 `POST /v1/admin/provider-presets/validate-api`

对每个端点执行：非流式 usage 检测 + 流式 usage 检测 + 流式规范性检测。

### 前端：ProvidersPage 编辑表单中增加校验区域

折叠面板，填入临时 API Key 后点击校验，显示各端点的检查项结果。

### 服务端防线：泛化 anthropicAdapter 的 input_tokens 提取

从 `message_delta` 也提取 `input_tokens`，取 max 值，兼容所有非标准实现。

## 验证结果

- [x] npm run build 通过
- [x] 单元测试通过
- [x] 本地 dev 验证校验功能正常
