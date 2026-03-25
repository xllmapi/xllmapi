# xllmapi 邀请邮箱注册 / 邮箱安全机制 / 上线缺失项设计方案

## 摘要

当前仓库里的认证模型是：

1. **产品策略上是邀请制**。
2. **域模型上已经有“被邀请邮箱 -> 请求验证码 -> 校验验证码 -> 创建账户”闭环**。
3. **真正的事务邮件能力没有实现**，所以生产环境里这条链实际上不能给真实用户用。
4. **密码修改、邮箱修改、密码找回** 目前只完成了最基础的一部分，离生产安全标准还有明显缺口。

本方案按已确认的默认决策收敛：

1. **注册策略保持仅邀请制**。
2. **邮件能力采用 provider 抽象层，首发默认 Resend**。
3. **不做独立邮件服务，继续用当前 Node 单体实现**。
4. **把邮件认证与账户安全视为本次上线前必须补齐的功能，不是后续优化项**。

## 一、当前真实状态复核

## 1. 已有能力

### 邀请制注册链路已存在

当前已有：

1. `POST /v1/auth/request-code`
2. `POST /v1/auth/verify-code`
3. `POST /v1/auth/login`

实际行为：

1. 如果邮箱已存在账户，允许请求登录验证码。
2. 如果邮箱没有账户，但有有效邀请，也允许请求登录验证码。
3. 校验验证码成功后，如果该邮箱还没有用户，则自动创建用户、身份、钱包、初始 API key，并把邀请标记为已接受。

这部分实现已经落在：

1. `apps/platform-api/src/routes/auth.ts`
2. `apps/platform-api/src/services/platform-service.ts`
3. `apps/platform-api/src/repositories/postgres-platform-repository.ts`
4. `apps/platform-api/src/db.ts`

### 站内通知和审计基础设施已存在

当前仓库里已经有：

1. `notifications`
2. `notification_reads`
3. `audit_logs`

这意味着后续“安全事件提醒”和“敏感操作审计”可以直接接到现有能力上，不需要从零做。

## 2. 当前缺失和风险

## A. 真实发邮件功能未实现

当前 `requestLoginCode` 只是：

1. 生成 6 位码
2. 写入 `login_codes`
3. 开发环境把 `devCode` 返回前端

**没有任何 SMTP / Resend / SES / SendGrid 调用。**

结论：

1. 生产环境用户拿不到验证码。
2. 邀请制注册在生产实际上不可用。
3. 这属于明确的上线阻断项。

## B. 邀请邮件本身未实现

当前创建邀请只是写 `invitations` 表。
没有：

1. 邀请邮件发送
2. 邀请链接
3. 邀请过期提醒
4. 邀请撤销通知

结论：

1. 运营可以“创建邀请记录”，但不能真正把邀请送达给用户。
2. 这也是上线阻断项。

## C. 邮箱修改机制不安全

当前 `PATCH /v1/me/security/email` 会：

1. 直接把邮箱改成新邮箱
2. 直接把 `email_verified = TRUE`

没有：

1. 新邮箱所有权验证
2. 旧邮箱通知
3. 二次确认
4. 敏感操作审计强化
5. 风险会话失效

结论：

1. 这不符合生产安全标准。
2. 必须重做为“请求变更 + 邮箱确认 + 生效”。

## D. 找回密码功能完全缺失

当前只有：

1. 已登录状态下的 `PATCH /v1/me/security/password`

没有：

1. 忘记密码申请
2. 邮件找回链接/验证码
3. reset token
4. reset 完成后的 session 清理
5. 安全通知

结论：

1. 真实用户只要忘记密码，就无法自助恢复账户。
2. 这是公开上线前应具备的基础能力。

## E. 密码修改缺少安全通知

当前改密码只要求当前密码正确。
没有：

1. 给邮箱发“密码已修改”通知
2. 选择性登出其他会话
3. 风险登录告警

结论：

1. 功能层面能用，但不具备完整的生产安全闭环。

## F. 认证邮件的可观测性完全缺失

当前没有：

1. 邮件发送日志
2. 送达/失败状态
3. retry
4. provider webhook 处理
5. bounce / complaint 状态
6. 邮件模板版本管理

