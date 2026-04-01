# 统一 Token 活动记录系统 — 完整方案

## Context

当前 `ledger_entries` 仅记录 API 调用结算（`consumer_cost`/`supplier_reward`），以下 token 变动无明细：
- 注册赠送 1M token → 直接 INSERT wallet，无 ledger
- 管理员调整余额 → 直接 UPDATE wallet，无 ledger，无备注
- 邀请奖励、活动赠送等 → 尚无机制

**目标**：统一所有 token 变动记录，可追溯、可备注、可扩展。

---

## 一、架构设计：独立 LedgerService

### 核心原则
> **所有 wallet 余额变动必须经过 LedgerService → wallet UPDATE + ledger INSERT 在同一事务内原子执行**

### 模块划分

```
现有层                          新增层
─────────                      ─────────
routes/chat.ts ─┐
routes/admin.ts ─┤              ledger-service.ts  ← 新建
routes/auth.ts ──┤──→ 调用 ──→  (统一 token 变动入口)
routes/usage.ts ─┘                    │
                                      ↓
                              postgres-platform-repository.ts
                              (新增 recordLedgerEntry / getLedgerHistory 底层方法)
```

**`ledger-service.ts` 的职责**：
1. 封装「改余额 + 写流水」的原子事务
2. 提供语义化方法：`creditInitial()`, `recordSettlement()`, `adminAdjust()`, `creditReferral()`, `creditGeneric()`, `debitGeneric()`
3. 查询流水历史

**不动的部分**：
- 现有 `recordChatSettlement()` 内的 ledger INSERT 保持不动（它已在事务内，且性能敏感）
- 只在新增场景使用 LedgerService

### 无感升级策略

分 3 个阶段部署，每阶段独立可回滚：

| 阶段 | 内容 | 风险 | 回滚方式 |
|------|------|------|----------|
| Phase 1 | 数据库迁移：加列 + 放宽约束 | 零 — 仅 ADD COLUMN + DROP NOT NULL | 无需回滚，列为 nullable |
| Phase 2 | 后端：LedgerService + 各调用点改造 | 低 — 新代码写 ledger，不影响原有结算 | 回滚代码即可，多出的 ledger 行无害 |
| Phase 3 | 前端：资金流水页 + 管理员备注 | 零 — 纯新增 UI，不改原有页面 | 回滚前端即可 |

**存量数据处理**：已注册用户没有 `initial_credit` 记录。方案：**不补历史**，流水页从有记录开始展示，余额以 wallet 为准。若需补录，可后续写一次性脚本。

---

## 二、数据库迁移

**新文件**: `infra/sql/postgres/022_unified_ledger.sql`

```sql
-- Phase 1: 扩展 ledger_entries 支持非结算类条目
-- 零停机：仅加列 + 放宽 NOT NULL，不锁表不重写

-- 1. 允许 request_id 为 NULL（非结算条目无关联请求）
--    FK REFERENCES api_requests(id) 对 NULL 自动跳过，无需改约束
ALTER TABLE ledger_entries ALTER COLUMN request_id DROP NOT NULL;

-- 2. 备注字段（用户可见的说明文字）
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS note TEXT;

-- 3. 关联实体 ID（邀请ID、管理员用户ID 等）
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS related_id TEXT;

-- 4. 操作人 ID（谁触发了这次变动，系统操作为 'system'）
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS actor_id TEXT;

-- 5. 邀请奖励配置（默认 0 = 关闭，设为正数即开启）
INSERT INTO platform_config (key, value, description)
VALUES ('referral_reward_amount', '0', 'Token reward for inviter when invitee registers. 0 = disabled.')
ON CONFLICT (key) DO NOTHING;
```

**SQLite (`db.ts`) 同步改动** — CREATE TABLE 语句加上新列：
```sql
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT,              -- 改为 nullable
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  note TEXT,                    -- 新增
  related_id TEXT,              -- 新增
  actor_id TEXT,                -- 新增
  created_at TEXT NOT NULL
);
```

### entry_type 规范

