import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DiskTier } from '../src/disk-tier';
import { CacheService } from '../src/cache-service';
import { consoleLogger } from '../src/types';

describe('Strict Ephemeral Quotas & K8s Eviction Defense', () => {
  const tmpDir = path.join(os.tmpdir(), `tricache-quota-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ok */ }
    vi.restoreAllMocks();
  });

  describe('Watermark Chunked Pruning & Fast-Shedding', () => {
    it('triggers chunked pruning at 80% watermark down to 60%', async () => {
      // 100KB max quota
      const maxBytes = 100 * 1024;
      const disk = new DiskTier({
        dir: tmpDir,
        maxBytes,
        entryMaxBytes: 10 * 1024,
        logger: consoleLogger,
      });

      // Save entries until crossing 80KB (80% watermark)
      const payload = Buffer.alloc(2048, 'x');
      for (let i = 0; i < 45; i++) {
        await disk.save(`key:${i}`, {
          data: payload,
          isCompressed: false,
          expiresAt: Date.now() + 60_000,
          size: payload.length,
          hits: 1,
          lastAccess: Date.now(),
          priority: 1,
        });
      }

      // Check stats: entries were written
      const statsBefore = disk.stats;
      expect(statsBefore.sizeKB).toBeGreaterThan(0);

      // Trigger chunked prune down to 60%
      await disk.triggerChunkedPrune();

      const statsAfter = disk.stats;
      // Should be trimmed down towards 60% watermark (<= 60KB)
      expect(statsAfter.sizeKB).toBeLessThanOrEqual(Math.round(maxBytes * 0.60 / 1024) + 5);
      expect(disk.stats.pruning?.pruneRounds).toBeGreaterThanOrEqual(1);
      expect(disk.stats.pruning?.entriesPruned).toBeGreaterThan(0);

      disk.close();
    });

    it('fast-sheds incoming spills while pruning is active or quota is reached', async () => {
      const maxBytes = 50 * 1024;
      const disk = new DiskTier({
        dir: tmpDir,
        maxBytes,
        entryMaxBytes: 10 * 1024,
        logger: consoleLogger,
      });

      // 1. Simulate active pruning state
      (disk as any)._isPruning = true;
      expect(disk.isPruning).toBe(true);

      const initialShed = disk.spillsShedTotal;
      const payload = Buffer.alloc(1024, 'a');
      await disk.save('shed:during:pruning', {
        data: payload,
        isCompressed: false,
        expiresAt: Date.now() + 60_000,
        size: payload.length,
        hits: 1,
        lastAccess: Date.now(),
        priority: 1,
      });

      expect(disk.spillsShedTotal).toBe(initialShed + 1);
      (disk as any)._isPruning = false;

      // 2. Simulate diskUsageBytes >= maxBytes
      (disk as any).diskUsageBytes = maxBytes + 100;
      await disk.save('shed:quota:exceeded', {
        data: payload,
        isCompressed: false,
        expiresAt: Date.now() + 60_000,
        size: payload.length,
        hits: 1,
        lastAccess: Date.now(),
        priority: 1,
      });
      expect(disk.spillsShedTotal).toBe(initialShed + 2);

      disk.close();
    });
  });

  describe('Proactive Host Volume statfs Check (<10% free space)', () => {
    it('pauses disk spills when host volume free space drops below 10%', async () => {
      const disk = new DiskTier({
        dir: tmpDir,
        maxBytes: 100 * 1024 * 1024,
        entryMaxBytes: 10 * 1024,
        logger: consoleLogger,
      });

      // Mock statfsSync returning <10% available blocks (e.g. 5% free)
      const statfsSpy = vi.spyOn(fs, 'statfsSync').mockReturnValue({
        blocks: BigInt(1000),
        bavail: BigInt(50), // 5% available
        bfree: BigInt(50),
        bsize: BigInt(4096),
      } as unknown as fs.StatsFs);

      const ok = disk.checkHostVolumeHealth();
      expect(ok).toBe(false);
      expect(disk.hostVolumeLowSpace).toBe(true);

      const initialShed = disk.spillsShedTotal;

      // Attempt to save an entry: should fast-shed immediately without I/O
      await disk.save('paused:key', {
        data: Buffer.from('some-data'),
        isCompressed: false,
        expiresAt: Date.now() + 60_000,
        size: 9,
        hits: 1,
        lastAccess: Date.now(),
        priority: 1,
      });

      expect(disk.spillsShedTotal).toBe(initialShed + 1);

      // Simulate recovery: statfs returns 20% available space
      statfsSpy.mockReturnValue({
        blocks: BigInt(1000),
        bavail: BigInt(200), // 20% available
        bfree: BigInt(200),
        bsize: BigInt(4096),
      } as unknown as fs.StatsFs);

      const recovered = disk.checkHostVolumeHealth();
      expect(recovered).toBe(true);
      expect(disk.hostVolumeLowSpace).toBe(false);

      disk.close();
    });
  });

  describe('Hard Separation of Liveness vs. Readiness', () => {
    const ns = 'test-probe-separation';
    afterEach(() => {
      CacheService.reset({ namespace: ns });
    });

    it('cache.health() reports degraded: false when cache is fully healthy', () => {
      const cache = new CacheService({
        namespace: ns,
        disableRedis: true,
      });

      const h = cache.health();
      expect(h.healthy).toBe(true);
      expect(h.degraded).toBe(false);
      expect(h.reasons).toEqual([]);
    });

    it('preserves healthy: true by default when degraded, protecting Kubernetes Liveness probes', () => {
      const cache = new CacheService({
        namespace: ns,
        redisHost: '127.0.0.1', // Enable Redis path in watchdog
        disableRedis: false,
      });

      // Trip the watchdog to Stage 1 (degraded)
      const watchdog = cache.getLatencyWatchdog();
      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(20.0);
        watchdog.recordRedis(1.0);
      }
      expect(watchdog.getTelemetry().bypassActive).toBe(true);

      const h = cache.health();
      expect(h.degraded).toBe(true);
      expect(h.reasons).toContain('disk_latency_bypass_stage_1');

      // CRITICAL: healthy MUST remain true so Liveness probe (/healthz) does NOT kill container
      expect(h.healthy).toBe(true);
    });

    it('sets healthy: false only when failReadinessOnDegraded is explicitly configured for /ready probes', () => {
      const cache = new CacheService({
        namespace: ns,
        redisHost: '127.0.0.1',
        disableRedis: false,
        failReadinessOnDegraded: true, // SRE configured for Kubernetes Readiness probe
      });

      const watchdog = cache.getLatencyWatchdog();
      for (let i = 0; i < 32; i++) {
        watchdog.recordDisk(20.0);
        watchdog.recordRedis(1.0);
      }
      expect(watchdog.getTelemetry().bypassActive).toBe(true);

      const h = cache.health();
      expect(h.degraded).toBe(true);
      // Readiness fails -> K8s service ingress sheds traffic while pod heals
      expect(h.healthy).toBe(false);
      expect(h.reasons).toContain('disk_latency_bypass_stage_1');
    });
  });
});
