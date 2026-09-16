import { describe, it, expect } from 'vitest';
import { AutoPipeliner } from '../src/adapters/auto-pipeliner';
import type { IRedisDriver, IRedisPipeline } from '../src/types';

function createMockRedisDriver() {
  const store = new Map<string, string>();
  let pipelineExecCalls = 0;

  const mockPipeline: IRedisPipeline = {
    ops: [] as Array<() => [Error | null, any]>,
    get(key: string) {
      this.ops.push(() => [null, store.get(key) ?? null]);
      return this;
    },
    set(key: string, value: string) {
      this.ops.push(() => {
        store.set(key, value);
        return [null, 'OK'];
      });
      return this;
    },
    setex(key: string, _seconds: number, value: string) {
      this.ops.push(() => {
        store.set(key, value);
        return [null, 'OK'];
      });
      return this;
    },
    del(...keys: string[]) {
      this.ops.push(() => {
        let count = 0;
        for (const k of keys) {
          if (store.delete(k)) count++;
        }
        return [null, count];
      });
      return this;
    },
    expire() { return this; },
    incr() { return this; },
    sadd() { return this; },
    smembers() { return this; },
    hset() { return this; },
    async exec() {
      pipelineExecCalls++;
      const results = this.ops.map((op: () => [Error | null, any]) => op());
      this.ops = [];
      return results;
    },
  } as any;

  const mockDriver: Partial<IRedisDriver> = {
    pipeline() {
      return mockPipeline;
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
    async del(...keys: string[]) {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    },
    disconnect() {},
  };

  return { driver: mockDriver as IRedisDriver, store, getPipelineExecCalls: () => pipelineExecCalls };
}

describe('AutoPipeliner (Microtask-Coalesced Redis Request Batching)', () => {
  it('coalesces multiple concurrent GET operations into a single pipeline.exec() call', async () => {
    const { driver, store, getPipelineExecCalls } = createMockRedisDriver();
    store.set('user:1', 'Alice');
    store.set('user:2', 'Bob');
    store.set('user:3', 'Charlie');

    const pipeliner = new AutoPipeliner(driver, { maxBatchSize: 100 });

    // Issue 3 simultaneous GETs in the same synchronous execution tick
    const p1 = pipeliner.get('user:1');
    const p2 = pipeliner.get('user:2');
    const p3 = pipeliner.get('user:3');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).toBe('Alice');
    expect(r2).toBe('Bob');
    expect(r3).toBe('Charlie');

    // Exactly 1 pipeline network execution took place
    expect(getPipelineExecCalls()).toBe(1);
    expect(pipeliner.stats.batchesDispatched).toBe(1);
    expect(pipeliner.stats.operationsBatched).toBe(3);
  });

  it('coalesces mixed GET, SETEX, and DEL operations', async () => {
    const { driver, store, getPipelineExecCalls } = createMockRedisDriver();
    store.set('session:old', 'expired_data');

    const pipeliner = new AutoPipeliner(driver, { maxBatchSize: 100 });

    const pSet = pipeliner.setex('session:new', 300, 'active_data');
    const pGet = pipeliner.get('session:old');
    const pDel = pipeliner.del('session:old');

    const [, getResult, delResult] = await Promise.all([pSet, pGet, pDel]);

    expect(getResult).toBe('expired_data');
    expect(delResult).toBe(1);
    expect(store.get('session:new')).toBe('active_data');
    expect(store.has('session:old')).toBe(false);

    expect(getPipelineExecCalls()).toBe(1);
    expect(pipeliner.stats.operationsBatched).toBe(3);
  });

  it('triggers immediate flush when MAX_BATCH_SIZE is reached without waiting for microtask', async () => {
    const { driver, store, getPipelineExecCalls } = createMockRedisDriver();
    for (let i = 0; i < 25; i++) {
      store.set(`k:${i}`, `v:${i}`);
    }

    // Set maxBatchSize to 10
    const pipeliner = new AutoPipeliner(driver, { maxBatchSize: 10 });

    const promises: Promise<string | null>[] = [];
    for (let i = 0; i < 25; i++) {
      promises.push(pipeliner.get(`k:${i}`));
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(25);
    expect(results[0]).toBe('v:0');
    expect(results[24]).toBe('v:24');

    // 25 operations with batch limit 10 should trigger 3 batches (10 + 10 + 5)
    expect(getPipelineExecCalls()).toBe(3);
    expect(pipeliner.stats.batchesDispatched).toBe(3);
    expect(pipeliner.stats.operationsBatched).toBe(25);
  });

  it('bypasses pipelining and calls direct driver methods when disabled', async () => {
    const { driver, store, getPipelineExecCalls } = createMockRedisDriver();
    store.set('bypass:1', 'direct_val');

    const pipeliner = new AutoPipeliner(driver, { enabled: false });

    const val = await pipeliner.get('bypass:1');
    expect(val).toBe('direct_val');
    // Pipeline was not used
    expect(getPipelineExecCalls()).toBe(0);
  });
});