| entry_type | direction | 触发场景 | note 默认值 | related_id | actor_id |
|---|---|---|---|---|---|
| `initial_credit` | credit | 用户注册 | `注册赠送` | NULL | `system` |
| `consumer_cost` | debit | API 调用消费 | NULL（前端 JOIN 显示模型名） | request_id | 消费者 userId |
| `supplier_reward` | credit | API 供应收入 | NULL（同上） | request_id | 供应者 userId |
| `admin_adjust` | credit/debit | 管理员调整 | 管理员输入 或 `管理员调整` | NULL | 管理员 userId |
| `referral_reward` | credit | 邀请人获得奖励 | `邀请 xxx@email 注册奖励` | invitation_id | `system` |
| `promo_credit` | credit | 活动/促销赠送 | 自定义 | 活动ID | 操作者 userId |
| `transfer_in` | credit | 未来：用户间转账 | 自定义 | 转账记录ID | 发起者 userId |
| `transfer_out` | debit | 未来：用户间转账 | 自定义 | 转账记录ID | 发起者 userId |

> 新增类型只需加代码，不需要改数据库。

---

## 三、后端改动

### 3.1 新建 `apps/platform-api/src/services/ledger-service.ts`

```typescript
// 统一 token 变动服务
// 核心方法：所有 wallet 变动必须经过此服务（除已有的 recordChatSettlement）

export const ledgerService = {

  // 注册赠送
  async creditInitial(params: {
    userId: string;
    amount: number;
    client: PoolClient;  // 复用外层事务
  }): Promise<void>;

  // 管理员调整
  async adminAdjust(params: {
    userId: string;
    amount: number;       // 正数=加，负数=减
    note?: string;
    actorUserId: string;
  }): Promise<void>;

  // 邀请奖励
  async creditReferral(params: {
    userId: string;
    amount: number;
    invitedEmail: string;
    invitationId: string;
    client: PoolClient;
  }): Promise<void>;

  // 通用：未来扩展用
  async recordEntry(params: {
    userId: string;
    direction: 'credit' | 'debit';
    amount: number;
    entryType: string;
    note?: string;
    relatedId?: string;
    actorId?: string;
    client?: PoolClient;  // 可选，传入则复用事务
  }): Promise<void>;

  // 查询流水
  async getLedgerHistory(params: {
    userId: string;
    limit?: number;
    offset?: number;
    entryType?: string;
  }): Promise<{ data: LedgerEntry[]; total: number }>;
};
```

**设计要点**：
- `creditInitial` 和 `creditReferral` 接收 `client` 参数 → 复用注册流程的事务，保证原子性
- `adminAdjust` 自己管理事务（当前 admin 操作无事务，这里修复）
- `recordEntry` 是通用底层方法，未来新类型直接调用

### 3.2 Repository 新增方法 (`postgres-platform-repository.ts`)

**`recordLedgerEntry`** — 底层 INSERT：
```typescript
async recordLedgerEntry(params: {
  userId: string;
  direction: 'credit' | 'debit';
  amount: number;
  entryType: string;
  requestId?: string | null;
  note?: string | null;
  relatedId?: string | null;
  actorId?: string | null;
  client?: PoolClient;      // 复用外部事务
}): Promise<void> {
  const executor = params.client ?? getPool();
  await executor.query(`
    INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type, note, related_id, actor_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [params.requestId ?? null, params.userId, params.direction, params.amount,
      params.entryType, params.note ?? null, params.relatedId ?? null, params.actorId ?? null]);
}
```

**`getLedgerHistory`** — 分页查询：
```sql
SELECT le.id, le.request_id AS "requestId", le.direction,
       le.amount::text AS "amount", le.entry_type AS "entryType",
       le.note, le.related_id AS "relatedId", le.actor_id AS "actorId",
       le.created_at::text AS "createdAt",
       ar.logical_model AS "logicalModel",
       ar.provider, ar.provider_label AS "providerLabel"
FROM ledger_entries le
LEFT JOIN api_requests ar ON ar.id = le.request_id
WHERE le.user_id = $1
  [AND le.entry_type = $N]  -- 可选筛选
ORDER BY le.created_at DESC
LIMIT $N OFFSET $N
```

### 3.3 修改注册流程 (`postgres-platform-repository.ts` ~line 723)

在 wallet INSERT 后、同一 `client` 事务内：
```typescript
// 原有代码 (line 719-723)
await client.query(`INSERT INTO wallets ...`, [userId, initialCredit]);

