# Getting Started

Welcome to **TriCache** — an enterprise three-tier caching engine engineered for high-throughput Node.js microservices, Next.js applications, and containerized cloud workloads.

---

## Installation

Install TriCache via your preferred package manager:

::: code-group
```bash [npm]
npm install tricache
```
```bash [pnpm]
pnpm add tricache
```
```bash [yarn]
yarn add tricache
```
```bash [bun]
bun add tricache
```
:::

Node.js $\ge 20.10.0$ is required. `ioredis` and `msgpackr` are bundled as production dependencies.

---

## 30-Second Quickstart

```typescript
import { CacheService } from 'tricache';

// 1. Initialize with an optimal production preset
const cache = CacheService.preset('nextjs', {
  redisHost: process.env.REDIS_HOST ?? '127.0.0.1',
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
});

// 2. Wrap expensive queries in get-or-fetch with SWR
const user = await cache.get(
  `user:${userId}`,
  async () => {
    return await db.users.findUnique({ where: { id: userId } });
  },
  300,            // 5-minute hard TTL
  { swr: 60 }     // 60s soft TTL: serve stale instantly while refreshing in background
);

// 3. Invalidate tags in O(1) time across your entire cluster
await cache.invalidateTag('users');
```

---

## Production Presets

Rather than tuning dozens of configuration flags, use `CacheService.preset(type, overrides)` to apply battle-tested profiles for your specific environment:

```typescript
import { CacheService } from 'tricache';

// Next.js 16/15 App Router
const cache = CacheService.preset('nextjs', { redisHost: 'redis.internal' });
```

### Available Presets

| Preset | Target Environment | Key Behaviors |
|:---|:---|:---|
| `'nextjs'` | Next.js 16 & 15 App Router, React 19 RSC | `cloneStrategy: 'none'` (optimized for stream buffers), W-TinyLFU, `tagStrategy: 'generational'`, Redis Streams backplane, 300s `staleIfError`. |
| `'microservice'` | Express, Fastify, NestJS, gRPC | W-TinyLFU, Redis Streams backplane, `ttlJitterFactor: 0.15` (anti-synchronicity), L2 circuit breaker (5 failures $\rightarrow$ 15s cooldown). |
| `'serverless'` | AWS Lambda, Cloud Run, Vercel Serverless | `disableDisk: true` (memory-only), 1,000ms Redis command timeouts, ephemeral Pub/Sub backplane. |
| `'enterprise-hardened'` | Financial, High-Security, Strict SLA | Generational tags, `strictSingleton: true`, `failClosed: true`, `oomProtection: true` (80% heap threshold emergency shed). |

All preset configurations can be selectively customized by passing an overrides object:

```typescript
const cache = CacheService.preset('microservice', {
  maxMemoryBytes: 512 * 1024 * 1024, // 512MB RAM
  ttlJitterFactor: 0.20,             // 20% jitter
});
```

---

## Core Caching Operations

### 1. Read-Through with Singleflight Coalescing (`cache.get`)

`cache.get(key, fetchFn, ttlSec, options)` executes the three-tier cascade:
1. Checks **L1 RAM** (~350 ns). If found and fresh, returns immediately.
2. Checks **L1.5 Off-Heap `/dev/shm`** (~20 µs). If found, promotes back to L1.
3. Checks **L2 Redis** (~1.2 ms). If found, populates L1 and returns.
4. On miss, invokes `fetchFn()`. Concurrent callers for the identical key coalesce into a single execution.

```typescript
const product = await cache.get(
  `product:${id}`,
  () => fetchProductFromDb(id),
  600, // 10 minutes
  {
    swr: 120,                // Soft TTL: serve stale while background revalidating
    priority: CachePriority.HIGH, // Eviction protection in L1
    tags: ['products', `category:${catId}`],
  }
);
```

### 2. Manual Set (`cache.set`)

Explicitly writes to L1 RAM, spills to `/dev/shm`, and replicates to L2 Redis:

```typescript
await cache.set('config:rate-limits', rateLimits, 3600, {
  priority: CachePriority.CRITICAL, // Never evict unless expired
  tags: ['config'],
});
```

### 3. Cluster-Wide Tag Invalidation (`cache.invalidateTag`)

Invalidates all keys associated with a tag in $O(1)$ time without scanning Redis:

```typescript
// Atomically increments the tag version counter
await cache.invalidateTag('products');

// Supports multiple tags
await cache.invalidateTags(['products', 'inventory']);
```

### 4. Direct Key Deletion (`cache.delete`)

Deletes a key across all local tiers and publishes an invalidation event across the backplane:

```typescript
await cache.delete(`user:${userId}`);
```

### 5. Multi-Key Operations (`cache.mget` & `cache.mset`)

Pipelined multi-key retrieval and batch writing across all three tiers:

```typescript
// Batch fetch with tier fallthrough
const results = await cache.mget(['key:1', 'key:2', 'key:3']);

// Batch write
await cache.mset([
  { key: 'key:1', value: data1, ttl: 300 },
  { key: 'key:2', value: data2, ttl: 300 },
]);
```

---

## Container Readiness & Health Probes

In containerized runtimes (Kubernetes, ECS), decouple process liveness from traffic readiness:

```typescript
import express from 'express';

const app = express();

// Kubernetes Liveness Probe: always 200 unless process has crashed
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Kubernetes Readiness Probe: checks cache health and tier status
app.get('/ready', async (req, res) => {
  const health = cache.health();
  if (health.healthy) {
    res.status(200).json(health);
  } else {
    // Sheds traffic from ingress load balancer until cache heals
    res.status(503).json(health);
  }
});
```

For complete deployment manifests, cgroup budgeting, and eviction defense, see the [Kubernetes Production Guide](/kubernetes-production-guide).
