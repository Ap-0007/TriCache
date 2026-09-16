# Edge Isolates & Serverless Runtimes

> Package entry: `tricache/edge`

TriCache provides a zero-Node-dependency caching engine engineered specifically for modern Web Standards and V8 edge isolates:
- **Cloudflare Workers**
- **Vercel Edge Runtime**
- **Fastly Compute@Edge**
- **Deno Deploy**
- **Hono & Bun**

`tricache/edge` is completely decoupled from Node.js native bindings (`node:fs`, `node:worker_threads`, and SQLite) and runs strictly on Web standard APIs (`Request`, `Response`, `crypto.subtle`).

---

## 1. Quick Start in Cloudflare Workers

```typescript
import { EdgeCacheService } from 'tricache/edge';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cache = new EdgeCacheService({
      maxEntries: 5_000,
      bloomFilter: true, // WASM Murmur3 Bloom filter
    });

    const url = new URL(request.url);
    const data = await cache.get(
      `route:${url.pathname}`,
      async () => {
        return await fetchFromOrigin(url.pathname);
      },
      300 // 5-minute TTL
    );

    return Response.json(data);
  },
};
```

---

## 2. Decoupled Hono Edge Middleware (`createHonoEdgeMiddleware`)

TriCache includes native middleware for Hono edge applications:

```typescript
import { Hono } from 'hono';
import { EdgeCacheService, createHonoEdgeMiddleware } from 'tricache/edge';

const app = new Hono();
const edgeCache = new EdgeCacheService({ maxEntries: 2_000 });

// Mount route cache with ETag calculation & 304 short-circuiting
app.get(
  '/api/feed',
  createHonoEdgeMiddleware(edgeCache, {
    ttlSeconds: 180,
    headerWhitelist: ['accept-language'],
  }),
  async (c) => {
    const feed = await fetchLatestFeed();
    return c.json(feed);
  }
);
```

### Key Edge Middleware Features:
* **Zero Node Native Dependencies**: Pure Web Standards (`crypto.subtle`, `Headers`, `Response`).
* **Web Crypto Weak ETags**: Automatically calculates SHA-1 / Murmur3 digests using `crypto.subtle.digest('SHA-1', ...)`.
* **RFC 7232 304 Not Modified**: Intercepts matching `If-None-Match` headers for instant 304 responses with 0 bytes transmitted.
* **Deterministic Query Sorting**: Groups identical query permutations into a single cache entry.
* **Conditional Bypass**: Automatically honors `Cache-Control: no-cache, no-store` and custom `skipCache` rules.

---

## 3. Remote L2 Storage Adapters

In edge environments where TCP sockets are unavailable, TriCache connects to distributed key-value tiers via HTTP REST or native bindings:

### Upstash Redis (HTTPS REST)
```typescript
import { EdgeCacheService, createUpstashAdapter } from 'tricache/edge';

const cache = new EdgeCacheService({
  remoteStorage: createUpstashAdapter({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
});
```

### Cloudflare Workers KV
```typescript
import { EdgeCacheService, createCloudflareKvAdapter } from 'tricache/edge';

const cache = new EdgeCacheService({
  remoteStorage: createCloudflareKvAdapter(env.MY_KV_NAMESPACE),
});
```

---

## 4. Cold-Miss Penetration Defense (Edge Murmur3 Bloom Filter)

Edge subrequests to remote HTTP key-value stores incur metered API costs and 20–50ms latencies. 

TriCache includes an in-memory **MurmurHash3 Bloom Filter** running directly inside the V8 isolate:
* Definite misses for unknown keys abort in **~300 nanoseconds**.
* Eliminates up to **99% of wasted remote subrequests** caused by automated vulnerability scanners and 404 route penetration.