结论：

1. 上线后出了问题无法追踪。
2. 会直接影响注册、登录、密码找回可用性。

## 二、目标产品模型

## 1. 注册策略

保持 **仅邀请制**。

目标规则：

1. 未被邀请邮箱不能注册。
2. 已存在账户邮箱可以请求登录验证码。
3. 已被邀请但尚未注册的邮箱可以请求“注册验证码”。
4. 邀请链接只用于引导，不直接完成注册。
5. 真正完成注册仍以邮箱验证码校验或邮箱链接确认作为凭证。

### 为什么继续仅邀请制

1. 这是当前仓库已实现的真实产品模型。
2. 风控压力更低。
3. 首发更可控。
4. 不需要同时引入公开注册反滥用体系。

## 2. 邮件能力目标

邮件分成 5 类事务邮件：

1. **邀请邮件**
2. **登录验证码邮件**
3. **密码找回邮件**
4. **邮箱变更确认邮件**
5. **安全通知邮件**
   - 密码已修改
   - 邮箱已变更
   - 新设备/新会话登录（可选）

首发建议实现前 4 类为必需，第 5 类至少实现密码/邮箱变更通知。

## 三、目标架构设计

## 1. 组件设计

在当前 `platform-api` 单体内新增以下模块：

1. `email-sender`
   - 统一邮件发送接口
   - 默认 `ResendEmailSender`
2. `email-template-renderer`
   - 渲染事务邮件模板
3. `auth-challenge-service`
   - 管理邮箱验证码 / reset token / email change token
4. `security-event-service`
   - 记录安全事件并触发站内通知/邮件通知
5. `email-delivery-repository`
   - 记录邮件投递状态

### 默认不拆独立服务

理由：

1. 当前体量没有必要。
2. 单体内更容易保持事务一致性和调试效率。
3. 先把能力做稳，再考虑拆分。

## 2. 数据模型设计

## 新增表 1：`auth_email_challenges`

用途：统一管理所有邮箱挑战，而不是只靠现在的 `login_codes`.

字段建议：

1. `id`
2. `email`
3. `purpose`
   - `login_code`
   - `invite_signup_code`
   - `password_reset`
   - `email_change_verify_new`
4. `code_hash`
5. `token_hash`
6. `user_id` nullable
7. `target_email` nullable
8. `invitation_id` nullable
9. `expires_at`
10. `consumed_at`
11. `invalidated_at`
12. `send_count`
13. `last_sent_at`
14. `metadata` jsonb
15. `created_at`

### 设计原则

1. 同一用途统一挑战模型。
2. 支持“验证码”和“链接 token”两种形态。
3. 所有明文 code/token 只在生成时短暂存在，不入库明文。

## 新增表 2：`email_delivery_attempts`

用途：可观测性和排障。

字段建议：

1. `id`
2. `provider`
3. `template_key`
4. `to_email`
5. `subject`
6. `challenge_id` nullable
7. `status`
   - `queued`
   - `sent`
   - `failed`
   - `delivered`
   - `bounced`
   - `complained`
8. `provider_message_id`
9. `error_code`
10. `error_message`
11. `payload` jsonb
12. `created_at`
13. `updated_at`

## 新增表 3：`email_change_requests`

用途：安全地执行邮箱修改。

字段建议：

1. `id`
2. `user_id`
3. `old_email`
4. `new_email`
5. `challenge_id`
6. `status`
   - `pending`
   - `verified`
   - `cancelled`
   - `expired`
7. `requested_ip`
8. `requested_user_agent`
9. `expires_at`
10. `verified_at`
11. `created_at`

## 新增表 4：`security_events`

用途：敏感账户事件审计和用户通知。

字段建议：

1. `id`
2. `user_id`
3. `type`
   - `password_changed`
   - `password_reset_requested`
   - `password_reset_completed`
   - `email_change_requested`
   - `email_changed`
   - `login_code_requested`
   - `new_session_created`
4. `severity`
   - `info`
   - `warning`
   - `critical`
5. `ip_hash`
6. `user_agent`
7. `payload`
8. `created_at`

