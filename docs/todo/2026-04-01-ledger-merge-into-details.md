# 优化：删除冗余「资金流水」tab，复用「按日期」明细视图

## Context

当前 OverviewPage 有三个 tab：「按日期」「按模型」「资金流水」。
- 「按日期」数据源：`/v1/usage/consumption/recent` + `/v1/usage/supply/recent`（仅 API 调用记录）
- 「资金流水」数据源：`/v1/ledger`（全部 token 变动）

两者的 consumer_cost / supplier_reward 数据**完全重复**，「资金流水」仅多了 initial_credit、admin_adjust、referral_reward 三种非 API 类型。应删掉冗余 tab，让「按日期」直接使用 `/v1/ledger` 作为数据源。

---

## 分析：需要处理的 6 个关键问题

### 1. 列结构差异

现有「按日期」DataTable 列：`[类型色条] [时间] [模型] [xtokens] [Tokens] [Input] [Output] [Provider]`

非 API 条目（initial_credit / admin_adjust / referral_reward）没有 model / inputTokens / outputTokens / totalTokens 字段。

**方案**：
- 模型列：非 API 条目显示类型标签（如「注册赠送」「管理员调整」），用不同样式区分
- Tokens / Input / Output 列：非 API 条目显示 `—`
- xtokens 列：统一使用 `direction` + `amount`，credit 绿色 +，debit 橙色 −（与现有一致）
- Provider 列：非 API 条目显示 `note`（如 "管理员调整" 或自定义备注）

### 2. 数据合并 / 去重

现有逻辑将 consumption 和 supply 两个列表合并，同一 requestId 去重（消费优先显示，供应标记为 supply type）。

`/v1/ledger` 返回的数据本身就是**每条独立的 ledger 条目**，同一个请求对同一个用户可能有 consumer_cost 和 supplier_reward 两条（自己调用自己的 offering），但它们的 direction 不同（一个 debit 一个 credit），语义清晰，不需要去重。

**方案**：直接使用 ledger 数据，不做合并/去重。每条 ledger entry 独立显示。条目的 `type` 从 `direction` 推导：`credit` = supply/income，`debit` = consume/expense。

### 3. 热力图（Heatmap）不受影响

热力图数据来自 `/v1/usage/consumption/daily` + `/v1/usage/supply/daily`，按年按日聚合 token 数量。这是 API 使用模式的可视化，**不应该包含非 API 条目**（注册赠送不是"使用"）。

**方案**：热力图数据源保持不变。

### 4. 日期/模型筛选

- **日期筛选**（点击热力图日期）：对 ledger 数据按 `createdAt` 日期过滤。非 API 条目也有 createdAt，正常过滤。
- **模型筛选**（点击热力图模型）：非 API 条目的 `logicalModel` 为 null。模型筛选时，这些条目应被**排除**（它们不属于任何模型）。

**方案**：筛选逻辑增加对 `logicalModel === null` 的处理——日期筛选正常包含，模型筛选时排除无模型条目。

### 5. 「按模型」视图不受影响

「按模型」视图的数据来自 `/v1/usage/consumption` + `/v1/usage/supply` 的聚合统计，不是 ledger。不需要改动。

### 6. 分页策略变更

现有「按日期」：一次性加载 30 天全部数据到前端，前端分页（PAGE_SIZE=10）。
`/v1/ledger`：服务端分页（limit/offset）。

**方案**：切换为**服务端分页**。好处：
- 数据量大时不需要一次加载全部
- 与 ledger API 的分页能力对齐
- 初始加载更快

分页参数：每页 20 条（比现有 10 条多一点，因为条目更轻量），支持翻页。

日期/模型筛选时，通过 `/v1/ledger` 的 query params 在服务端过滤（需要后端增加 `date` 和 `model` 过滤参数）。

---

## 改动清单

### 后端：扩展 `/v1/ledger` API

**文件**: `apps/platform-api/src/services/ledger-service.ts` + `apps/platform-api/src/routes/usage.ts`

1. `getLedgerHistory` SQL 增加返回字段：
   ```sql
   ar.input_tokens AS "inputTokens",
   ar.output_tokens AS "outputTokens",
   ar.total_tokens AS "totalTokens",
   ar.real_model AS "realModel"
   ```

2. 增加查询参数支持：
   - `date` — 按日期过滤（`le.created_at::date = $N`）
   - `model` — 按模型过滤（`ar.logical_model = $N`）

3. 路由层传递新参数：
   ```
   GET /v1/ledger?limit=20&offset=0&type=&date=2026-04-01&model=deepseek-chat
   ```

### 前端：改造 OverviewPage

**文件**: `apps/web/src/pages/app/OverviewPage.tsx`

1. **删除**「资金流水」tab 相关代码：
   - 删除 `ViewMode` 中的 `"ledger"`
   - 删除 `ledgerData` / `ledgerTotal` / `ledgerPage` / `ledgerLoading` 状态
   - 删除 `loadLedger` 函数和 useEffect
   - 删除资金流水 tab 按钮
   - 删除整个 ledger 渲染分支

