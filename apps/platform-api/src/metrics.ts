type MetricsState = {
  totalRequests: number;
  chatRequests: number;
  authFailures: number;
  rateLimitHits: number;
  idempotentReplays: number;
  cacheHits: number;
  cacheMisses: number;
  coreErrors: number;
};

const metrics: MetricsState = {
  totalRequests: 0,
  chatRequests: 0,
  authFailures: 0,
  rateLimitHits: 0,
  idempotentReplays: 0,
  cacheHits: 0,
  cacheMisses: 0,
  coreErrors: 0
};

export const metricsService = {
  increment(name: keyof MetricsState) {
    metrics[name] += 1;
  },

  snapshot() {
    return {
      ...metrics
    };
  }
};