### 与现有 `audit_logs` 的关系

1. `audit_logs` 继续保留后台运营/管理动作。
2. `security_events` 专门给账户安全流程用。
3. 管理员查看安全事件时可以聚合展示。

## 四、公共接口 / API 设计

## 1. 保留但重构的接口

### `POST /v1/auth/request-code`

用途：

1. 已注册邮箱登录验证码
2. 已邀请邮箱首次注册验证码

请求：

```json
{
  "email": "user@example.com"
}
```

响应：

```json
{
  "requestId": "...",
  "data": {
    "ok": true,
    "channel": "email",
    "maskedEmail": "u***@example.com",
    "cooldownSeconds": 60
  }
}
```

行为：

1. 生产不再返回 `devCode`
2. 仅开发环境可返回 `devCode`
3. 真正调用邮件发送
4. 若邮箱未被邀请且无账户，仍返回统一响应，不泄露账户存在性
5. 内部通过业务判定决定是否真正发信

### `POST /v1/auth/verify-code`

保持现有职责，但语义更清晰：

1. 已注册邮箱：登录
2. 邀请邮箱：完成注册并登录

响应保持兼容，但新增：

1. `authMethod: "email_code"`
2. `isNewUser: boolean`

## 2. 新增接口

### `POST /v1/auth/request-password-reset`

请求：

```json
{
  "email": "user@example.com"
}
```

响应统一：

```json
{
  "requestId": "...",
  "data": {
    "ok": true
  }
}
```

行为：

1. 存在账户则发送找回密码邮件
2. 不存在账户也返回统一成功，避免枚举
3. 邀请未注册邮箱不能走此流程

### `POST /v1/auth/reset-password`

请求：

```json
{
  "token": "....",
  "newPassword": "..."
}
```

响应：

```json
{
  "requestId": "...",
  "data": {
    "ok": true,
    "sessionsRevoked": 5
  }
}
```

行为：

1. 校验 reset token
2. 修改密码
3. 失效除当前重置流程外的所有 active session
4. 发送密码重置成功通知邮件

### `POST /v1/me/security/email/request-change`

请求：

```json
{
  "newEmail": "new@example.com",
  "currentPassword": "optional"
}
```

默认要求：

1. 若用户设置了密码，则必须验证当前密码
2. 若当前登录是邮箱验证码登录且无密码，可改为再次验证邮箱 code 或当前 session 风险校验

响应：

```json
{
  "requestId": "...",
  "data": {
    "ok": true,
    "maskedEmail": "n***@example.com"
  }
}
```

行为：

1. 创建 `email_change_request`
2. 给新邮箱发送确认邮件
3. 给旧邮箱发送“变更请求通知”

### `POST /v1/me/security/email/confirm-change`

请求：

```json
{
  "token": "..."
}
```

行为：

1. 验证新邮箱 token
2. 执行邮箱变更
3. `email_verified = TRUE`
4. 旧 session 按策略部分或全部失效
5. 给旧邮箱和新邮箱都发“邮箱已变更”通知

## 3. 不建议继续保留的旧接口语义

### `PATCH /v1/me/security/email`

当前“直接改邮箱”的语义不应保留。

调整方案：

1. 首次发布保留接口，但改为内部调用 `request-change`
2. 返回 `202 accepted` 风格响应
3. 第二阶段再把前端改成显式两步流程
4. 最终再废弃“立即修改邮箱”的老语义

这样可以兼容当前前端，不做一次性破坏性切换。

## 五、具体业务流程设计

## 1. 邀请注册流程

### 目标流程

1. 邀请人创建邀请
2. 系统发送邀请邮件
3. 被邀请用户点击链接进入登录/注册页，带上 `invitationHint`
4. 用户输入被邀请邮箱
5. 请求验证码
6. 系统发送注册验证码邮件
7. 用户输入验证码
8. 系统完成：
   - 邀请校验
   - 创建用户
   - 创建 wallet
   - 创建 API key
   - 创建 session
   - 标记邀请 accepted
9. 发送“欢迎 / 注册成功”邮件

### 重要规则

