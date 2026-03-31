import { config } from "./config.js";

export type TransactionalEmailTemplateKey =
  | "invite"
  | "login_code"
  | "password_reset"
  | "email_change_confirm"
  | "email_change_requested_notice"
  | "password_changed_notice"
  | "email_changed_notice"
  | "admin_notification";

export type SendTransactionalEmailParams = {
  templateKey: TransactionalEmailTemplateKey;
  toEmail: string;
  locale?: "zh" | "en";
  subject: string;
  html: string;
  text: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type SendTransactionalEmailResult = {
  provider: string;
  providerMessageId: string | null;
  status: "sent";
  preview?: Record<string, unknown> | null;
};

type RenderTemplateParams = {
  locale?: "zh" | "en";
  code?: string;
  actionUrl?: string;
  productName?: string;
  supportEmail?: string;
  expiresInMinutes?: number;
  inviterName?: string;
  invitationNote?: string | null;
  oldEmail?: string;
  newEmail?: string;
};

const productName = "xllmapi";
const supportEmail = config.emailReplyTo || config.emailFrom || "support@xllmapi.local";

const brand = {
  name: "xllmapi",
  color: "#2563EB",
  website: "https://xllmapi.com",
  github: "https://github.com/xllmapi",
  forum: "https://forum.d2learn.org/category/25/xllmapi",
  qqGroup: "1092372680",
};

const fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const wrapInBrandLayout = (bodyHtml: string, locale: "zh" | "en"): string => {
  const year = new Date().getFullYear();
  const isZh = locale === "zh";

  const websiteLabel = isZh ? "官网" : "Website";
  const forumLabel = isZh ? "论坛" : "Forum";
  const qqLabel = isZh ? "QQ 群" : "QQ Group";
  const feedbackLine = isZh
    ? `如有问题，欢迎到<a href="${brand.forum}" style="color:#2563EB;text-decoration:underline;">论坛</a>反馈`
    : `Questions? Visit our <a href="${brand.forum}" style="color:#2563EB;text-decoration:underline;">forum</a>`;

  return `<!DOCTYPE html>
<html lang="${locale === "zh" ? "zh-CN" : "en"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f6f6f6;font-family:${fontFamily};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f6f6;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
  <!-- Brand bar -->
  <tr><td style="height:4px;background-color:${brand.color};"></td></tr>
  <!-- Header -->
  <tr><td style="padding:24px 32px 0 32px;">
    <a href="${brand.website}" style="font-size:20px;font-weight:700;color:#111;text-decoration:none;font-family:${fontFamily};">${escapeHtml(brand.name)}</a>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:16px 32px 24px 32px;font-size:15px;line-height:1.6;color:#333;font-family:${fontFamily};">
    ${bodyHtml}
  </td></tr>
  <!-- Footer divider -->
  <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
  <!-- Footer -->
  <tr><td style="padding:16px 32px 24px 32px;font-size:12px;line-height:1.6;color:#999;font-family:${fontFamily};">
    <p style="margin:0 0 8px 0;">&copy; ${year} ${escapeHtml(brand.name)}</p>
    <p style="margin:0 0 8px 0;">
      <a href="${brand.website}" style="color:#999;text-decoration:underline;">${websiteLabel}</a>
      &nbsp;&middot;&nbsp;
      <a href="${brand.github}" style="color:#999;text-decoration:underline;">GitHub</a>
      &nbsp;&middot;&nbsp;
      ${qqLabel}: ${brand.qqGroup}
      &nbsp;&middot;&nbsp;
      <a href="${brand.forum}" style="color:#999;text-decoration:underline;">${forumLabel}</a>
    </p>
    <p style="margin:0;">${feedbackLine}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
};

const brandFooterText = (locale: "zh" | "en"): string => {
  const year = new Date().getFullYear();
  const isZh = locale === "zh";
  return [
    "",
    "---",
    `© ${year} ${brand.name}`,
    isZh
      ? `官网: ${brand.website} · GitHub: ${brand.github} · QQ 群: ${brand.qqGroup} · 论坛: ${brand.forum}`
      : `Website: ${brand.website} · GitHub: ${brand.github} · QQ Group: ${brand.qqGroup} · Forum: ${brand.forum}`,
    isZh ? "如有问题，欢迎到论坛反馈" : "Questions? Visit our forum",
  ].join("\n");
};

const subjectMap: Record<TransactionalEmailTemplateKey, { zh: string; en: string }> = {
  invite: {
    zh: "你收到了一封 xllmapi 邀请",
    en: "You have been invited to xllmapi"
  },
  login_code: {
    zh: "你的 xllmapi 登录验证码",
    en: "Your xllmapi sign-in code"
  },
  password_reset: {
    zh: "重置你的 xllmapi 密码",
    en: "Reset your xllmapi password"
  },
  email_change_confirm: {
    zh: "确认你的新邮箱地址",
    en: "Confirm your new email address"
  },
  email_change_requested_notice: {
    zh: "你的 xllmapi 邮箱变更请求",
    en: "Your xllmapi email change request"
  },
  password_changed_notice: {
    zh: "你的 xllmapi 密码已修改",
    en: "Your xllmapi password was changed"
  },
  email_changed_notice: {
    zh: "你的 xllmapi 邮箱已变更",
    en: "Your xllmapi email was changed"
  },
  admin_notification: {
    zh: "[xllmapi] 平台通知",
    en: "[xllmapi] Platform Notification"
  }
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const renderBody = (templateKey: TransactionalEmailTemplateKey, locale: "zh" | "en", params: RenderTemplateParams) => {
  const expiresInMinutes = params.expiresInMinutes ?? 10;
  const actionUrl = params.actionUrl ?? "";
  const code = params.code ?? "";
  const inviterName = params.inviterName ?? "xllmapi";
  const note = params.invitationNote ? `\n\n${params.invitationNote}` : "";
  const oldEmail = params.oldEmail ?? "";
  const newEmail = params.newEmail ?? "";

  switch (templateKey) {
    case "invite":
      if (locale === "zh") {
        return {
          text: `${inviterName} 邀请你加入 ${productName}。请打开链接完成验证：${actionUrl}${note}`,
          html: `<p>${escapeHtml(inviterName)} 邀请你加入 ${escapeHtml(productName)}。</p><p><a href="${escapeHtml(actionUrl)}" style="color:#2563EB;text-decoration:underline;">点击这里开始注册</a></p>${params.invitationNote ? `<p>${escapeHtml(params.invitationNote)}</p>` : ""}`
        };
      }
      return {
        text: `${inviterName} invited you to join ${productName}. Open this link to start: ${actionUrl}${note}`,
        html: `<p>${escapeHtml(inviterName)} invited you to join ${escapeHtml(productName)}.</p><p><a href="${escapeHtml(actionUrl)}" style="color:#2563EB;text-decoration:underline;">Open your invitation</a></p>${params.invitationNote ? `<p>${escapeHtml(params.invitationNote)}</p>` : ""}`
      };
    case "login_code":
      if (locale === "zh") {
        return {
          text: `你的 ${productName} 登录验证码是 ${code}，${expiresInMinutes} 分钟内有效。`,
          html: `<p>你的 ${escapeHtml(productName)} 登录验证码：</p><p><strong style="font-size:24px;letter-spacing:4px;">${escapeHtml(code)}</strong></p><p>${expiresInMinutes} 分钟内有效。</p>`
        };
      }
      return {
        text: `Your ${productName} sign-in code is ${code}. It expires in ${expiresInMinutes} minutes.`,
        html: `<p>Your ${escapeHtml(productName)} sign-in code:</p><p><strong style="font-size:24px;letter-spacing:4px;">${escapeHtml(code)}</strong></p><p>It expires in ${expiresInMinutes} minutes.</p>`
      };
    case "password_reset":
      if (locale === "zh") {
        return {
          text: `点击此链接重置你的 ${productName} 密码：${actionUrl}\n\n链接将在 ${expiresInMinutes} 分钟后失效。`,
          html: `<p>点击此链接重置你的 ${escapeHtml(productName)} 密码：</p><p><a href="${escapeHtml(actionUrl)}">重置密码</a></p><p>链接将在 ${expiresInMinutes} 分钟后失效。</p>`
        };
      }
      return {
        text: `Reset your ${productName} password using this link: ${actionUrl}\n\nThis link expires in ${expiresInMinutes} minutes.`,
        html: `<p>Reset your ${escapeHtml(productName)} password using this link:</p><p><a href="${escapeHtml(actionUrl)}">Reset password</a></p><p>This link expires in ${expiresInMinutes} minutes.</p>`
      };
    case "email_change_confirm":
      if (locale === "zh") {
        return {
          text: `点击此链接确认把 ${productName} 账号邮箱改为 ${newEmail}：${actionUrl}\n\n链接将在 ${expiresInMinutes} 分钟后失效。`,
          html: `<p>点击此链接确认把 ${escapeHtml(productName)} 账号邮箱改为 <strong>${escapeHtml(newEmail)}</strong>：</p><p><a href="${escapeHtml(actionUrl)}">确认新邮箱</a></p><p>链接将在 ${expiresInMinutes} 分钟后失效。</p>`
        };
      }
      return {
        text: `Confirm your new ${productName} email address (${newEmail}) using this link: ${actionUrl}\n\nThis link expires in ${expiresInMinutes} minutes.`,
        html: `<p>Confirm your new ${escapeHtml(productName)} email address (<strong>${escapeHtml(newEmail)}</strong>) using this link:</p><p><a href="${escapeHtml(actionUrl)}">Confirm email change</a></p><p>This link expires in ${expiresInMinutes} minutes.</p>`
      };
    case "password_changed_notice":
      if (locale === "zh") {
        return {
          text: `你的 ${productName} 密码刚刚被修改。如果这不是你本人操作，请立刻到论坛反馈：${brand.forum}`,
          html: `<p>你的 ${escapeHtml(productName)} 密码刚刚被修改。</p><p>如果这不是你本人操作，请立刻到<a href="${brand.forum}" style="color:#2563EB;text-decoration:underline;">论坛</a>反馈。</p>`
        };
      }
      return {
        text: `Your ${productName} password was just changed. If this was not you, report it on our forum immediately: ${brand.forum}`,
        html: `<p>Your ${escapeHtml(productName)} password was just changed.</p><p>If this was not you, report it on our <a href="${brand.forum}" style="color:#2563EB;text-decoration:underline;">forum</a> immediately.</p>`
      };
    case "email_change_requested_notice":
      if (locale === "zh") {
        return {
          text: `你的 ${productName} 账号请求把邮箱从 ${oldEmail} 改为 ${newEmail}。如果这不是你本人操作，请立刻到论坛反馈：${brand.forum}`,
          html: `<p>你的 ${escapeHtml(productName)} 账号请求把邮箱从 <strong>${escapeHtml(oldEmail)}</strong> 改为 <strong>${escapeHtml(newEmail)}</strong>。</p><p>如果这不是你本人操作，请立刻到<a href="${brand.forum}" style="color:#2563EB;text-decoration:underline;">论坛</a>反馈。</p>`
        };
      }
      return {
        text: `Your ${productName} account requested an email change from ${oldEmail} to ${newEmail}. If this was not you, report it on our forum immediately: ${brand.forum}`,
        html: `<p>Your ${escapeHtml(productName)} account requested an email change from <strong>${escapeHtml(oldEmail)}</strong> to <strong>${escapeHtml(newEmail)}</strong>.</p><p>If this was not you, report it on our <a href="${brand.forum}" style="color:#2563EB;text-decoration:underline;">forum</a> immediately.</p>`
      };
    case "email_changed_notice":
      if (locale === "zh") {
        return {
          text: `你的 ${productName} 账号邮箱已从 ${oldEmail} 变更为 ${newEmail}。如果这不是你本人操作，请立刻到论坛反馈：${brand.forum}`,
          html: `<p>你的 ${escapeHtml(productName)} 账号邮箱已从 <strong>${escapeHtml(oldEmail)}</strong> 变更为 <strong>${escapeHtml(newEmail)}</strong>。</p><p>如果这不是你本人操作，请立刻到<a href="${brand.forum}" style="color:#2563EB;text-decoration:underline;">论坛</a>反馈。</p>`
        };
      }
      return {
        text: `Your ${productName} account email was changed from ${oldEmail} to ${newEmail}. If this was not you, report it on our forum immediately: ${brand.forum}`,
        html: `<p>Your ${escapeHtml(productName)} account email was changed from <strong>${escapeHtml(oldEmail)}</strong> to <strong>${escapeHtml(newEmail)}</strong>.</p><p>If this was not you, report it on our <a href="${brand.forum}" style="color:#2563EB;text-decoration:underline;">forum</a> immediately.</p>`
      };
    case "admin_notification":
      if (locale === "zh") {
        return {
          text: `你好，\n\n${params.code ?? ""}\n\n—— xllmapi 平台通知`,
          html: `<p>你好，</p><p>${escapeHtml(params.code ?? "")}</p><p style="color:#999;margin-top:16px;">—— xllmapi 平台通知</p>`
        };
      }
      return {
        text: `Hello,\n\n${params.code ?? ""}\n\n— xllmapi Platform Notification`,
        html: `<p>Hello,</p><p>${escapeHtml(params.code ?? "")}</p><p style="color:#999;margin-top:16px;">— xllmapi Platform Notification</p>`
      };
  }
};

export const renderTransactionalEmail = (templateKey: TransactionalEmailTemplateKey, params: RenderTemplateParams) => {
  const locale = params.locale === "zh" ? "zh" : "en";
  const body = renderBody(templateKey, locale, params);
  return {
    subject: subjectMap[templateKey][locale],
    html: wrapInBrandLayout(body.html, locale),
    text: body.text + brandFooterText(locale)
  };
};

type EmailSender = {
  send(params: SendTransactionalEmailParams): Promise<SendTransactionalEmailResult>;
};

class MockEmailSender implements EmailSender {
  async send(params: SendTransactionalEmailParams): Promise<SendTransactionalEmailResult> {
    return {
      provider: "mock",
      providerMessageId: `mock_${Date.now()}`,
      status: "sent",
      preview: {
        toEmail: params.toEmail,
        subject: params.subject,
        html: params.html,
        text: params.text,
        metadata: params.metadata ?? null
      }
    };
  }
}

class ResendEmailSender implements EmailSender {
  async send(params: SendTransactionalEmailParams): Promise<SendTransactionalEmailResult> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: config.emailFrom,
        reply_to: config.emailReplyTo ?? undefined,
        to: [params.toEmail],
        subject: params.subject,
        html: params.html,
        text: params.text,
        headers: params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : undefined
      })
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`resend_send_failed:${response.status}:${body.slice(0, 300)}`);
    }

    let messageId: string | null = null;
    try {
      const parsed = JSON.parse(body) as { id?: string };
      messageId = parsed.id ?? null;
    } catch {
      messageId = null;
    }

    return {
      provider: "resend",
      providerMessageId: messageId,
      status: "sent",
      preview: null
    };
  }
}

export const emailSender: EmailSender = config.emailProvider === "resend"
  ? new ResendEmailSender()
  : new MockEmailSender();
