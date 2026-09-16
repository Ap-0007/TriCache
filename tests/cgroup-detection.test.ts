import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  readCgroupMemoryLimit,
  resolveAutonomousL1MaxBytes,
  DEFAULT_AUTONOMOUS_L1_CEILING_BYTES,
  MIN_AUTONOMOUS_L1_FLOOR_BYTES,
} from '../src/utils/cgroup';

describe('Autonomous Cgroup & V8 Memory Sizing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Infinity when not running on Linux', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    expect(readCgroupMemoryLimit()).toBe(Infinity);
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('reads cgroup v2 memory.max limit when available on Linux', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/sys/fs/cgroup/memory.max');
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p === '/sys/fs/cgroup/memory.max') return '1073741824\n'; // 1GB
      throw new Error('ENOENT');
    });

    const limit = readCgroupMemoryLimit();
    expect(limit).toBe(1073741824);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns Infinity for cgroup v2 "max" (unbounded)', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/sys/fs/cgroup/memory.max');
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p === '/sys/fs/cgroup/memory.max') return 'max\n';
      throw new Error('ENOENT');
    });

    const limit = readCgroupMemoryLimit();
    expect(limit).toBe(Infinity);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('falls back to cgroup v1 when v2 is absent', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/sys/fs/cgroup/memory/memory.limit_in_bytes');
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p === '/sys/fs/cgroup/memory/memory.limit_in_bytes') return '2147483648\n'; // 2GB
      throw new Error('ENOENT');
    });

    const limit = readCgroupMemoryLimit();
    expect(limit).toBe(2147483648);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('handles EACCES and permission errors gracefully without throwing', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    vi.spyOn(fs, 'existsSync').mockImplementation(() => {
      const err = new Error('EACCES: permission denied');
      (err as any).code = 'EACCES';
      throw err;
    });

    expect(readCgroupMemoryLimit()).toBe(Infinity);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  describe('resolveAutonomousL1MaxBytes dual-constraint formula', () => {
    it('constrains against V8 heap limit when smaller than cgroup capacity', () => {
      // Container has 4GB RAM, but Node launched with --max-old-space-size=512 (512MB heap limit)
      const cgroupLimit = 4 * 1024 * 1024 * 1024; // 4GB
      const v8HeapLimit = 512 * 1024 * 1024;       // 512MB
      // cgroupCap = 4GB * 0.40 = 1.6GB
      // v8Cap = 512MB * 0.50 = 256MB
      // ceiling = 512MB
      // expected = min(1.6GB, 256MB, 512MB) = 256MB
      const resolved = resolveAutonomousL1MaxBytes({ cgroupLimit, v8HeapLimit });
      expect(resolved).toBe(256 * 1024 * 1024);
    });

    it('constrains against cgroup capacity when container memory is tight', () => {
      // Container has 256MB RAM, V8 default heap is 2GB
      const cgroupLimit = 256 * 1024 * 1024;       // 256MB
      const v8HeapLimit = 2 * 1024 * 1024 * 1024;  // 2GB
      // cgroupCap = 256MB * 0.40 = 102.4MB
      // v8Cap = 2GB * 0.50 = 1GB
      // expected = Math.floor(102.4MB)
      const resolved = resolveAutonomousL1MaxBytes({ cgroupLimit, v8HeapLimit });
      expect(resolved).toBe(Math.floor(256 * 1024 * 1024 * 0.40));
    });

    it('clamps to default ceiling when cgroup and V8 limits are massive/unbounded', () => {
      const resolved = resolveAutonomousL1MaxBytes({
        cgroupLimit: Infinity,
        v8HeapLimit: Infinity,
      });
      expect(resolved).toBe(DEFAULT_AUTONOMOUS_L1_CEILING_BYTES);
    });

    it('respects minimum floor of 16MB on tiny limits', () => {
      const resolved = resolveAutonomousL1MaxBytes({
        cgroupLimit: 10 * 1024 * 1024, // 10MB container
        v8HeapLimit: 10 * 1024 * 1024,
      });
      expect(resolved).toBe(MIN_AUTONOMOUS_L1_FLOOR_BYTES);
    });
  });
});