1. 邀请链接不是最终凭证，邮箱验证码才是最终凭证。
2. 邀请链接过期不应允许完成注册。
3. 同一邮箱多个邀请，按最新有效邀请处理，其他标记失效或保留为 superseded。
4. 已注册邮箱再收到邀请时，不创建新账户，只作为普通登录邮箱处理。

## 2. 邮箱验证码登录流程

### 目标流程

1. 用户输入邮箱
2. 系统判断：
   - 已有账户 -> 允许发送登录码
   - 邀请待注册 -> 允许发送注册码
   - 其他 -> 返回统一成功但不实际发信
3. 用户收到验证码
4. 验证码通过后创建 session
5. 可选发送新会话提醒

### 安全要求

1. 验证码 6 位或 8 位，TTL 10 分钟
2. 同一 challenge 最多验证 5 次
3. 同一邮箱/同一 IP 请求频率限制
4. 每个邮箱同一时段仅一个 active challenge
5. 新 challenge 生成时旧 challenge 自动失效

## 3. 修改密码流程

### 已登录改密码

1. 输入当前密码 + 新密码
2. 校验当前密码
3. 修改密码 hash
4. 记录 `security_event`
5. 给账户主邮箱发“密码已修改”通知
6. 默认策略：保留当前 session，失效其他 session

### 为什么这样定

1. 用户当前会话通常是可信操作来源
2. 失效其他 session 可以减少账号被盗后持续停留风险

## 4. 忘记密码流程

### 目标流程

1. 用户点击“忘记密码”
2. 提交邮箱
3. 系统发 reset mail
4. 用户点击邮件中的 reset link
5. 进入前端 reset 页面
6. 设置新密码
7. 系统更新密码并失效其他 session
8. 发成功通知邮件

### token 规则

1. 使用高熵随机 token，不用 6 位码
2. TTL 30 分钟
3. 单次使用
4. 一旦成功重置，其他未消费 reset token 一并失效

## 5. 修改邮箱流程

### 目标流程

1. 用户在已登录状态提交新邮箱
2. 系统做唯一性检查
3. 创建 `email_change_request`
4. 给新邮箱发确认邮件
5. 给旧邮箱发提醒邮件
6. 用户点击新邮箱确认链接
7. 系统更新邮箱
8. 给新旧邮箱都发“变更完成”通知
9. 默认失效所有其他 session，当前 session 可保留或要求重新登录

### 默认策略

建议：

1. **除当前会话外，全部失效**
2. 高风险情况下可全部失效，包括当前会话

## 六、邮件发送与模板设计

## 1. Provider 抽象

新增接口：

```ts
type SendTransactionalEmailParams = {
  templateKey:
    | "invite"
    | "login_code"
    | "password_reset"
    | "email_change_confirm"
    | "password_changed_notice"
    | "email_changed_notice";
  toEmail: string;
  locale?: "zh" | "en";
  subject: string;
  variables: Record<string, unknown>;
  idempotencyKey?: string;
};
```

默认实现：

1. `ResendEmailSender`

保留扩展点：

1. `SesEmailSender`
2. `SmtpEmailSender`

## 2. 邮件模板

首发必须支持中英文双语模板：

1. 邀请邮件
2. 登录验证码
3. 找回密码
4. 邮箱变更确认
5. 密码变更通知
6. 邮箱变更完成通知

模板变量至少包括：

1. `productName`
2. `supportEmail`
3. `actionUrl`
4. `code`
5. `expiresInMinutes`
6. `inviterName`
7. `invitationNote`

## 3. 邮件可观测性

每次发送必须记录：

1. provider
2. templateKey
3. toEmail
4. providerMessageId
5. result status
6. error code/message
7. related challenge/request id

并暴露 admin 查询接口。

## 七、风控与安全规则

## 1. 防枚举

以下接口都必须统一返回：

1. `request-code`
2. `request-password-reset`

无论邮箱是否存在，都返回泛化成功响应。
真实是否发信只在服务端决定。

## 2. 频控

必须按以下维度限流：

1. 按 IP
2. 按邮箱
3. 按邮箱 + 操作类型
4. 按 session/userId（已登录敏感操作）

