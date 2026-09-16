import { describe, it, expect, vi, afterEach } from 'vitest';
import { runCli } from '../src/cli.js';
import { CacheService } from '../src/cache-service.js';
import { resolveIpcSocketPath, IpcTelemetryServer } from '../src/ipc-telemetry.js';

describe('TriCache CLI Top Monitor (tests/cli-top.test.ts)', () => {
  let activeCaches: CacheService[] = [];
  let activeServers: IpcTelemetryServer[] = [];

  afterEach(async () => {
    for (const server of activeServers) {
      await server.close();
    }
    activeServers = [];

    for (const cache of activeCaches) {
      await cache.destroy();
    }
    activeCaches = [];
  });

  it('prints top command help in tricache --help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['--help']);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('top        Live ASCII terminal dashboard monitoring an active TriCache process');
    expect(output).toContain('--socket');
    expect(output).toContain('--pid');
    expect(output).toContain('--once');
    logSpy.mockRestore();
  });

  it('runs tricache top --once against an active IPC server', async () => {
    const socketPath = resolveIpcSocketPath(`cli-top-test-${Date.now()}`);
    const cache = new CacheService({
      namespace: 'test-cli-top',
      disableRedis: true,
      enableIpc: true,
      ipcSocketPath: socketPath,
    });
    activeCaches.push(cache);

    // Warm cache with a few operations
    await cache.set('user:101', { name: 'Alice' }, 60);
    await cache.get('user:101', async () => ({ name: 'Alice' }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['top', '--once', '--socket', socketPath]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('TriCache Monitor');
    expect(output).toContain('Namespace: test-cli-top');
    expect(output).toContain('L1 (RAM):');

    logSpy.mockRestore();
  });

  it('runs tricache top --once --json and outputs valid JSON metrics', async () => {
    const socketPath = resolveIpcSocketPath(`cli-top-json-${Date.now()}`);
    const cache = new CacheService({
      namespace: 'json-telemetry-test',
      disableRedis: true,
      enableIpc: true,
      ipcSocketPath: socketPath,
    });
    activeCaches.push(cache);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['top', '--once', '--json', '--socket', socketPath]);

    expect(logSpy).toHaveBeenCalled();
    const rawOutput = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(rawOutput);

    expect(parsed.namespace).toBe('json-telemetry-test');
    expect(parsed.metrics).toBeDefined();
    expect(parsed.metrics.gets).toBeDefined();
    expect(parsed.pid).toBe(process.pid);

    logSpy.mockRestore();
  });

  it('exposes active IPC server instance via cache.getIpcServer() when enableIpc is true', async () => {
    const socketPath = resolveIpcSocketPath(`srv-getter-${Date.now()}`);
    const cache = new CacheService({
      namespace: 'getter-test',
      disableRedis: true,
      enableIpc: true,
      ipcSocketPath: socketPath,
    });
    activeCaches.push(cache);

    const ipcServer = cache.getIpcServer();
    expect(ipcServer).toBeDefined();
    expect(ipcServer?.isListening).toBe(true);
    expect(ipcServer?.socketPath).toBe(socketPath);

    await cache.destroy();
    expect(ipcServer?.isListening).toBe(false);
  });
});
