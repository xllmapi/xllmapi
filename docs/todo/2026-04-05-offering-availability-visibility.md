# Offering 可用性状态优化方案

**日期**: 2026-04-05
**状态**: 进行中

## Context

当 offering 因日 token 限额耗尽而不可用时，存在三个问题：
1. **后端不可见**：502 错误既没有 console 日志，也没有写入 DB（因为 `chosen_offering_id` NOT NULL 约束导致 `recordFailedRequest` 静默失败）
2. **管理员不可见**：Admin 健康页面只看熔断器状态，不感知日限额耗尽。offering 显示为 "正常" 但实际已不可用
3. **供应者不可见**：供应者页面完全没有可用性状态信息

## 方案概览

引入 **`availabilityStatus`** 概念，统一反映 offering 的真实可用性，覆盖：日限额耗尽、熔断器打开、并发已满等所有不可用原因。

---

## 一、后端：修复失败请求记录 + 添加可用性状态

### 1.1 修复 `recordFailedRequest` 的 NOT NULL 问题

**文件**: `apps/platform-api/src/repositories/postgres-platform-repository.ts:3268-3274`

`chosen_offering_id` 列是 NOT NULL，当所有 offering 被跳过时传入 null 导致 INSERT 静默失败。

**改动**: 新建 `failed_api_requests` 表，无 FK 约束：

```sql
CREATE TABLE failed_api_requests (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL,
  logical_model TEXT NOT NULL,
  error_message TEXT NOT NULL,
  client_ip TEXT,
  client_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_failed_api_requests_created ON failed_api_requests (created_at DESC);
```

### 1.2 添加失败日志输出

**文件**: `apps/platform-api/src/routes/api-proxy.ts`, `apps/platform-api/src/routes/chat.ts`

在 catch 块中添加 `console.error`。

### 1.3 offering-health 端点增加可用性状态

**文件**: `apps/platform-api/src/routes/admin.ts:308-338`

为每个 offering 计算实时 `availabilityStatus`（available/quota_exhausted/degraded/disabled）+ `dailyTokenUsed`。

### 1.4 Stats 端点增加日限额使用情况

`getOfferingStats` 增加返回 `dailyTokenUsage`。

---

## 二、前端：Admin 健康页面增强

### 2.1 新增 "额度耗尽" 状态 badge + 修改 getDisplayStatus 逻辑
### 2.2 日限额使用进度条
### 2.3 主表格列增强（可用性状态 + 日用量）

---

## 三、前端：供应者页面增强

### 3.1 Offering 卡片增加当日用量/限额显示

---

## 验证

1. 将 offering dailyTokenLimit 设为很小值，发送请求，确认日志+DB记录+UI状态
2. 重置限额后确认状态恢复
3. 触发熔断器确认显示"异常"状态

## 本地模拟测试

### 测试 1: 失败请求记录 + console.error
- 请求不存在的模型 → `failed_api_requests` 表有记录
- 将 offering dailyTokenLimit 设为 1，发送请求 → PM2 日志输出 `[api-proxy] request=... error: all 1 offerings unavailable: 1 offering(s) exceeded daily token limit`
- `failed_api_requests` 表记录了该失败请求

### 测试 2: offering-health API 可用性状态
- dailyTokenLimit=1, 已用 15 tokens → `availabilityStatus: "quota_exhausted"`, `dailyTokenUsed: 15`
- 重置 dailyTokenLimit=1000000 → `availabilityStatus: "available"`

### 测试 3: supply usage todayTokens
- `/v1/usage/supply` 返回 `todayTokens` 字段

### 测试 4: 单元测试
- 242 tests pass, 0 fail

### 测试 5: 构建
- `npm run build` 成功（前端 + 后端 TypeScript 编译通过）
