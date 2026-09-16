import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiskTier } from '../src/disk-tier';
import { CachePriority, consoleLogger } from '../src/types';
import type { SmartCacheEntry } from '../src/types';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';
import { pack, unpack } from 'msgpackr';

function tempDir() {
  return join(tmpdir(), `tricache-prio-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeEntry(value: string, priority: CachePriority, lastAccess = Date.now(), ttlMs = 600_000): SmartCacheEntry {
  const data = pack(value);
  const size = data.byteLength;
  return {
    data,
    isCompressed: true,
    expiresAt: Date.now() + ttlMs,
    size,
    hits: 1,
    lastAccess,
    priority,
  };
}

describe('DiskTier Priority-Aware Partitioned Pruning (Phase 1.3)', () => {
  let dir: string;
  let disk: DiskTier;

  beforeEach(() => {
    dir = tempDir();
    // Configure small maxBytes to easily trigger watermarks
    disk = new DiskTier({
      dir,
      maxBytes: 10 * 1024 * 1024,
      entryMaxBytes: 1024 * 1024,
      forbiddenPrefixes: [],
      logger: consoleLogger,
    });
  });

  afterEach(() => {
    try {
      disk.close();
    } catch {}
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  it('prunes lowest priority entries first before touching high priority entries', async () => {
    // Save 3 entries with different priorities
    await disk.save('item:low', makeEntry('low_prio_payload', CachePriority.LOW));
    await disk.save('item:normal', makeEntry('normal_prio_payload', CachePriority.NORMAL));
    await disk.save('item:critical', makeEntry('critical_prio_payload', CachePriority.CRITICAL));

    // Verify all 3 exist
    expect(disk.load('item:low')).not.toBeNull();
    expect(disk.load('item:normal')).not.toBeNull();
    expect(disk.load('item:critical')).not.toBeNull();

    // Re-save so they are on disk again (load removes them for L1 promotion)
    await disk.save('item:low', makeEntry('low_prio_payload', CachePriority.LOW));
    await disk.save('item:normal', makeEntry('normal_prio_payload', CachePriority.NORMAL));
    await disk.save('item:critical', makeEntry('critical_prio_payload', CachePriority.CRITICAL));

    // Simulate disk pressure: set maxBytes so targetBytes is ~75% of current size (pruning 1 of 3 entries)
    const currentBytes = (disk as any).diskUsageBytes;
    (disk as any).opts.maxBytes = Math.floor(currentBytes * 1.25);

    // Trigger prune
    const pruned = await disk.triggerChunkedPrune();
    expect(pruned).toBeGreaterThan(0);

    // If SQLite is available, item:low must be evicted first
    if (disk.indexMode === 'sqlite') {
      const lowLoaded = disk.load('item:low');
      const criticalLoaded = disk.load('item:critical');

      // item:critical should still be on disk, item:low should be pruned
      expect(criticalLoaded).not.toBeNull();
      if (criticalLoaded) {
        expect(unpack(criticalLoaded.data as Buffer)).toBe('critical_prio_payload');
      }
      expect(lowLoaded).toBeNull();
    }
  });

  it('orders pruning by last_accessed_at when priority is equal', async () => {
    const olderTime = Date.now() - 100_000;
    const newerTime = Date.now();

    await disk.save('item:old', makeEntry('old_payload', CachePriority.NORMAL, olderTime));
    await disk.save('item:recent', makeEntry('recent_payload', CachePriority.NORMAL, newerTime));

    // Simulate pressure: set maxBytes so targetBytes is ~75% of current size (prunes 1 of 2 equal entries)
    const currentBytes = (disk as any).diskUsageBytes;
    (disk as any).opts.maxBytes = Math.floor(currentBytes * 1.25);

    const pruned = await disk.triggerChunkedPrune();
    expect(pruned).toBeGreaterThan(0);

    if (disk.indexMode === 'sqlite') {
      const oldLoaded = disk.load('item:old');
      const recentLoaded = disk.load('item:recent');

      // Older item should be pruned before more recent item
      expect(oldLoaded).toBeNull();
      expect(recentLoaded).not.toBeNull();
      if (recentLoaded) {
        expect(unpack(recentLoaded.data as Buffer)).toBe('recent_payload');
      }
    }
  });
});