### 默认阈值

1. `request-code`: 每邮箱 1 分钟 1 次，10 分钟 5 次
2. `verify-code`: 每 challenge 最多 5 次
3. `request-password-reset`: 每邮箱 15 分钟 3 次
4. `request-email-change`: 每用户 1 小时 3 次

## 3. TTL 默认值

1. 登录验证码：10 分钟
2. 邀请注册验证码：10 分钟
3. 密码重置 token：30 分钟
4. 邮箱变更确认 token：30 分钟

## 4. Session 失效策略

### 改密码成功后

1. 失效所有其他 session
2. 当前 session 保留

### 重置密码成功后

1. 失效全部 session
2. 用户重新登录

### 改邮箱成功后

1. 失效所有其他 session
2. 当前 session 视实现选择保留或要求重登
3. 默认建议保留当前 session 但刷新身份信息

## 八、与现有仓库的兼容落地方案

## 阶段 1：补邮件基础设施

### 新增

1. `EmailSender` 抽象
2. `ResendEmailSender`
3. `auth_email_challenges`
4. `email_delivery_attempts`
5. 基础模板系统

### 兼容策略

1. `login_codes` 先保留一轮发布
2. 新逻辑优先写 `auth_email_challenges`
3. 旧 `request-code/verify-code` 对外路径不改

## 阶段 2：把邀请注册和验证码登录切到真实邮件

1. `request-code` 真正发送邮件
2. `createInvitation` 后发送邀请邮件
3. 前端不再依赖 `devCode`
4. 生产环境完全关闭 `devCode` 语义

## 阶段 3：补找回密码

1. 新增 `request-password-reset`
2. 新增 `reset-password`
3. 前端增加 forgot/reset 页面
4. 增加成功后的 session 失效与通知

## 阶段 4：重做邮箱变更

1. 把 `PATCH /v1/me/security/email` 改为异步确认语义
2. 新增 request/confirm 两步接口
3. 旧邮箱和新邮箱都收到通知

## 阶段 5：补安全观测和后台运营可见性

1. admin 查看邮件投递记录
2. admin 查看安全事件
3. Prometheus 指标
4. 告警规则

## 九、需要新增的前端页面和交互

## 1. AuthPage

新增：

1. “重新发送验证码”
2. “没有收到邮件？”
3. “忘记密码？”

保留：

1. 邀请邮箱验证码注册
2. 密码登录

## 2. Reset Password 页面

新增：

1. `/reset-password?token=...`

功能：

1. 输入新密码
2. 提交成功后跳登录页
3. 明确提示其他会话已失效

## 3. Security 页面

邮箱变更改为两步：

1. 输入新邮箱
2. 提示“请去新邮箱确认”
3. 明确提示旧邮箱会收到通知

## 4. Admin 页面

新增或扩展：

1. 邮件投递列表
2. 失败投递重试
3. 安全事件列表
4. 邀请投递状态可见

## 十、测试方案

## 1. 单元测试

必须新增：

1. challenge 创建与失效
2. token/hash 校验
3. resend cooldown
4. email template 渲染
5. session revoke 策略
6. reset token 单次使用
7. email change request 状态机

## 2. 集成测试

必须新增：

1. 被邀请邮箱请求验证码 -> 成功发起 challenge
2. 已注册邮箱请求验证码 -> 成功发起 challenge
3. 未邀请邮箱请求验证码 -> 外部返回成功但不发信
4. 邀请邮箱 verify-code -> 创建账户
5. 已注册邮箱 verify-code -> 登录成功
6. request-password-reset -> 泛化响应
7. reset-password -> 更新密码 + 失效 session
8. request-email-change -> 创建 request + 发双邮件
9. confirm-email-change -> 完成变更
10. password changed -> 发安全通知
11. rate limit -> 429
12. challenge 超时 -> 失败
13. challenge 重放 -> 失败

## 3. E2E 测试

必须补这些：