// ★ 新增：记录初始赠送流水
await ledgerService.creditInitial({ userId, amount: initialCredit, client });
```

### 3.4 修改邀请接受流程 (`postgres-platform-repository.ts` ~line 734)

在 `UPDATE invitations SET status = 'accepted'` 后、同一事务内：
```typescript
// ★ 新增：邀请奖励（受 platform_config 控制）
const rewardRow = await client.query(
  "SELECT value FROM platform_config WHERE key = 'referral_reward_amount' LIMIT 1"
);
const rewardAmount = Number(rewardRow.rows[0]?.value ?? 0);
if (rewardAmount > 0) {
  await client.query(
    "UPDATE wallets SET available_token_credit = available_token_credit + $2 WHERE user_id = $1",
    [invitation.rows[0].inviter_user_id, rewardAmount]
  );
  await ledgerService.creditReferral({
    userId: invitation.rows[0].inviter_user_id,
    amount: rewardAmount,
    invitedEmail: normalizedEmail,
    invitationId: invitation.rows[0].id,
    client,
  });
}
```

### 3.5 修改管理员调整 (`postgres-platform-repository.ts` ~line 2922-2938)

当前代码直接 UPDATE wallet 无事务无记录。改为调用 LedgerService：

```typescript
// 路由层 (admin.ts ~line 186):
const body = await read_json<{
  role?: string; status?: string;
  walletAdjust?: number;
  walletAdjustNote?: string;  // ★ 新增
}>(req);
const result = await platformService.updateAdminUser(userId, body, auth.userId);

// Service 层传递 actorUserId
// Repository 层：
if (updates.walletAdjust != null) {
  await ledgerService.adminAdjust({
    userId,
    amount: updates.walletAdjust,
    note: updates.walletAdjustNote,
    actorUserId,
  });
}
```

### 3.6 接口类型更新 (`platform-repository.ts` ~line 333)

```typescript
updateAdminUser(
  userId: string,
  updates: { role?: string; status?: string; walletAdjust?: number; walletAdjustNote?: string },
  actorUserId?: string
): MaybePromise<any>;

// 新增
recordLedgerEntry(params: { ... }): MaybePromise<void>;
getLedgerHistory(params: { ... }): MaybePromise<{ data: any[]; total: number }>;
```

### 3.7 新增路由 `GET /v1/ledger` (`routes/usage.ts`)

```typescript
if (req.method === "GET" && url.pathname === "/v1/ledger") {
  const auth = await authenticate_session_only_(req);
  if (!auth) { /* 401 */ return true; }
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const entryType = url.searchParams.get("type") ?? undefined;
  const result = await ledgerService.getLedgerHistory({
    userId: auth.userId, limit, offset, entryType
  });
  // 返回 { requestId, data: [...], total: number }
}
```

### 3.8 SQLite Repository (`db.ts`)

- `recordLedgerEntry`: 写入 SQLite ledger_entries（加新列）
- `getLedgerHistory`: 查询 SQLite ledger_entries

### 3.9 现有结算代码不动

`recordChatSettlement()` (~line 2478-2485) 的两条 ledger INSERT 保持原样：
- 它们已在事务内，性能敏感路径
- 新加的 `note`/`related_id`/`actor_id` 列是 nullable，默认 NULL
- 前端对 `consumer_cost`/`supplier_reward` 类型通过 LEFT JOIN `api_requests` 获取模型信息，不依赖 note

---

## 四、前端改动

### 4.1 用户 OverviewPage — 新增「资金流水」标签

**文件**: `apps/web/src/pages/app/OverviewPage.tsx`

在现有 `ViewMode = "requests" | "models"` 基础上增加 `"ledger"`：

```typescript
type ViewMode = "requests" | "models" | "ledger";
```

标签栏新增第三个按钮「资金流水」，点击后调用 `GET /v1/ledger?limit=50&offset=0`。

**流水表格列**：

| 列 | 来源 | 显示逻辑 |
|---|---|---|
| 时间 | `createdAt` | 格式化日期时间 |
| 类型 | `entryType` | 映射为中文标签（见 i18n） |
| 金额 | `direction` + `amount` | credit → 绿色 `+X`，debit → 橙色 `-X` |
| 备注 | `note` 或 JOIN 字段 | `consumer_cost`/`supplier_reward` → 显示 `logicalModel (providerLabel)`；其他 → 显示 `note` |

支持分页（底部翻页，每页 50 条）和 entryType 筛选。

### 4.2 管理员 UsersPage — 余额调整增加备注

**文件**: `apps/web/src/pages/admin/UsersPage.tsx`

**方案**：扩展 `ConfirmDialog` 支持多输入框。

**ConfirmDialog 改动** (`components/ui/ConfirmDialog.tsx`):

```typescript
// 现有 input 属性保持不变（向后兼容）
// 新增 inputs 属性支持多输入
interface ConfirmDialogProps {
  // ... 现有属性 ...
  input?: { label: string; placeholder?: string; type?: string };
  inputs?: Array<{ key: string; label: string; placeholder?: string; type?: string }>;
  // onConfirm 签名改为：
  onConfirm: (inputValue?: string, inputValues?: Record<string, string>) => void;
}
```

- 当 `inputs` 存在时，渲染多个 `FormInput`，提交时返回 `Record<string, string>`
- 当仅 `input` 存在时，行为不变（向后兼容）

**UsersPage 调整对话框改动**:

```typescript
const openAdjustBalanceDialog = (user: AdminUser) => {
  setConfirmDialog({
    // ... 现有配置 ...
    inputs: [
      { key: "amount", label: t("admin.users.adjustPrompt"), placeholder: "100000", type: "number" },
      { key: "note", label: t("admin.users.adjustNote"), placeholder: t("admin.users.adjustNotePlaceholder"), type: "text" },
    ],
  });
};

