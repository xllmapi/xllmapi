# xllmapi Implementation Phases

## Phase 1

目标：打通最小非流式 chat 闭环。

- 初始化 monorepo
- 创建 TS 平台层骨架
- 创建 C++ core 骨架
- 固定内部执行协议
- 打通单逻辑模型、单 offering、单 provider 的非流式 chat
- 写入请求、usage、settlement、ledger

验收：

- 平台 API 可启动
- C++ core 可启动
- 能完成一次真实或 mock 执行
- 能写入基础账本记录

## Phase 2

目标：补齐路由、fallback、共享供给。

- 多 offering 候选筛选
- 路由评分
- fallback
- offering 审核和启停
- 供给者收益查询

## Phase 3

目标：补齐流式与可运营化。

- chat-stream
- SSE 终结事件
- 流式结算
- 风控与健康度
- 管理后台统计
