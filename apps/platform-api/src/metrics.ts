type MetricsState = {
  totalRequests: number;
  chatRequests: number;
  authFailures: number;
  authRateLimitHits: number;
  rateLimitHits: number;
  idempotentReplays: number;
  cacheHits: number;
  cacheMisses: number;
  coreErrors: number;
  settlementFailures: number;
  emailSends: number;
  emailSendFailures: number;
  securityEvents: number;
  failedApiRequests: number;
  dailyLimitExhausted: number;
  providerErrors: number;
};

const metrics: MetricsState = {
  totalRequests: 0,
  chatRequests: 0,
  authFailures: 0,
  authRateLimitHits: 0,
  rateLimitHits: 0,
  idempotentReplays: 0,
  cacheHits: 0,
  cacheMisses: 0,
  coreErrors: 0,
  settlementFailures: 0,
  emailSends: 0,
  emailSendFailures: 0,
  securityEvents: 0,
  failedApiRequests: 0,
  dailyLimitExhausted: 0,
  providerErrors: 0
};

export const metricsService = {
  increment(name: keyof MetricsState) {
    metrics[name] += 1;
  },

  snapshot() {
    return {
      ...metrics
    };
  },

  renderPrometheus(extraLabels?: Record<string, string>) {
    const labelEntries = Object.entries(extraLabels ?? {});
    const labelSuffix = labelEntries.length > 0
      ? `{${labelEntries.map(([key, value]) => `${key}="${String(value).replaceAll("\"", "\\\"")}"`).join(",")}}`
      : "";

    return [
      "# HELP xllmapi_total_requests Total HTTP requests handled.",
      "# TYPE xllmapi_total_requests counter",
      `xllmapi_total_requests${labelSuffix} ${metrics.totalRequests}`,
      "# HELP xllmapi_chat_requests Total chat requests handled.",
      "# TYPE xllmapi_chat_requests counter",
      `xllmapi_chat_requests${labelSuffix} ${metrics.chatRequests}`,
      "# HELP xllmapi_auth_failures Total authentication failures.",
      "# TYPE xllmapi_auth_failures counter",
      `xllmapi_auth_failures${labelSuffix} ${metrics.authFailures}`,
      "# HELP xllmapi_auth_rate_limit_hits Total authentication rate-limit hits.",
      "# TYPE xllmapi_auth_rate_limit_hits counter",
      `xllmapi_auth_rate_limit_hits${labelSuffix} ${metrics.authRateLimitHits}`,
      "# HELP xllmapi_rate_limit_hits Total chat rate-limit hits.",
      "# TYPE xllmapi_rate_limit_hits counter",
      `xllmapi_rate_limit_hits${labelSuffix} ${metrics.rateLimitHits}`,
      "# HELP xllmapi_idempotent_replays Total idempotent replays served from cache.",
      "# TYPE xllmapi_idempotent_replays counter",
      `xllmapi_idempotent_replays${labelSuffix} ${metrics.idempotentReplays}`,
      "# HELP xllmapi_cache_hits Total cache hits.",
      "# TYPE xllmapi_cache_hits counter",
      `xllmapi_cache_hits${labelSuffix} ${metrics.cacheHits}`,
      "# HELP xllmapi_cache_misses Total cache misses.",
      "# TYPE xllmapi_cache_misses counter",
      `xllmapi_cache_misses${labelSuffix} ${metrics.cacheMisses}`,
      "# HELP xllmapi_core_errors Total provider/core execution errors.",
      "# TYPE xllmapi_core_errors counter",
      `xllmapi_core_errors${labelSuffix} ${metrics.coreErrors}`,
      "# HELP xllmapi_settlement_failures Total settlement failures after provider success.",
      "# TYPE xllmapi_settlement_failures counter",
      `xllmapi_settlement_failures${labelSuffix} ${metrics.settlementFailures}`,
      "# HELP xllmapi_email_sends Total transactional emails sent successfully.",
      "# TYPE xllmapi_email_sends counter",
      `xllmapi_email_sends${labelSuffix} ${metrics.emailSends}`,
      "# HELP xllmapi_email_send_failures Total transactional email send failures.",
      "# TYPE xllmapi_email_send_failures counter",
      `xllmapi_email_send_failures${labelSuffix} ${metrics.emailSendFailures}`,
      "# HELP xllmapi_security_events Total security events recorded.",
      "# TYPE xllmapi_security_events counter",
      `xllmapi_security_events${labelSuffix} ${metrics.securityEvents}`,
      "# HELP xllmapi_failed_api_requests Total API requests that failed before reaching a provider.",
      "# TYPE xllmapi_failed_api_requests counter",
      `xllmapi_failed_api_requests${labelSuffix} ${metrics.failedApiRequests}`,
      "# HELP xllmapi_daily_limit_exhausted Total offerings skipped due to daily token limit exhaustion.",
      "# TYPE xllmapi_daily_limit_exhausted counter",
      `xllmapi_daily_limit_exhausted${labelSuffix} ${metrics.dailyLimitExhausted}`,
      "# HELP xllmapi_provider_errors Total upstream provider errors.",
      "# TYPE xllmapi_provider_errors counter",
      `xllmapi_provider_errors${labelSuffix} ${metrics.providerErrors}`
    ].join("\n");
  }
};
