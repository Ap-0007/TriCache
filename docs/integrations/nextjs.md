# Next.js 16 & 15 App Router Integration

> Package entry: `tricache/next`

TriCache provides a drop-in cache handler for Next.js 16 & 15 App Router (`cacheHandler` in `next.config.ts`), with native support for React 19 Server Component (RSC) binary streams, dynamic soft tags, and generational tag versions.

---

## Installation & Configuration

### 1. Configure Next.js
In your `next.config.ts` (or `next.config.mjs`):

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Points to your custom TriCache handler file
    incrementalCacheHandlerPath: require.resolve('./cache-handler.mjs'),
  },
};

export default nextConfig;
```

### 2. Implement Cache Handler
In `cache-handler.mjs`:

```typescript
import { createNextCacheHandler } from 'tricache/next';

export default createNextCacheHandler({
  preset: 'nextjs',
  redisHost: process.env.REDIS_HOST ?? '127.0.0.1',
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
  keyPrefix: 'nextjs-app:',
});
```

---

## Key Architectural Highlights

### Binary Stream Safety (`cloneStrategy: 'none'`)
React 19 Server Component (RSC) payloads and flight data streams contain binary buffer chunks. TriCache preserves stream buffer references with zero mutation overhead, eliminating the serialization corruption common in generic key-value caches.

### Cluster-Wide Instant Revalidation
When you invoke Next.js `revalidateTag('products')` or `revalidatePath('/catalog')`, TriCache increments the tag's atomic generational version counter in Redis. All container pods across your fleet immediately treat existing entries as expired without scanning or deleting keys in Redis.

### `/dev/shm` Off-Heap Memory
In Linux container runtimes (Docker, Kubernetes), TriCache automatically mounts `/dev/shm` for L1.5 storage. Multi-megabyte RSC flight payloads are cached in POSIX shared memory, keeping Node.js V8 heap usage low and eliminating garbage collection pauses.

---

## Custom Options Factory

For advanced setups needing dynamic configuration:

```typescript
import { createNextCacheHandler } from 'tricache/next';

export default createNextCacheHandler({
  preset: 'nextjs',
  options: {
    redisHost: process.env.REDIS_HOST,
    maxMemoryBytes: 512 * 1024 * 1024, // 512MB RAM
    ttlJitterFactor: 0.15,             // 15% jitter to prevent stampedes
    staleIfError: 300,                 // Serve stale for 5m during upstream outages
  },
});
```
