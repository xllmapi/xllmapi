# xllmapi v0.0.2 Changelog

## v0.0.2 (2026-03-22)

### New Provider: MiniMax
- 接入 MiniMax (OpenAI-compatible)，baseUrl `https://api.minimaxi.com/v1`
- 预设模型：MiniMax-M2.7、MiniMax-M2.5、MiniMax-Text-01
- Provider presets 扩展为多模型结构（DeepSeek 2 models, OpenAI 2 models, MiniMax 3 models）

### Auto Model Discovery
- 新增 `POST /v1/provider-models` 端点
- 用户输入 API key 后自动查询厂商 `/v1/models` 接口获取可用模型列表
- 支持 OpenAI / OpenAI-compatible / Anthropic 三种协议
- 前端输入 key 后 600ms 自动触发，无需手动操作
- 发现失败自动 fallback 到 preset 列表
- 支持手动添加自定义模型名称

### Thinking/Reasoning UI
- 支持 `<think>...</think>` 标签的模型推理过程显示
- 流式阶段：实时展示思考内容 + 旋转动画 + "思考中…"
- 完成后：折叠为 `▶ 思考过程` 按钮，点击展开/收起
- 思考区域最大 300px，超出可滚动
- 复制按钮只复制正文答案（不含思考过程）
- 兼容无 think 标签的模型（DeepSeek-chat、GPT 等不受影响）

### Chat Scroll UX
- 模型输出时默认自动跟随滚动
- 用户上滚超过 80px 后停止自动滚动，可自由回看历史
- 浮动按钮：流式中显示"↓ 跟随输出"，非流式显示"↓ 回到底部"
- 新消息开始流式时自动重置跟随状态

### Network Page Redesign
- Provider 下拉按 id 分组（DeepSeek、OpenAI、Anthropic、MiniMax 独立选项）
- 输入 API key 后自动发现模型，发现的模型带 `API` 标签
- 提交流程增加步骤状态：验证 Key → 创建模型节点 → 接入成功 ✓
- 按钮旁实时显示当前步骤 + spinner

### Bug Fixes
- **黑屏 crash 修复**：`supplierReward` 从 DB 返回字符串，`.toFixed()` 在字符串上调用导致 React 崩溃
- **全局 ErrorBoundary**：App.tsx 添加错误边界，崩溃时显示错误信息 + Reload 按钮
- **formatTokens 阈值**：999,950 → 1.0M（避免显示 1000.0K）；所有数值显示用 `Number()` 包裹防止字符串类型报错
- **节点数统计**：`ownerCount`（唯一用户数）代替 `enabledOfferingCount`（offering 总数），SQL 增加 `credentialCount` 字段
- **MiniMax baseUrl**：从 `api.minimax.io` 修正为 `api.minimaxi.com`（中国区）
