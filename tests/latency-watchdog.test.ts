import { describe, it, expect, afterEach } from 'vitest';
import { TierLatencyWatchdog } from '../src/latency-watchdog';
import { CacheService } from '../src/cache-service';

describe('TierLatencyWatchdog & Control-Theory Safeguards', () => {
  describe('Graduated Latency Watchdog & Zero-Allocation Ring Buffer', () => {
    it('initializes in Stage 0 (normal) and allows disk reads', () => {
      const watchdog = new TierLatencyWatchdog({ minSamples: 16 });
      const tel = watchdog.getTelemetry();
      expect(tel.bypassActive).toBe(false);
      expect(tel.bypassStage).toBe(0);
      expect(watchdog.isDiskAllowed()).toBe(true);
    });

    it('remains in Stage 0 while disk and Redis latencies are healthy', () => {
      const watchdog = new TierLatencyWatchdog({ minSamples: 16, minDiskBypassMs: 10 });
      // Feed 32 healthy samples (1ms disk, 1ms redis)
      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(1.0);
        watchdog.recordRedis(1.0);
      }

      const tel = watchdog.getTelemetry();
      expect(tel.bypassStage).toBe(0);
      expect(watchdog.isDiskAllowed()).toBe(true);
      expect(tel.diskP95Ms).toBeCloseTo(1.0, 0);
    });

    it('transitions to Stage 1 (25% probabilistic diversion) under moderate disk contention', () => {
      const watchdog = new TierLatencyWatchdog({
        minSamples: 16,
        minDiskBypassMs: 10,
        bypassRatio: 1.5,
      });

      // Redis is fast (1ms), Disk experiences moderate contention (15ms)
      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(15.0);
        watchdog.recordRedis(1.0);
      }

      const tel = watchdog.getTelemetry();
      expect(tel.bypassStage).toBe(1);
      expect(tel.bypassActive).toBe(true);

      // In Stage 1: randomOverride <= 0.25 diverts to Redis (isDiskAllowed returns false)
      expect(watchdog.isDiskAllowed(0.10)).toBe(false); // 25% diverted
      expect(watchdog.isDiskAllowed(0.24)).toBe(false);
      expect(watchdog.isDiskAllowed(0.26)).toBe(true);  // 75% hits disk
      expect(watchdog.isDiskAllowed(0.90)).toBe(true);
    });

    it('transitions to Stage 2 (75% probabilistic diversion) under severe disk contention', () => {
      const watchdog = new TierLatencyWatchdog({
        minSamples: 16,
        minDiskBypassMs: 10,
        bypassRatio: 1.5,
      });

      // Disk latency spikes to 30ms (>= 25ms and >= 2.25 * 1ms)
      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(30.0);
        watchdog.recordRedis(1.0);
      }

      const tel = watchdog.getTelemetry();
      expect(tel.bypassStage).toBe(2);

      // In Stage 2: randomOverride <= 0.75 diverts to Redis
      expect(watchdog.isDiskAllowed(0.50)).toBe(false); // diverted
      expect(watchdog.isDiskAllowed(0.74)).toBe(false);
      expect(watchdog.isDiskAllowed(0.76)).toBe(true);  // 25% hits disk
    });

    it('transitions to Stage 3 (100% bypass) on hard disk stall (>= 50ms)', () => {
      const watchdog = new TierLatencyWatchdog({
        minSamples: 16,
        cooldownMs: 10_000,
      });

      // Hard disk stall: 60ms
      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(60.0);
        watchdog.recordRedis(1.5);
      }

      const tel = watchdog.getTelemetry();
      expect(tel.bypassStage).toBe(3);
      expect(tel.bypassedTotal).toBeGreaterThanOrEqual(1);

      // 100% diverted during active cooldown
      expect(watchdog.isDiskAllowed(0.99)).toBe(false);
      expect(watchdog.isDiskAllowed(0.01)).toBe(false);
    });
  });

  describe('Asymmetric Hysteresis on Redis Circuit', () => {
    it('latches dampening ON at 15ms cutoff, dropping diversion to Stage 0', () => {
      const watchdog = new TierLatencyWatchdog({
        minSamples: 16,
        minDiskBypassMs: 10,
        redisCutoffMs: 15,
        redisRecoveryFloorMs: 10,
      });

      // Initially, disk is slow (20ms) and Redis is 2ms -> Stage 1
      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(20.0);
        watchdog.recordRedis(2.0);
      }
      expect(watchdog.getTelemetry().bypassStage).toBe(1);

      // Sudden Redis pressure: Redis jumps to 16ms
      for (let i = 0; i < 32; i++) {
        watchdog.recordRedis(16.0);
      }

      const tel = watchdog.getTelemetry();
      expect(tel.redisDampened).toBe(true);
      // Diversion is killed to protect fleet from cascading shockwave
      expect(tel.bypassStage).toBe(0);
      expect(watchdog.isDiskAllowed()).toBe(true);
    });

    it('does NOT re-engage diversion until Redis drops below 10ms across >= 16 consecutive samples', () => {
      const watchdog = new TierLatencyWatchdog({
        minSamples: 16,
        minDiskBypassMs: 10,
        redisCutoffMs: 15,
        redisRecoveryFloorMs: 10,
      });

      // 1. Trip dampening with 16ms Redis latency
      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(20.0);
        watchdog.recordRedis(16.0);
      }
      expect(watchdog.getTelemetry().redisDampened).toBe(true);

      // 2. Redis recovers to 8ms for only 10 samples (less than 16 consecutive requirement)
      for (let i = 0; i < 10; i++) {
        watchdog.recordRedis(8.0);
      }
      // Re-trigger calculation
      for (let i = 0; i < 22; i++) {
        watchdog.recordRedis(11.0); // Spikes slightly above 10ms
      }
      expect(watchdog.getTelemetry().redisDampened).toBe(true); // Still dampened!

      // 3. Redis logs 32 consecutive samples below 10ms (e.g. 5ms)
      for (let i = 0; i < 32; i++) {
        watchdog.recordRedis(5.0);
      }

      const tel = watchdog.getTelemetry();
      expect(tel.redisDampened).toBe(false);
      // Diversion safely re-engages!
      expect(tel.bypassStage).toBe(1);
    });
  });

  describe('Single-Canary Probing & Cooldown Jitter', () => {
    it('allows exactly one canary probe in half-open state after cooldown expires', async () => {
      const watchdog = new TierLatencyWatchdog({
        minSamples: 16,
        cooldownMs: 50, // Short cooldown for testing
      });

      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(80.0);
        watchdog.recordRedis(1.0);
      }
      expect(watchdog.getTelemetry().bypassStage).toBe(3);

      // Wait for cooldown to expire
      await new Promise(r => setTimeout(r, 80));

      // First caller gets the canary probe (half-open)
      expect(watchdog.isDiskAllowed()).toBe(true);

      // Concurrent callers are blocked while canary is in-flight
      expect(watchdog.isDiskAllowed()).toBe(false);
      expect(watchdog.isDiskAllowed()).toBe(false);

      // Succeeded canary with low latency recovers cleanly
      watchdog.onCanaryResult(true, 2.0);
      expect(watchdog.getTelemetry().bypassStage).toBe(0);
      expect(watchdog.isDiskAllowed()).toBe(true);
    });

    it('extends cooldown with fresh jitter if canary probe fails or remains slow', async () => {
      const watchdog = new TierLatencyWatchdog({
        minSamples: 16,
        cooldownMs: 50,
      });

      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(80.0);
        watchdog.recordRedis(1.0);
      }
      expect(watchdog.getTelemetry().bypassStage).toBe(3);

      await new Promise(r => setTimeout(r, 80));
      expect(watchdog.isDiskAllowed()).toBe(true); // Canary in flight

      // Canary still encounters 70ms disk stall
      watchdog.onCanaryResult(false, 70.0);
      expect(watchdog.getTelemetry().bypassStage).toBe(3);

      // Blocked again until renewed cooldown expires
      expect(watchdog.isDiskAllowed()).toBe(false);
    });
  });

  describe('Singleflight Shielding on the Probabilistic Path', () => {
    const ns = 'test-singleflight-shielding';
    afterEach(() => {
      CacheService.reset({ namespace: ns });
    });

    it('coalesces 10 concurrent requests for the same cold key before the coin flip', async () => {
      const cache = new CacheService({
        namespace: ns,
        disableRedis: true, // Local test mode
        diskLatencyWatchdog: true,
      });

      let dbFetchCount = 0;
      const fetchFn = async () => {
        dbFetchCount++;
        await new Promise(r => setTimeout(r, 25)); // simulate slow I/O
        return { data: 'coalesced-payload' };
      };

      // 10 concurrent requests for identical cold key
      const key = 'user:profile:42';
      const results = await Promise.all([
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
        cache.get(key, fetchFn),
      ]);

      // All 10 returned identical data
      for (const res of results) {
        expect(res).toEqual({ data: 'coalesced-payload' });
      }

      // Exactly 1 fetch was executed
      expect(dbFetchCount).toBe(1);

      const m = cache.metrics();
      // 9 stampedes prevented due to singleflight coalescing
      expect(m.gets.stampedePrevented).toBe(9);
      expect(m.gets.fetches).toBe(1);
    });
  });
});
