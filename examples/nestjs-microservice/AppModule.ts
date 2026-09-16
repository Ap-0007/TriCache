import { CacheModule } from '@nestjs/cache-manager';
import { TriCacheModule } from 'tricache/nestjs';

// ... existing code ...
const app = await appBuilder.start(NestFactory.create(AppModule));
app.use(CacheModule.register({ ... }));

// ... existing code ...