// handleConfirmAction 中：
if (actionType === "adjustBalance" && inputValues) {
  const amount = Number(inputValues.amount);
  const note = inputValues.note || undefined;
  if (!isNaN(amount)) {
    void handleAdjustBalance(userId, amount, note);
  }
}

// handleAdjustBalance 签名改为：
const handleAdjustBalance = async (id: string, amount: number, note?: string) => {
  await apiJson(`/v1/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ walletAdjust: amount, walletAdjustNote: note }),
  });
};
```

### 4.3 国际化 (`lib/i18n.ts`)

新增翻译 key：

**中文 (zh)**:
```
"ledger.title": "资金流水",
"ledger.type.initial_credit": "注册赠送",
"ledger.type.consumer_cost": "API 消费",
"ledger.type.supplier_reward": "供应收入",
"ledger.type.admin_adjust": "管理员调整",
"ledger.type.referral_reward": "邀请奖励",
"ledger.type.promo_credit": "活动赠送",
"ledger.note": "备注",
"ledger.filter.all": "全部",
"admin.users.adjustNote": "备注（可选）",
"admin.users.adjustNotePlaceholder": "调整原因",
```

**英文 (en)**:
```
"ledger.title": "Token Activity",
"ledger.type.initial_credit": "Signup Bonus",
"ledger.type.consumer_cost": "API Usage",
"ledger.type.supplier_reward": "Supply Income",
"ledger.type.admin_adjust": "Admin Adjustment",
"ledger.type.referral_reward": "Referral Reward",
"ledger.type.promo_credit": "Promotion",
"ledger.note": "Note",
"ledger.filter.all": "All",
"admin.users.adjustNote": "Note (optional)",
"admin.users.adjustNotePlaceholder": "Reason for adjustment",
```

---

## 五、扩展性设计

### 新增 token 活动类型的步骤（以「邀请一个人注册获 1M token」为例）

1. `platform_config` 中设置 `referral_reward_amount = 1000000`（管理员面板可改）
2. 代码中在邀请接受处调用 `ledgerService.creditReferral(...)` — **Phase 2 已包含**
3. 无需数据库迁移、无需前端改动

### 未来可能的 token 活动

| 场景 | 使用方式 |
|------|----------|
| 活动赠送 | 管理员批量调用 `ledgerService.recordEntry({ entryType: 'promo_credit', ... })` |
| 过期扣除 | 定时任务调用 `ledgerService.recordEntry({ entryType: 'expiry_debit', direction: 'debit', ... })` |
| 用户间转账 | 新路由调用 `ledgerService.recordEntry` 两次（转出 + 转入），同一事务 |
| 退款 | 管理员或系统调用 `ledgerService.recordEntry({ entryType: 'refund', ... })` |

所有新场景只需：
1. 定义新 `entryType` 字符串常量
2. 调用 `ledgerService.recordEntry()`
3. 前端 i18n 加对应翻译

---

## 六、实施顺序

### Phase 1 — 数据库（可独立部署）
1. `infra/sql/postgres/022_unified_ledger.sql`
2. `apps/platform-api/src/db.ts` SQLite schema 同步

### Phase 2 — 后端
1. 新建 `apps/platform-api/src/services/ledger-service.ts`
2. `postgres-platform-repository.ts` 新增 `recordLedgerEntry` + `getLedgerHistory`
3. `platform-repository.ts` 接口类型更新
4. 修改注册流程 → 写 `initial_credit` 流水
5. 修改管理员调整 → 写 `admin_adjust` 流水 + 支持备注
6. 新增邀请奖励逻辑 → 写 `referral_reward` 流水（受配置开关控制）
7. `routes/usage.ts` 新增 `GET /v1/ledger`
8. `routes/admin.ts` PATCH body 新增 `walletAdjustNote`
9. `platform-service.ts` 透传

### Phase 3 — 前端
1. `ConfirmDialog.tsx` 扩展 `inputs` 多输入支持
2. `UsersPage.tsx` 管理员调整增加备注输入
3. `OverviewPage.tsx` 新增「资金流水」标签页
4. `i18n.ts` 新增翻译

---

## 七、验证方案

| 场景 | 验证步骤 |
|------|----------|
| 注册赠送 | 新用户注册 → `GET /v1/ledger` 应有 `initial_credit` 条目 |
| API 消费 | 调用 API → `GET /v1/ledger` 应有 `consumer_cost` 条目（含模型信息） |
| 供应收入 | 他人调用你的 offering → `GET /v1/ledger` 应有 `supplier_reward` 条目 |
| 管理员调整 | 管理员调整余额（带备注） → `GET /v1/ledger` 应有 `admin_adjust` 条目 |
| 邀请奖励 | 设置 `referral_reward_amount=1000000` → 被邀请人注册 → 邀请人流水应有 `referral_reward` |
| 向后兼容 | 现有结算流程不受影响，API 调用性能无回退 |
| 存量数据 | 老用户流水页正常显示（只是没有 initial_credit 历史记录） |

---

## 八、关键文件清单

| 文件 | 操作 | 改动 |
|------|------|------|
| `infra/sql/postgres/022_unified_ledger.sql` | 新建 | 迁移 |
| `apps/platform-api/src/services/ledger-service.ts` | 新建 | LedgerService |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | 修改 | 注册流水、管理员流水、邀请奖励、新方法 |
| `apps/platform-api/src/repositories/platform-repository.ts` | 修改 | 接口类型 |
| `apps/platform-api/src/services/platform-service.ts` | 修改 | 透传 + actorUserId |
| `apps/platform-api/src/routes/usage.ts` | 修改 | GET /v1/ledger |
| `apps/platform-api/src/routes/admin.ts` | 修改 | PATCH walletAdjustNote |
| `apps/platform-api/src/db.ts` | 修改 | SQLite schema + stub |
| `apps/web/src/components/ui/ConfirmDialog.tsx` | 修改 | 多输入支持 |
| `apps/web/src/pages/app/OverviewPage.tsx` | 修改 | 资金流水标签 |
| `apps/web/src/pages/admin/UsersPage.tsx` | 修改 | 备注输入 |
| `apps/web/src/lib/i18n.ts` | 修改 | 新翻译 key |
| `apps/platform-api/src/tests/unified-ledger.test.ts` | 新建 | 11 个测试用例 |

---

## 九、本地模拟测试结果 (2026-04-01)

### 单元测试

| 测试套件 | 结果 | 备注 |
|----------|------|------|
| unified-ledger.test.ts (×3 稳定性) | 11/11 pass ×3 | 全部通过，3 轮稳定 |
| settlement-balance-guard.test.ts | 6/6 pass | 向后兼容，无回退 |
| 全量 test:platform-api (155 tests) | 155/155 pass | 全部通过 |
| npm run build | 0 errors | TypeScript 编译 + Vite 打包 |

### API 模拟测试

| # | 测试项 | 方法 | 结果 |
|---|--------|------|------|
| 1 | 无认证访问 /v1/ledger | GET 无 Header | 401 ✅ |
| 2 | 已认证获取流水 | GET Bearer sess_* | 200，返回 50 条数据，total=94 ✅ |
| 3 | 分页功能 | ?limit=5&offset=0 | data=5 条，total=94 ✅ |
| 4 | 类型过滤 | ?type=consumer_cost&limit=3 | 仅 consumer_cost，total=62 ✅ |
| 5 | 管理员加余额+备注 | PATCH walletAdjust=100000 | 余额+100000，ledger: credit admin_adjust "模拟测试: 管理员补充额度" ✅ |
| 6 | 管理员扣余额无备注 | PATCH walletAdjust=-50000 | 余额-50000，ledger: debit admin_adjust "管理员调整"（默认备注） ✅ |
| 7 | 用户视角查流水 | ?type=admin_adjust | 显示 2 条 admin_adjust 记录 ✅ |
| 8 | initial_credit 可见 | 手动插入+查询 | 注册赠送记录正常显示 ✅ |

### 向后兼容验证

- 现有 consumer_cost/supplier_reward 条目：note/related_id/actor_id 为 NULL，正常显示 ✅
- 现有结算代码未改动，ledger INSERT 自动兼容新列 ✅
- LEFT JOIN api_requests 正确显示模型名称 ✅
