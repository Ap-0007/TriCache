# Express & Hono HTTP Middleware

> Package entry: `tricache/http`

TriCache provides standard HTTP route caching middleware with weak ETag calculation and RFC 7232 `304 Not Modified` short-circuiting for Express, Fastify, Connect, and Web Standards runtimes (Hono).

---

## Express & Connect

```typescript
import express from 'express';
import { cacheMiddleware } from 'tricache/http';
import { cache } from './cache';

const app = express();

app.get(
  '/api/catalog',
  cacheMiddleware({
    cache,
    ttlSec: 300,
    swrSec: 60,
    keyGenerator: (req) => `http:catalog:${req.query.category ?? 'all'}`,
    tags: ['catalog'],
  }),
  async (req, res) => {
    const products = await fetchProductsFromDb(req.query.category);
    res.json(products);
  }
);
```

---

## Hono & Web Standards

```typescript
import { Hono } from 'hono';
import { honoCacheMiddleware } from 'tricache/http';
import { cache } from './cache';

const app = new Hono();

app.get(
  '/api/posts',
  honoCacheMiddleware({
    cache,
    ttlSec: 180,
    tags: ['posts'],
  }),
  async (c) => {
    const posts = await getPosts();
    return c.json(posts);
  }
);
```

---

## RFC 7232 ETag Validation & Bandwidth Savings

1. **Automatic Weak ETags**: TriCache hashes response payloads and emits an `ETag: W/"<hash>"` header.
2. **Conditional Requests (`If-None-Match`)**: When clients or CDNs send matching `If-None-Match` headers, TriCache short-circuits execution before payload serialization, returning an empty `304 Not Modified` response.
3. **Bandwidth Preservation**: Eliminates 100% of network data transfer costs for repeat mobile and browser clients.
