import { describe, it, expect, afterEach } from 'vitest';
import { CacheService, deepMergeOptions } from '../src/index';
import type { CacheOptions } from '../src/types';

describe('CacheService.preset & deepMergeOptions', () => {
  afterEach(() => {
    CacheService.reset({ namespace: 'test-preset-ns' });
  });

  describe('deepMergeOptions', () => {
    it('returns a shallow copy if no overrides are provided', () => {
      const base: CacheOptions = { l1MaxBytes: 1000, l1AdmissionPolicy: 'wtinylfu' };
      const merged = deepMergeOptions(base);
      expect(merged).toEqual(base);
      expect(merged).not.toBe(base);
    });

    it('replaces primitive options with overrides', () => {
      const base: CacheOptions = { l1MaxBytes: 1000, backplaneMode: 'stream' };
      const merged = deepMergeOptions(base, { l1MaxBytes: 2000, backplaneMode: 'pubsub' });
      expect(merged.l1MaxBytes).toBe(2000);
      expect(merged.backplaneMode).toBe('pubsub');
    });

    it('deeply merges nested plain objects without dropping base sub-properties', () => {
      const base: CacheOptions = {
        categoryLimits: {
          'user:': { maxEntries: 100, maxSizeBytes: 1024 },
          'default': { maxEntries: 500, maxSizeBytes: 5000 },
        },
      };

      const overrides: Partial<CacheOptions> = {
        categoryLimits: {
          'user:': { maxEntries: 200, maxSizeBytes: 2048 },
          'orders:': { maxEntries: 50, maxSizeBytes: 512 },
        },
      };

      const merged = deepMergeOptions(base, overrides);
      expect(merged.categoryLimits).toBeDefined();
      expect(merged.categoryLimits!['user:']).toEqual({ maxEntries: 200, maxSizeBytes: 2048 });
      expect(merged.categoryLimits!['orders:']).toEqual({ maxEntries: 50, maxSizeBytes: 512 });
      expect(merged.categoryLimits!['default']).toEqual({ maxEntries: 500, maxSizeBytes: 5000 });
    });

    it('preserves class instances, functions, and arrays without attempting recursive merge', () => {
      const customTracer = { startSpan: () => ({ setAttribute: () => {}, setStatus: () => {}, end: () => {} }) } as any;
      const base: CacheOptions = { forbiddenSnapshotPrefixes: ['auth:', 'session:'] };
      const overrides: Partial<CacheOptions> = {
        forbiddenSnapshotPrefixes: ['token:'],
        tracer: customTracer,
      };

      const merged = deepMergeOptions(base, overrides);
      expect(merged.forbiddenSnapshotPrefixes).toEqual(['token:']);
      expect(merged.tracer).toBe(customTracer);
    });
  });

  describe('CacheService.preset() instantiation', () => {
    it('initializes preset: "nextjs" with expected production defaults', () => {
      const cache = CacheService.preset('nextjs', { namespace: 'nextjs-test-ns', disableRedis: true });
      expect(cache).toBeInstanceOf(CacheService);
      const opts = cache.options;
      expect(opts.namespace).toBe('nextjs-test-ns');
      CacheService.reset({ namespace: 'nextjs-test-ns' });
    });

    it('initializes preset: "microservice" with expected production defaults', () => {
      const cache = CacheService.preset('microservice', { namespace: 'micro-test-ns', disableRedis: true });
      expect(cache).toBeInstanceOf(CacheService);
      const opts = cache.options;
      expect(opts.namespace).toBe('micro-test-ns');
      CacheService.reset({ namespace: 'micro-test-ns' });
    });

    it('initializes preset: "serverless" with expected production defaults', () => {
      const cache = CacheService.preset('serverless', { namespace: 'serverless-test-ns' });
      expect(cache).toBeInstanceOf(CacheService);
      const metrics = cache.metrics();
      expect(metrics.disk.disabled).toBe(true);
      CacheService.reset({ namespace: 'serverless-test-ns' });
    });

    it('initializes preset: "enterprise-hardened" with expected production defaults', () => {
      const cache = CacheService.preset('enterprise-hardened', { namespace: 'hardened-test-ns', disableRedis: true });
      expect(cache).toBeInstanceOf(CacheService);
      const opts = cache.options;
      expect(opts.strictSingleton).toBe(true);
      CacheService.reset({ namespace: 'hardened-test-ns' });
    });

    it('throws when passed an unknown preset identifier', () => {
      expect(() => {
        CacheService.preset('non-existent' as any);
      }).toThrow(/unknown preset 'non-existent'/);
    });
  });
});
