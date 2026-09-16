import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveDefaultDiskDir } from '../src/disk-tier';

describe('resolveDefaultDiskDir (/dev/shm tmpfs resolver)', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.restoreAllMocks();
  });

  it('falls back to os.tmpdir() on non-Linux platforms (e.g. win32 / darwin)', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const result = resolveDefaultDiskDir('test-ns');
    expect(result.isShm).toBe(false);
    expect(result.dir).toBe(path.join(os.tmpdir(), 'tricache-disk-test-ns'));
  });

  it('falls back to os.tmpdir() on Linux if /dev/shm is not accessible', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(fs, 'accessSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = resolveDefaultDiskDir('test-ns');
    expect(result.isShm).toBe(false);
    expect(result.dir).toBe(path.join(os.tmpdir(), 'tricache-disk-test-ns'));
  });

  it('falls back to os.tmpdir() if total capacity is less than 256MB (e.g. 64MB default Docker)', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(fs, 'accessSync').mockReturnValue(undefined);

    // 64MB total, 60MB free
    vi.spyOn(fs, 'statfsSync').mockReturnValue({
      bsize: 4096,
      blocks: 16384, // 64 MB
      bavail: 15360, // 60 MB
    } as any);

    const result = resolveDefaultDiskDir('test-ns');
    expect(result.isShm).toBe(false);
    expect(result.dir).toBe(path.join(os.tmpdir(), 'tricache-disk-test-ns'));
  });

  it('falls back to os.tmpdir() if total capacity is >=256MB but free space is under 128MB', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(fs, 'accessSync').mockReturnValue(undefined);

    // 1GB total, but only 50MB free (noisy neighbor filled /dev/shm)
    vi.spyOn(fs, 'statfsSync').mockReturnValue({
      bsize: 4096,
      blocks: 262144, // 1024 MB
      bavail: 12800,  // 50 MB
    } as any);

    const result = resolveDefaultDiskDir('test-ns');
    expect(result.isShm).toBe(false);
    expect(result.dir).toBe(path.join(os.tmpdir(), 'tricache-disk-test-ns'));
  });

  it('successfully selects /dev/shm when total capacity is >=256MB and free space is >=128MB', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(fs, 'accessSync').mockReturnValue(undefined);

    // 1GB total, 512MB free
    vi.spyOn(fs, 'statfsSync').mockReturnValue({
      bsize: 4096,
      blocks: 262144, // 1024 MB
      bavail: 131072, // 512 MB
    } as any);

    const result = resolveDefaultDiskDir('prod-ns');
    expect(result.isShm).toBe(true);
    expect(result.dir).toBe(path.join('/dev/shm', 'tricache-disk-prod-ns'));
  });

  it('handles empty or missing namespace correctly', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(fs, 'accessSync').mockReturnValue(undefined);

    vi.spyOn(fs, 'statfsSync').mockReturnValue({
      bsize: 4096,
      blocks: 262144, // 1024 MB
      bavail: 131072, // 512 MB
    } as any);

    const result = resolveDefaultDiskDir();
    expect(result.isShm).toBe(true);
    expect(result.dir).toBe(path.join('/dev/shm', 'tricache-disk'));
  });
});
