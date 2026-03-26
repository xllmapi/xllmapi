# 三项功能设计方案

## 1. 找回密码优化

### 现状
找回密码流程已完整实现（ForgotPasswordPage → 发邮件 → ResetPasswordPage）。但当前行为是不管邮箱存不存在都显示"如果该邮箱存在账户，重置链接已发送"。

### 改动

**后端** `apps/platform-api/src/routes/auth.ts` — `POST /v1/auth/request-password-reset`
- 邮箱不存在 → 返回 `{ ok: false, code: "not_found", message: "该邮箱未注册" }`
- 邮箱存在 → 返回 `{ ok: true, maskedEmail: "s***@163.com", cooldownSeconds: 60 }`
- 加 60s 冷却限制（复用 `enforceAuthRateLimit`）

**前端** `apps/web/src/pages/ForgotPasswordPage.tsx`
- 邮箱不存在 → 显示错误"该邮箱未注册"
- 邮箱存在 → 显示"重置链接已发送至 s***@163.com"
- 重发按钮 60s 倒计时（和登录验证码一样）

### 文件
- `apps/platform-api/src/routes/auth.ts`
- `apps/web/src/pages/ForgotPasswordPage.tsx`

---

## 2. 平台通知条（全站公告）

### 现状
已有 notification 系统（DB + API + admin UI），但只是个人通知（inbox 模式）。缺少全站公告横幅。

### 设计

**数据模型** — 复用 `platform_config` 表
```
key: "site_banner_enabled"     → "true" / "false"
key: "site_banner_content"     → "平台将于 3/28 进行维护升级"
key: "site_banner_type"        → "info" / "warning" / "error"
key: "site_banner_updated_at"  → ISO timestamp
key: "site_banner_updated_by"  → admin user id
```

不新建表，用 `platform_config` 存 banner 配置。变更记录用 `audit_logs`。

**后端**
- `GET /v1/site-banner` — 公开接口，无需认证，返回当前 banner 状态
- Admin 通过现有 `PUT /v1/admin/config` 修改 banner 配置
- 修改 banner 时自动写 `audit_logs`

**前端**
- `apps/web/src/components/layout/SiteBanner.tsx` — **新建**
  - 在 Header 下方渲染
  - 用户可点 X 关闭（sessionStorage 记住关闭状态，刷新后重现）
  - 3 种样式：info（蓝）、warning（黄）、error（红）
- `apps/web/src/App.tsx` — 在 Header 下方插入 SiteBanner
- 管理页面：**新建** `apps/web/src/pages/admin/AdminBannerPage.tsx`
  - 开关 toggle
  - 内容输入框
  - 类型选择（info/warning/error）
  - 预览
  - 变更记录（从 audit_logs 读取 banner 相关操作）

**路由注册**
- `AdminLayout.tsx` 加 sidebar 链接
- `App.tsx` 加 route

### 文件
- `apps/platform-api/src/routes/auth.ts` 或 `public.ts` — 新增 `GET /v1/site-banner`
- `apps/web/src/components/layout/SiteBanner.tsx` — **新建**
- `apps/web/src/pages/admin/AdminBannerPage.tsx` — **新建**
- `apps/web/src/App.tsx` — 插入 SiteBanner + route
- `apps/web/src/components/layout/AdminLayout.tsx` — 加链接
- `apps/web/src/lib/i18n.ts` — 新增文本

---

## 3. 配置文件支持

### 现状
所有配置通过环境变量。30+ 个环境变量在生产环境管理困难。

### 设计

**配置文件格式** — JSON
```
.platform.xllmapi.json
```

**加载优先级**（高 → 低）：
1. 环境变量（始终最高优先级，用于 Docker / CI 覆盖）
2. `--config <path>` 命令行参数指定的文件
3. 当前目录的 `.platform.xllmapi.json`
4. `$HOME/.config/xllmapi/.platform.xllmapi.json`
5. 代码默认值

**配置文件结构**：
```json
{
  "env": "production",
  "secretKey": "your-secret-key",
  "database": {
    "driver": "postgres",
    "url": "postgresql://..."
  },
  "redis": {
    "url": "redis://..."
  },
  "cors": {
    "origins": ["https://xllmapi.com"]
  },
  "email": {
    "provider": "resend",
    "from": "noreply@xllmapi.com",
    "resendApiKey": "re_xxx"
  },
  "auth": {
    "requestCodeLimitPerMinute": 5,
    "sessionMaxAgeSeconds": 2592000
  },
  "releaseId": "v1.0.0",
  "appBaseUrl": "https://xllmapi.com"
}
```

**实现方式**：
- 修改 `apps/platform-api/src/config.ts`
- 在读取 env vars 之前，先尝试加载配置文件
- 配置文件的值作为 fallback（env var 优先）
- 用 `readFileSync` + `JSON.parse`，不引入新依赖

**核心代码逻辑**：
```typescript
function loadConfigFile(): Record<string, unknown> {
  // 1. --config <path>
  const argIdx = process.argv.indexOf("--config");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return JSON.parse(readFileSync(process.argv[argIdx + 1], "utf-8"));
  }
  // 2. CWD
  const cwdPath = join(process.cwd(), ".platform.xllmapi.json");
  if (existsSync(cwdPath)) return JSON.parse(readFileSync(cwdPath, "utf-8"));
  // 3. Home
  const homePath = join(homedir(), ".config/xllmapi/.platform.xllmapi.json");
  if (existsSync(homePath)) return JSON.parse(readFileSync(homePath, "utf-8"));
  return {};
}

// 使用：env var > config file > default
const secretKey = process.env.XLLMAPI_SECRET_KEY ?? fileConfig.secretKey ?? null;
```

### 文件
- `apps/platform-api/src/config.ts` — 加载配置文件逻辑
- `.platform.xllmapi.example.json` — **新建**示例文件
- 文档更新

---

## Verification

### 找回密码
1. 输入不存在的邮箱 → 显示"该邮箱未注册"
2. 输入存在的邮箱 → 显示发送成功 + 脱敏邮箱
3. 60s 内重发被限制

### 通知条
1. Admin 设置 banner → 所有页面顶部显示
2. 用户点 X 关闭 → 刷新前不再显示
3. Admin 关闭 → 横幅消失
4. 变更记录正确

### 配置文件
1. 创建 `.platform.xllmapi.json` 后启动 → 读取配置
2. 同时设环境变量 → 环境变量覆盖
3. `--config /path/to/config.json` → 使用指定路径
4. 无配置文件 → 回退到环境变量（向后兼容）