2. **替换「按日期」数据源**：
   - 删除对 `/v1/usage/consumption/recent` 和 `/v1/usage/supply/recent` 的请求
   - 删除客户端合并/去重逻辑（`mergedRecords`）
   - 改为调用 `/v1/ledger`，服务端分页
   - 新增 `loadRequests` 函数（类似现在的 `loadLedger`，但传递 date/model 筛选参数）

3. **适配 DataTable 列定义**（`requestColumns`）：
   - 类型色条：`direction === "credit"` → 绿色（收入），`"debit"` → 橙色（支出）；非 API 条目用蓝色区分
   - 时间列：不变
   - 模型列：API 条目显示 `logicalModel`；非 API 条目显示 i18n 类型标签（注册赠送、管理员调整等）
   - xtokens 列：统一用 `direction` + `amount`，带 +/- 号和颜色
   - Tokens / Input / Output 列：非 API 条目显示 `—`
   - Provider 列：API 条目显示 provider；非 API 条目显示 `note`（admin_adjust 默认备注改为"平台调整"）

4. **适配筛选逻辑**：
   - 日期筛选：通过 `date` query param 传给后端
   - 模型筛选：通过 `model` query param 传给后端
   - 筛选变化时重新请求第一页

5. **适配分页**：
   - 改为服务端分页，使用 `offset` / `limit`
   - 状态：`currentPage`、`totalCount`
   - 每页 20 条

### 不改动的部分

- 热力图数据源（consumption/daily + supply/daily）
- 「按模型」视图数据源（consumption + supply 聚合）
- StatCards 数据源
- 后端 `/v1/ledger` 的现有功能
- LedgerService 核心逻辑
- 管理员 UsersPage 备注功能
- ConfirmDialog 多输入支持

---

## MergedRecord → LedgerRecord 类型映射

```typescript
// 旧类型
interface MergedRecord {
  id: string;
  type: "consume" | "supply";
  logicalModel: string;
  provider?: string;
  providerLabel?: string;
  realModel?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt?: string;
  consumerCost?: number;
  supplierReward?: number;
}

// 新类型（直接映射 /v1/ledger 响应）
interface LedgerRecord {
  id: number;
  requestId: string | null;
  direction: "credit" | "debit";
  amount: string;            // 统一金额字段
  entryType: string;         // initial_credit / consumer_cost / supplier_reward / admin_adjust / ...
  note: string | null;
  createdAt: string;
  logicalModel: string | null;    // null for non-API entries
  provider: string | null;
  providerLabel: string | null;
  realModel: string | null;
  inputTokens: number | null;     // 新增：null for non-API entries
  outputTokens: number | null;
  totalTokens: number | null;
}
```

---

## 列渲染逻辑

| 列 | API 条目 (consumer_cost / supplier_reward) | 非 API 条目 (initial_credit / admin_adjust / referral_reward) |
|---|---|---|
| 色条 | 橙 (debit) / 绿 (credit) | 蓝色系（区分系统操作） |
| 时间 | `MM-DD HH:mm` | 同左 |
| 模型/来源 | `logicalModel` | i18n 类型标签（注册赠送 / 管理员调整 / 邀请奖励） |
| xtokens | `−amount` (debit) / `+amount` (credit) | 同左 |
| Tokens | `totalTokens` | `—` |
| Input | `inputTokens` | `—`（md 隐藏列） |
| Output | `outputTokens` | `—`（md 隐藏列） |
| Provider / 备注 | `providerLabel` 或 `formatProviderType` | `note`（admin_adjust 默认"平台调整"） |
| 行背景 | 橙底 (debit) / 绿底 (credit) | 淡蓝底 |

---

## 验证方案

| 场景 | 验证步骤 |
|------|----------|
| 混合数据显示 | 页面加载后，同一列表中可见 API 消费、供应收入、注册赠送、管理员调整等不同类型条目 |
| 日期筛选 | 点击热力图日期 → 列表仅显示该日条目（含非 API 条目） |
| 模型筛选 | 点击模型标签 → 仅显示该模型的 API 条目，非 API 条目被排除 |
| 分页 | 翻页正确，总数准确，边界条件（首页/末页）正常 |
| 热力图不变 | 热力图仍然只反映 API 使用量，不含非 API 条目 |
| 按模型视图不变 | 切换到按模型 → 数据与之前一致 |
| 空状态 | 无数据时显示空提示 |
| 构建通过 | TypeScript + Vite 编译 0 errors |
| 现有测试通过 | `npm run test:platform-api` 全通过 |

---

## 关键文件

| 文件 | 改动 |
|------|------|
| `apps/platform-api/src/services/ledger-service.ts` | getLedgerHistory 增加 token 字段 + date/model 过滤 |
| `apps/platform-api/src/routes/usage.ts` | GET /v1/ledger 传递 date/model 参数 |
| `apps/web/src/pages/app/OverviewPage.tsx` | 删除 ledger tab，改造按日期视图为 ledger 数据源 |
