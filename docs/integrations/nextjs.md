# Next.js 16 & 15 App Router Integration

> Package entry: `tricache/next`

TriCache provides a drop-in cache handler for Next.js 16 & 15 App Router with native support for React 19 Server Components (RSC) binary streams, dynamic soft tags, Next.js 16 Cache Components (`'use cache'`), and generational tag versions.

---

## Ready-to-Run Demo Application

A complete, production-ready demo application is available in the repository at [`examples/nextjs`](https://github.com/Kareem411/TriCache/tree/main/examples/nextjs):

- **Next.js 16.3+ & React 19.2+** App Router architecture.
- **Cache Components (`'use cache'`)** with `cacheTag('products')` backed by TriCache.
- **Side-by-Side Comparison UI**: Live metrics comparing uncached requests (~1000ms simulated latency) against TriCache hits (~1ms).
- **On-Demand Revalidation**: Instant cache revalidation via Server Actions using `updateTag()`.

```bash
cd examples/nextjs
pnpm install
pnpm dev
```

Open `http://localhost:3000` to see TriCache in action.

---

## Next.js 16 Configuration (`cacheHandlers`)

Next.js 16 introduces the `'use cache'` directive (Cache Components) and transitions from the legacy singular `incrementalCacheHandlerPath` to the plural `cacheHandlers` configuration.

### 1. Configure `next.config.ts`

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Use plural cacheHandlers for Next.js 16 Cache Components ('use cache')
  cacheHandlers: {
    default: require.resolve('./cache-handler.ts'),
  },
  cacheMaxMemorySize: 0, // Delegate all in-memory caching to TriCache L1
  cacheComponents: true,
};

export default nextConfig;
```

> **Note for Next.js 15**: If using legacy ISR in Next.js 15, specify `experimental: { incrementalCacheHandlerPath: require.resolve('./cache-handler.ts') }`.

### 2. Implement `cache-handler.ts`

```typescript
import { createNextCacheHandler } from 'tricache/next';

const Handler = createNextCacheHandler({
  namespace: 'my-nextjs-app',
});

const handler = new Handler();

export default {
  // Conforms strictly to Next.js 16 cacheHandlers interface (returns undefined on miss)
  get: (key: string, softTags?: string[]) => handler.get(key, { softTags }),
  set: (key: string, entry: any) => handler.set(key, entry),
  refreshTags: () => handler.refreshTags(),
  getExpiration: (tags: string[]) => handler.getExpiration(tags),
  updateTags: (tags: string[]) => handler.updateTags(tags),
};
```

---

## Key Architectural Highlights

### Strict Next.js 16 Spec Alignment
In accordance with the Next.js 16 `cacheHandlers` specification, `TriCacheHandler.get()` returns `undefined` (rather than `null`) when an entry is not found or when soft tags have expired, preventing cache engine mismatches in Next.js 16 runtimes.

### Binary Stream Safety (`cloneStrategy: 'none'`)
React 19 Server Component (RSC) payloads and flight data streams contain binary buffer chunks. TriCache preserves stream buffer references with zero mutation overhead, eliminating the serialization corruption common in generic key-value caches.

### Cluster-Wide Instant Revalidation
When you invoke Next.js `revalidateTag('products')` or Server Actions calling `updateTag()`, TriCache increments the tag's atomic generational version counter in Redis. All container pods across your fleet immediately treat existing entries as expired without scanning or deleting keys in Redis.

### `/dev/shm` Off-Heap Memory
In Linux container runtimes (Docker, Kubernetes), TriCache automatically mounts `/dev/shm` for L1.5 storage. Multi-megabyte RSC flight payloads are cached in POSIX shared memory, keeping Node.js V8 heap usage low and eliminating garbage collection pauses.

---

## Custom Options Factory

For advanced enterprise setups needing custom telemetry, clustering, or Redis credentials:

```typescript
import { createNextCacheHandler } from 'tricache/next';

export default createNextCacheHandler({
  preset: 'nextjs',
  options: {
    redisHost: process.env.REDIS_HOST,
    redisPort: Number(process.env.REDIS_PORT ?? 6379),
    maxMemoryBytes: 512 * 1024 * 1024, // 512MB RAM
    ttlJitterFactor: 0.15,             // 15% jitter to prevent stampedes
    staleIfError: 300,                 // Serve stale for 5m during upstream outages
  },
});
```
