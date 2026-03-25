# xllmapi Observability Assets

This directory contains production-ready observability assets for the platform service.

## Files

- `prometheus-alerts.yml`: alert rules for the `xllmapi-platform` Prometheus job.

## Recommended Prometheus scrape config

```yaml
scrape_configs:
  - job_name: xllmapi-platform
    metrics_path: /metrics
    static_configs:
      - targets:
          - 127.0.0.1:3000
```

## Recommended alert routing

At minimum, route these alerts to the on-call channel:

1. `XllmapiInstanceDown`
2. `XllmapiSettlementFailuresDetected`
3. `XllmapiCoreErrorsHigh`
4. `XllmapiMetricsMissing`

`XllmapiAuthRateLimitBurst` and `XllmapiChatRateLimitBurst` are warning-level signals and can route to an operations channel instead of paging by default.
