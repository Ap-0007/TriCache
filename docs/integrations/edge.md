# Edge Isolates & Serverless Runtimes

> Package entry: `tricache/edge`

TriCache provides a zero-Node-dependency caching library engineered specifically for V8 isolates:
- **Cloudflare Workers**
- **Vercel Edge Runtime**
- **Fastly Compute@Edge**
- **Deno Deploy**

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

## 2. Remote L2 Storage Adapters

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

## 3. Cold-Miss Penetration Defense (Edge Murmur3 Bloom Filter)

Edge subrequests to remote HTTP key-value stores incur metered API costs and 20–50ms latencies. 

TriCache includes an in-memory **MurmurHash3 Bloom Filter** running directly inside the V8 isolate:
* Definite misses for unknown keys abort in **~300 nanoseconds**.
* Eliminates up to **99% of wasted remote subrequests** caused by automated vulnerability scanners and 404 route penetration.
