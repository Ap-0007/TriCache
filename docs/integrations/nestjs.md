# NestJS Dynamic Module & Decorators

> Package entry: `tricache/nestjs`

TriCache provides an official NestJS dynamic module (`TriCacheModule`) and declarative method decorators (`@Cacheable`, `@CacheEvict`) for high-concurrency NestJS microservices.

---

## Installation & Module Registration

### Synchronous Registration

In your root `AppModule`:

```typescript
import { Module } from '@nestjs/common';
import { TriCacheModule } from 'tricache/nestjs';

@Module({
  imports: [
    TriCacheModule.register({
      preset: 'microservice',
      redisHost: process.env.REDIS_HOST ?? '127.0.0.1',
      redisPort: Number(process.env.REDIS_PORT ?? 6379),
      isGlobal: true, // Exports CacheService across all NestJS modules
    }),
  ],
})
export class AppModule {}
```

### Asynchronous Registration (with `ConfigService`)

For injecting runtime environment variables:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TriCacheModule } from 'tricache/nestjs';

@Module({
  imports: [
    TriCacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        preset: 'microservice',
        redisHost: config.get<string>('REDIS_HOST'),
        redisPort: config.get<number>('REDIS_PORT'),
        isGlobal: true,
      }),
    }),
  ],
})
export class AppModule {}
```

---

## Declarative Method Decorators

### `@Cacheable`
Automatically caches method return values with Singleflight coalescing and SWR:

```typescript
import { Injectable } from '@nestjs/common';
import { Cacheable } from 'tricache/nestjs';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  @Cacheable({
    key: (userId: string) => `user:${userId}`,
    ttlSec: 300,
    swrSec: 60,
    tags: ['users'],
  })
  async getUserById(userId: string) {
    return await this.prisma.user.findUnique({ where: { id: userId } });
  }
}
```

### `@CacheEvict`
Evicts specific keys or tags upon mutation:

```typescript
import { Injectable } from '@nestjs/common';
import { CacheEvict } from 'tricache/nestjs';

@Injectable()
export class UserService {
  @CacheEvict({
    key: (userId: string) => `user:${userId}`,
    tags: ['users'],
  })
  async updateUser(userId: string, data: UpdateUserDto) {
    return await this.prisma.user.update({ where: { id: userId }, data });
  }
}
```

---

## Direct `CacheService` Injection

Inject `CacheService` directly into services and controllers:

```typescript
import { Injectable } from '@nestjs/common';
import { CacheService } from 'tricache';

@Injectable()
export class OrderService {
  constructor(private readonly cache: CacheService) {}

  async processOrder(orderId: string) {
    return await this.cache.lock(`order:${orderId}`, async () => {
      // Critical transactional logic executed under distributed mutex
      return await this.executePayment(orderId);
    });
  }
}
```