1. 邀请用户收到 invite mail -> 请求 code -> 注册成功
2. 老用户通过邮箱 code 登录
3. 用户忘记密码 -> 邮件 reset -> 新密码登录成功
4. 用户修改邮箱 -> 新邮箱确认 -> 旧邮箱收到通知
5. 用户修改密码 -> 收到通知 -> 旧密码失效
6. Resend mock provider 失败时，admin 可见失败记录

## 4. 模拟邮件测试方式

默认：

1. provider mock server
2. 集成测试中断言 `email_delivery_attempts`
3. E2E 中断言模板 payload 和 token/code 链路

## 十一、上线前还缺的同类关键功能

基于当前仓库复核，除了“发邮件验证码”之外，还存在这些同类上线缺失项：

## P0 必补

1. **邀请邮件发送未实现**
2. **密码找回邮件链未实现**
3. **邮箱变更确认链未实现**
4. **邮箱变更当前是直接生效，不安全**
5. **认证/安全邮件可观测性未实现**
6. **生产环境没有事务邮件 provider 配置项**
7. **前端没有 forgot password / reset password 页面**
8. **没有安全通知邮件**
9. **没有认证邮件失败告警**

## P1 建议首发补

1. 新会话登录提醒
2. 邮件投递后台列表
3. bounce / complaint webhook
4. 邮箱模板管理与多语言模板版本化
5. 安全事件后台页面

## 十二、配置与环境变量

新增配置建议：

1. `XLLMAPI_EMAIL_PROVIDER=resend`
2. `XLLMAPI_EMAIL_FROM`
3. `XLLMAPI_EMAIL_REPLY_TO`
4. `XLLMAPI_RESEND_API_KEY`
5. `XLLMAPI_EMAIL_TEMPLATE_LOCALE_DEFAULT=en`
6. `XLLMAPI_AUTH_CODE_TTL_SECONDS=600`
7. `XLLMAPI_PASSWORD_RESET_TTL_SECONDS=1800`
8. `XLLMAPI_EMAIL_CHANGE_TTL_SECONDS=1800`
9. `XLLMAPI_EMAIL_SEND_COOLDOWN_SECONDS=60`
10. `XLLMAPI_SECURITY_NOTIFY_EMAIL_ENABLED=1`

生产启动要求：

1. 若 `isProduction` 且启用了邮箱验证码认证，则必须配置邮件 provider
2. 未配置时启动失败，而不是静默降级

## 十三、告警与监控

新增指标：

1. `xllmapi_email_send_total{template,status}`
2. `xllmapi_email_send_failures_total{template,provider}`
3. `xllmapi_auth_email_challenges_open{purpose}`
4. `xllmapi_auth_email_challenges_consumed_total{purpose}`
5. `xllmapi_password_reset_requests_total`
6. `xllmapi_email_change_requests_total`
7. `xllmapi_security_events_total{type}`

告警建议：

1. 登录验证码发送失败率高
2. 密码找回邮件发送失败率高
3. 邮箱变更确认邮件发送失败率高
4. 邮件 provider webhook 长时间无上报
5. 某邮箱短时间大量请求 challenge
6. 某 IP 短时间大量请求 auth mail

## 十四、明确默认决策

本方案已固定以下默认值：

1. 注册策略：**仅邀请制**
2. 邮件提供方：**provider 抽象 + Resend 默认实现**
3. 架构：**单体内实现，不拆新服务**
4. 认证方式：**保留现有邮箱验证码登录 + 密码登录双通道**
5. 修改密码：**已登录改密码后失效其他 session**
6. 找回密码：**重置成功后失效全部 session**
7. 修改邮箱：**必须两步确认，不允许直接改并自动 verified**
8. 邮件失败：**必须可见、可记录、可告警**

## 十五、最终判断

如果以“被邀请邮箱可以真实完成注册、用户可以靠邮箱安全地登录/找回/改邮箱/改密码”为上线标准，当前项目**还不满足**。

最核心的原因不是业务模型没有，而是：

1. **邮件投递没有实现**
2. **邮箱所有权验证没有实现**
3. **忘记密码没有实现**
4. **邮箱变更安全机制不达标**
5. **同类安全与可观测能力没有闭环**

所以这部分不应视为“后续优化”，而应列为**当前上线前必须补齐的认证生产化专项**。
