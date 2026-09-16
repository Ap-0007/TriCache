import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  resolveIpcSocketPath,
  IpcTelemetryServer,
  IpcTelemetryClient,
  renderProgressBar,
  formatBytes,
  formatDuration,
  formatNumber,
  renderTopDashboard,
  findActiveSockets,
  type IIpcCacheProvider,
  type IpcMetricsPayload,
} from '../src/ipc-telemetry.js';
import type { CacheMetrics, CacheHealthStatus } from '../src/types.js';

describe('IPC Telemetry Bridge (src/ipc-telemetry.ts)', () => {
  let activeServers: IpcTelemetryServer[] = [];

  afterEach(async () => {
    for (const server of activeServers) {
      await server.close();
    }
    activeServers = [];
  });

  function createMockMetrics(): CacheMetrics {
    return {
      uptimeMs: 125_000,
      namespace: 'test-ipc-suite',
      gets: {
        total: 1000,
        l1Hits: 600,
        l1HitRate: 0.6,
        diskHits: 200,
        diskHitRate: 0.2,
        l2Hits: 100,
        l2HitRate: 0.1,
        fetches: 100,
        fetchRate: 0.1,
        stampedePrevented: 45,
      },
      sets: { total: 150 },
      deletes: { total: 20 },
      revalidations: { total: 10 },
      counters: { errors: 0, singletonDivergences: 0 },
      bloom: { checksTotal: 800, falsePositives: 4, falsePositiveRate: 0.005 },
      compression: { entriesCompressed: 300, entriesUncompressed: 50, bytesSaved: 45_000 },
      backplane: { enabled: true, mode: 'pubsub', sent: 15, received: 12, skipped: 3 },
      l2CircuitBreaker: { state: 'closed' },
      oom: { enabled: true, evictions: 0, lastTriggeredAt: null },
      l1: { entries: 500, sizeBytes: 12 * 1024 * 1024, maxBytes: 128 * 1024 * 1024 },
      disk: {
        files: 25,
        sizeKB: 2500,
        maxKB: 500000,
        disabled: false,
        latencyWatchdog: {
          bypassActive: false,
          bypassStage: 0,
          bypassedTotal: 0,
          diskP95Ms: 1.45,
          redisP95Ms: 0.85,
          redisDampened: false,
        },
      },
    };
  }

  function createMockCacheProvider(): IIpcCacheProvider {
    const metrics = createMockMetrics();
    return {
      options: {
        namespace: 'test-ipc-suite',
        l1MaxBytes: 128 * 1024 * 1024,
      },
      metrics: () => metrics,
      stats: () => ({
        l1: { entries: 500, sizeKB: 12288 },
        disk: { files: 25, sizeKB: 2500 },
      }),
      hotKeys: () => [
        { key: 'user:session:1234', hits: 1500, sizeBytes: 2048 },
        { key: 'tenant:config:prod', hits: 980, sizeBytes: 8192 },
      ],
      health: (): CacheHealthStatus => ({
        healthy: true,
        degraded: false,
        reasons: [],
        details: {
          redisConnected: true,
          circuitBreakerState: 'closed',
          diskPruningActive: false,
          diskHostVolumeLowSpace: false,
          watchdog: {
            bypassActive: false,
            bypassStage: 0,
            bypassedTotal: 0,
            diskP95Ms: 1.45,
            redisP95Ms: 0.85,
            redisDampened: false,
          },
        },
      }),
    };
  }

  it('resolves platform-agnostic socket/pipe paths correctly', () => {
    const testId = 98765;
    const resolved = resolveIpcSocketPath(testId);
    if (process.platform === 'win32') {
      expect(resolved).toBe(`\\\\.\\pipe\\tricache-${testId}`);
    } else {
      expect(resolved).toMatch(new RegExp(`tricache-${testId}\\.sock$`));
    }
  });

  it('starts IPC server and responds to PING and GET_METRICS commands', async () => {
    const mockProvider = createMockCacheProvider();
    const testSocketPath = resolveIpcSocketPath(`test-srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

    const server = new IpcTelemetryServer(mockProvider, testSocketPath);
    activeServers.push(server);
    await server.start();
    expect(server.isListening).toBe(true);

    const client = new IpcTelemetryClient(testSocketPath);

    // 1. PING
    const pingMs = await client.ping();
    expect(pingMs).toBeGreaterThanOrEqual(0);

    // 2. GET_METRICS
    const payload = await client.getMetrics();
    expect(payload.pid).toBe(process.pid);
    expect(payload.namespace).toBe('test-ipc-suite');
    expect(payload.metrics.gets.total).toBe(1000);
    expect(payload.metrics.gets.l1HitRate).toBe(0.6);
    expect(payload.hotKeys).toBeDefined();
    expect(payload.hotKeys?.length).toBe(2);
    expect(payload.hotKeys?.[0].key).toBe('user:session:1234');
    expect(payload.health?.healthy).toBe(true);

    await server.close();
    expect(server.isListening).toBe(false);
  });

  it('executes telemetry pulling on non-blocking tick boundaries (setImmediate)', async () => {
    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate');
    const mockProvider = createMockCacheProvider();
    const testSocketPath = resolveIpcSocketPath(`test-tick-${Date.now()}`);

    const server = new IpcTelemetryServer(mockProvider, testSocketPath);
    activeServers.push(server);
    await server.start();

    const client = new IpcTelemetryClient(testSocketPath);
    const payload = await client.getMetrics();

    expect(payload).toBeDefined();
    expect(setImmediateSpy).toHaveBeenCalled();
    setImmediateSpy.mockRestore();

    await server.close();
  });

  it('performs socket hygiene on close and teardown', async () => {
    const mockProvider = createMockCacheProvider();
    const testSocketPath = resolveIpcSocketPath(`test-hygiene-${Date.now()}`);

    const server = new IpcTelemetryServer(mockProvider, testSocketPath);
    activeServers.push(server);
    await server.start();

    if (process.platform !== 'win32') {
      expect(fs.existsSync(testSocketPath)).toBe(true);
    }

    await server.close();

    if (process.platform !== 'win32') {
      expect(fs.existsSync(testSocketPath)).toBe(false);
    }
  });

  it('discovers active sockets with findActiveSockets', async () => {
    const mockProvider = createMockCacheProvider();
    const testSocketPath = resolveIpcSocketPath(process.pid);

    const server = new IpcTelemetryServer(mockProvider, testSocketPath);
    activeServers.push(server);
    await server.start();

    const active = await findActiveSockets();
    expect(active).toContain(testSocketPath);

    await server.close();
  });

  describe('CLI Top Rendering Helpers', () => {
    it('renders progress bar with accurate proportions', () => {
      expect(renderProgressBar(0, 10)).toBe('░░░░░░░░░░');
      expect(renderProgressBar(1, 10)).toBe('██████████');
      expect(renderProgressBar(0.5, 10)).toBe('█████░░░░░');
      expect(renderProgressBar(-0.2, 10)).toBe('░░░░░░░░░░');
      expect(renderProgressBar(1.5, 10)).toBe('██████████');
    });

    it('formats bytes into readable units', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(2048)).toBe('2.0 KB');
      expect(formatBytes(15 * 1024 * 1024)).toBe('15.0 MB');
      expect(formatBytes(4 * 1024 * 1024 * 1024)).toBe('4.00 GB');
    });

    it('formats duration into readable units', () => {
      expect(formatDuration(400)).toBe('400ms');
      expect(formatDuration(45_000)).toBe('45s');
      expect(formatDuration(130_000)).toBe('2m 10s');
      expect(formatDuration(7_200_000)).toBe('2h 0m');
    });

    it('formats numbers with thousand separators', () => {
      expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
    });

    it('renders complete ASCII dashboard layout', () => {
      const mockPayload: IpcMetricsPayload = {
        pid: 4321,
        uptimeMs: 75_000,
        timestamp: Date.now(),
        namespace: 'prod-api',
        metrics: createMockMetrics(),
        hotKeys: [
          { key: 'auth:token:abcdef', hits: 520, sizeBytes: 1024 },
        ],
      };

      const dashboard = renderTopDashboard(mockPayload);
      expect(dashboard).toContain('TriCache Monitor [PID: 4321  ]');
      expect(dashboard).toContain('Namespace: prod-api');
      expect(dashboard).toContain('L1 (RAM):');
      expect(dashboard).toContain('L1.5(Disk):');
      expect(dashboard).toContain('L2 (Redis):');
      expect(dashboard).toContain('Memory & Storage Headroom');
      expect(dashboard).toContain('Watchdog:');
      expect(dashboard).toContain('Top Hot Keys (Count-Min Sketch)');
      expect(dashboard).toContain('auth:token:abcdef');
    });
  });
});
