# Prisma ORM Extension

> Package entry: `tricache/prisma`

TriCache provides a turnkey Prisma Client Extension (`$extends`) that caches read queries (`findUnique`, `findFirst`, `findMany`, `count`, `aggregate`) and automatically clears tags on write mutations (`create`, `update`, `delete`).

---

## Installation & Setup

Attach the extension to your existing `PrismaClient`:

```typescript
import { PrismaClient } from '@prisma/client';
import { withTriCache } from 'tricache/prisma';
import { CacheService } from 'tricache';

const rawPrisma = new PrismaClient();
const cache = CacheService.preset('microservice', {
  redisHost: process.env.REDIS_HOST ?? '127.0.0.1',
});

export const prisma = rawPrisma.$extends(
  withTriCache({
    cache,
    defaultTtlSec: 300,   // 5 minutes default
    autoInvalidate: true, // Automatically invalidates model tags on mutations
  })
);
```

---

## Querying with Cache Controls

Read queries accept an optional `cache` object to customize caching behavior:

```typescript
// Query cached with custom TTL and semantic tags
const users = await prisma.user.findMany({
  where: { role: 'admin' },
  cache: {
    ttl: 600,
    swr: 60,
    tags: ['admins', 'internal-staff'],
  },
});
```

### Deterministic Query Key Hashing
TriCache hashes the query arguments using a sorted, canonical JSON serialization engine (`sha256(model + operation + normalizedArgs)`). Field order differences in `where` clauses generate the identical cache key:

```typescript
// Both queries produce the exact same cache key and hit L1 memory:
await prisma.user.findUnique({ where: { email: 'a@example.com', active: true } });
await prisma.user.findUnique({ where: { active: true, email: 'a@example.com' } });
```

---

## Automatic Mutation Invalidation

When `autoInvalidate: true` is enabled, write operations automatically invalidate the corresponding model tag:

```typescript
// Automatically invalidates all entries tagged with 'User' across your cluster
await prisma.user.update({
  where: { id: 101 },
  data: { name: 'New Name' },
});
```
