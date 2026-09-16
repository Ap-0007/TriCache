# Observability & Telemetry

> **Enterprise Monitoring Reference**: Embedded Real-Time SSE Dashboard, Grafana Dashboard, Prometheus Alerts, Terminal CLI, and OpenTelemetry Distributed Tracing.

---

## 1. Visual Single-Page Web Dashboard (`tricache/dashboard`)

TriCache includes an enterprise-ready visual administration suite with **zero external CDN dependencies** (100% self-contained and air-gappable).

![Visual Single-Page Web Dashboard](/docs/Cache_observability_dashboard_di…_20260910213742.jpeg)

::: details Terminal ASCII Representation
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Δ TriCache Observability       [Pod: worker-pod-42] [Uptime: 4.2h] [SSE]  │
├─────────────────────────────────────────────────────────────────────────────┤
│  🎯 HIT RATIO (98.4%)           🛡️ STAMPEDES PREVENTED                      │
│  [====================  ]       14,290 concurrent requests coalesced        │
│  L1: 82% | Disk: 11% | L2: 5%                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  🧠 L1 HEAP MEMORY              ⚡ INVALIDATION BACKPLANE                  │
│  42.5 MB / 128 MB threshold     2,450 Sent / 9,812 Received                 │
└─────────────────────────────────────────────────────────────────────────────┘
```
:::

### Express, Fastify & Node.js Middleware

Mount the dashboard inside your existing service with timing-safe authentication and audit logging:

```typescript
import { tricacheDashboard } from 'tricache/dashboard';
import { cache } from './cache';

// Express / Fastify / Connect
app.use(
  '/admin/cache',
  tricacheDashboard({
    cache,
    basePath: '/admin/cache',
    title: 'Production Cache Fleet',
    // 🔒 Timing-Safe Authentication (SHA-256 constant-time comparison)
    auth: {
      username: 'admin',
      password: process.env.DASHBOARD_PASSWORD ?? 'super-secret',
    },
    // 🛡️ Read-Only Mode (disables manual Clear/Invalidate buttons in production)
    readOnly: process.env.NODE_ENV === 'production',
    // 🏷️ Audit logging hook for enterprise compliance
    onAction: (event) => {
      console.log(`[AUDIT] Action: ${event.action}, Target: ${event.target}, User: ${event.user}`);
    },
  })
);
```

### Next.js 16 & 15 App Router

Mount under the Next.js App Router via dynamic route handlers:

```typescript
// app/admin/cache/[...slug]/route.ts
import { createNextDashboardHandlers } from 'tricache/dashboard';
import { cache } from '@/lib/cache';

export const { GET, POST } = createNextDashboardHandlers({
  cache,
  basePath: '/admin/cache',
  authSecret: process.env.MANAGEMENT_SECRET,
  readOnly: process.env.NODE_ENV === 'production',
});
```

### Standalone Management Server (Kubectl Port-Forwarding)

For background workers or isolated microservices without a public HTTP listener:

```typescript
import { startDashboardServer } from 'tricache/dashboard';
import { cache } from './cache';

const server = await startDashboardServer({
  cache,
  port: 9090,
  host: '127.0.0.1', // Bound strictly to localhost
  authSecret: process.env.MANAGEMENT_SECRET,
});

console.log(`Management server listening on port ${server.port}`);
```

Access securely via Kubernetes without exposing ingress routes:
```bash
kubectl port-forward pod/my-service-pod 9090:9090
# Open browser: http://localhost:9090?token=<MANAGEMENT_SECRET>
```

---

## 2. Pre-Built Grafana Dashboard & Prometheus Alerts

TriCache ships pre-configured production monitoring assets in the repository:

### Grafana Dashboard JSON (`dashboards/tricache-grafana.json`)
Import directly into Grafana for instant fleet-wide visibility:
* **Templated Multi-Tenant Variables**: `$datasource`, `$namespace`, `$service`, and `$pod`.
* **Visual Panels**:
  - Real-Time Hit Ratio Breakdown (L1 RAM vs. L1.5 Disk vs. L2 Redis vs. DB Misses)
  - Stampedes Prevented & Singleflight Coalesced Requests
  - SWR Async Refresh Rates & Background Worker Latency
  - L1 Heap Usage, OOM Watermark Breaches & Emergency Purges
  - Cross-Region Invalidation Mesh Health & Deduplication Ratios
  - Disk Tier Backpressure Queue Depth & Host Low Space Pauses

### Prometheus Alert Rules (`dashboards/tricache-alerts.yaml`)
Turnkey `PrometheusRule` manifests ready for Prometheus Operator / VictoriaMetrics:

```yaml
groups:
  - name: tricache.alerts
    rules:
      - alert: TriCacheOOMWatermarkBreached
        expr: tricache_oom_evictions_total > 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "TriCache emergency L1 evictions triggered by heap pressure"

      - alert: TriCacheCircuitBreakerOpen
        expr: tricache_disk_latency_bypass_stage == 3
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "TriCache disk latency watchdog tripped into full bypass mode"

      - alert: TriCacheHitRatioDegraded
        expr: tricache_l1_hit_rate < 0.60
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "TriCache hit ratio dropped below 60% over 5 minutes"
```

---

## 3. OpenTelemetry Distributed Tracing & Metrics

TriCache includes structural compatibility with `@opentelemetry/api` without adding heavy runtime dependencies:

```typescript
import { trace, metrics } from '@opentelemetry/api';
import { CacheService } from 'tricache';

const cache = CacheService.create({
  // 1. Native Distributed Tracing
  tracer: trace.getTracer('my-service'),

  // 2. Native OTel Metrics Exporter
  meter: metrics.getMeter('my-service'),
});
```

### Standardized Semantic Conventions:
* **Spans Emitted**: `tricache.get`, `tricache.set`, `tricache.delete`, `tricache.clear`, `tricache.mget`, `tricache.mset`, `tricache.mdel`, `tricache.invalidate_tag`.
* **Span Attributes**:
  - `cache.hit`: `true` | `false`
  - `cache.namespace`: current namespace prefix
  - `cache.key_prefix`: first segment of the key (e.g. `'user'`)
  - `cache.ttl`: TTL in seconds
  - `cache.l1_hits`, `cache.l2_hits`: tier hits during batch operations
* **W3C Distributed TraceContext Propagation**: Use `parseTraceParent()` and `formatTraceParent()` to propagate trace IDs across cross-region invalidation events.

---

## 4. Terminal CLI (`npx tricache`)

Inspect and manage running TriCache and Redis instances directly from your terminal:

```bash
# 1. Live cluster telemetry inspection
npx tricache inspect --redis redis://127.0.0.1:6379

# 2. Purge cache tags across all cluster nodes
npx tricache invalidate --tag users --redis redis://127.0.0.1:6379

# 3. Export Prometheus metrics
npx tricache metrics --prometheus

# 4. Measure three-tier round-trip latency
npx tricache ping --redis redis://127.0.0.1:6379
```
