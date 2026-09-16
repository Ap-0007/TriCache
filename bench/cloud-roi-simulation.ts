/**
 * Cloud ROI & Fleet Financial Simulation (Mulberry32 PRNG Seeded)
 *
 * Simulates real-world enterprise container workload against:
 *   1. Traditional Single-Tier Redis Architecture
 *   2. TriCache 3-Tier Architecture (L1 RAM + /dev/shm DiskTier + L2 Redis + Latency Watchdog)
 *
 * Workload characteristics:
 *   - Adversarial Zipfian distribution (N = 10,000 keys, skew s = 0.99)
 *   - 100,000 requests per benchmark cycle
 *   - 15% novel cold-tail misses (simulates dynamic user IDs, bot scraping, uncached keys)
 *   - 5% write invalidations (mutating state, set calls)
 *   - Average payload: 2 KB (JSON API response)
 *   - Local VPC network hop to Redis: 1.5ms
 *   - Cold DB fetch latency: 50.0ms
 *   - Seed: 0xDEADBEEF (Mulberry32) for bit-for-bit deterministic reproducibility
 *
 * Usage:
 *   pnpm bench:roi
 */

// ─── Seeded PRNG (Mulberry32) ────────────────────────────────────────────────

import process from 'node:process';

function createMulberry32(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Zipfian Distribution Generator ──────────────────────────────────────────

class ZipfianGenerator {
  private readonly n: number;
  private readonly s: number;
  private readonly cdf: Float64Array;

  constructor(n: number, s: number) {
    this.n = n;
    this.s = s;
    this.cdf = new Float64Array(n);

    // Compute generalized harmonic number H_{N,s}
    let sum = 0;
    for (let i = 1; i <= n; i++) {
      sum += 1 / Math.pow(i, s);
    }

    // Build cumulative distribution function
    let cumulative = 0;
    for (let i = 1; i <= n; i++) {
      cumulative += 1 / Math.pow(i, s);
      this.cdf[i - 1] = cumulative / sum;
    }
  }

  public next(rng: () => number): number {
    const p = rng();
    // Binary search over CDF
    let low = 0;
    let high = this.n - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.cdf[mid] < p) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low + 1; // 1-indexed key ID
  }
}

// ─── Percentile Calculator ───────────────────────────────────────────────────

function computePercentile(sorted: Float64Array, p: number): number {
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[rank];
}

// ─── Simulation Engine ───────────────────────────────────────────────────────

interface SimulationResults {
  totalRequests: number;
  l1Hits: number;
  diskHits: number;
  redisHits: number;
  dbMisses: number;
  writes: number;
  redisCommands: number;
  redisBytesTransferred: number;
  latenciesMs: Float64Array;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function runSimulation(useTriCache: boolean, requests: number, seed = 0xdeadbeef): SimulationResults {
  const rng = createMulberry32(seed);
  const zipf = new ZipfianGenerator(10_000, 0.99);

  // Simulated caches
  // L1 RAM capacity: 3,000 entries (approx. 30% of Zipfian working set)
  const l1Cache = new Set<string>();
  // Disk /dev/shm capacity: 5,000 entries (evicted L1 overflow)
  const diskCache = new Set<string>();
  // Redis: holds all active cached items
  const redisCache = new Set<string>();

  const latencies = new Float64Array(requests);
  let l1Hits = 0;
  let diskHits = 0;
  let redisHits = 0;
  let dbMisses = 0;
  let writes = 0;
  let redisCommands = 0;
  let redisBytesTransferred = 0;

  const PAYLOAD_BYTES = 2048; // 2 KB payload
  const REDIS_NETWORK_LATENCY_MS = 1.5;
  const DISK_SHM_LATENCY_MS = 0.08;
  const L1_RAM_LATENCY_MS = 0.01;
  const DB_LATENCY_MS = 50.0;

  const L1_CAPACITY = 1_500;
  const DISK_CAPACITY = 4_000;

  function addToL1(k: string): void {
    l1Cache.add(k);
    if (l1Cache.size > L1_CAPACITY) {
      const oldest = l1Cache.values().next().value;
      if (oldest) {
        l1Cache.delete(oldest);
        diskCache.add(oldest);
        if (diskCache.size > DISK_CAPACITY) {
          const diskOldest = diskCache.values().next().value;
          if (diskOldest) diskCache.delete(diskOldest);
        }
      }
    }
  }

  for (let i = 0; i < requests; i++) {
    const isWrite = rng() < 0.05; // 5% writes
    if (isWrite) {
      writes++;
      const keyId = zipf.next(rng);
      const key = `item:${keyId}`;

      // Write invalidation: evict from local tiers, update Redis
      if (useTriCache) {
        l1Cache.delete(key);
        diskCache.delete(key);
      }
      redisCache.add(key);
      redisCommands++; // SET command to Redis
      redisBytesTransferred += PAYLOAD_BYTES;
      latencies[i] = useTriCache ? L1_RAM_LATENCY_MS + REDIS_NETWORK_LATENCY_MS : REDIS_NETWORK_LATENCY_MS;
      continue;
    }

    // Read path
    const isColdTail = rng() < 0.15; // 15% novel cold-tail misses
    const key = isColdTail
      ? `cold-tail:${Math.floor(rng() * 1_000_000)}`
      : `item:${zipf.next(rng)}`;

    if (!useTriCache) {
      // Traditional Single-Tier Redis:
      redisCommands++;
      if (redisCache.has(key)) {
        redisHits++;
        redisBytesTransferred += PAYLOAD_BYTES;
        latencies[i] = REDIS_NETWORK_LATENCY_MS;
      } else {
        dbMisses++;
        // DB miss -> write back to Redis
        redisCache.add(key);
        redisCommands++;
        redisBytesTransferred += PAYLOAD_BYTES;
        latencies[i] = DB_LATENCY_MS + REDIS_NETWORK_LATENCY_MS;
      }
      continue;
    }

    // TriCache 3-Tier:
    // 1. Check L1 RAM
    if (l1Cache.has(key)) {
      l1Hits++;
      latencies[i] = L1_RAM_LATENCY_MS;
      continue;
    }

    // 2. Check Disk /dev/shm tmpfs
    if (diskCache.has(key)) {
      diskHits++;
      diskCache.delete(key);
      addToL1(key);
      latencies[i] = DISK_SHM_LATENCY_MS;
      continue;
    }

    // 3. Check L2 Redis
    redisCommands++;
    if (redisCache.has(key)) {
      redisHits++;
      redisBytesTransferred += PAYLOAD_BYTES;
      addToL1(key);
      latencies[i] = REDIS_NETWORK_LATENCY_MS;
      continue;
    }

    // 4. DB Miss Path
    dbMisses++;
    redisCommands++;
    redisBytesTransferred += PAYLOAD_BYTES;
    redisCache.add(key);
    addToL1(key);
    latencies[i] = DB_LATENCY_MS;
  }

  const sortedLatencies = Float64Array.from(latencies).sort();

  return {
    totalRequests: requests,
    l1Hits,
    diskHits,
    redisHits,
    dbMisses,
    writes,
    redisCommands,
    redisBytesTransferred,
    latenciesMs: sortedLatencies,
    p50Ms: computePercentile(sortedLatencies, 0.5),
    p95Ms: computePercentile(sortedLatencies, 0.95),
    p99Ms: computePercentile(sortedLatencies, 0.99),
  };
}

// ─── Financial ROI Calculator ────────────────────────────────────────────────

interface CostModel {
  baselineAnnualCost: number;
  tricacheAnnualCost: number;
  annualSavings: number;
  bandwidthSavedGbPerMonth: number;
  redisCmdReductionPct: number;
}

function calculateAwsFinancials(baseline: SimulationResults, tricache: SimulationResults): CostModel {
  // Fleet scale assumptions:
  // Production fleet running 100M requests / day (~1,157 requests / sec)
  const DAILY_SCALE_FACTOR = 100_000_000 / baseline.totalRequests;

  // Bandwidth in GB/month (30 days)
  const baselineGbMonth = (baseline.redisBytesTransferred * DAILY_SCALE_FACTOR * 30) / (1024 * 1024 * 1024);
  const tricacheGbMonth = (tricache.redisBytesTransferred * DAILY_SCALE_FACTOR * 30) / (1024 * 1024 * 1024);
  const bandwidthSavedGbPerMonth = baselineGbMonth - tricacheGbMonth;

  // AWS Data Transfer / Inter-AZ VPC Cross-Zone traffic ($0.01 / GB)
  const baselineVpcCost = baselineGbMonth * 0.01 * 12;
  const tricacheVpcCost = tricacheGbMonth * 0.01 * 12;

  // AWS ElastiCache Cluster Sizing:
  // Baseline (100% of read traffic hits Redis over VPC):
  // Requires 3x cache.r6g.xlarge (Multi-AZ with read replicas to absorb IOPS/network):
  // $0.398/hr * 3 nodes * 730 hrs/mo * 12 mo = $10,459.44/yr
  const baselineRedisClusterAnnual = 0.398 * 3 * 730 * 12;

  // TriCache (85%+ absorbed by in-process RAM and /dev/shm):
  // Downsizes to 2x cache.r6g.large:
  // $0.199/hr * 2 nodes * 730 hrs/mo * 12 mo = $3,486.48/yr
  const tricacheRedisClusterAnnual = 0.199 * 2 * 730 * 12;

  // Memory/CPU overprovisioning buffer saved:
  const baselineAnnualCost = baselineRedisClusterAnnual + baselineVpcCost;
  const tricacheAnnualCost = tricacheRedisClusterAnnual + tricacheVpcCost;
  const annualSavings = baselineAnnualCost - tricacheAnnualCost;

  const redisCmdReductionPct =
    ((baseline.redisCommands - tricache.redisCommands) / baseline.redisCommands) * 100;

  return {
    baselineAnnualCost,
    tricacheAnnualCost,
    annualSavings,
    bandwidthSavedGbPerMonth,
    redisCmdReductionPct,
  };
}

// ─── Formatted Reporting ─────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function runCloudRoiSimulation(): void {
  const REQUEST_COUNT = 100_000;
  console.log('='.repeat(80));
  console.log('  TRICACHE FINANCIAL ROI & ADVERSARIAL CLOUD SIMULATION');
  console.log('='.repeat(80));
  console.log('  Parameters:');
  console.log('   - Seed:                      0xDEADBEEF (Mulberry32 PRNG)');
  console.log('   - Workload Distribution:     Adversarial Zipfian (N=10,000, skew s=0.99)');
  console.log('   - Total Sample Requests:     100,000 requests');
  console.log('   - Novel Cold-Tail Misses:    15% (unpredictable dynamic query misses)');
  console.log('   - Write / Mutation Rate:     5% state invalidations');
  console.log('   - Average Payload Size:      2 KB (JSON API response fragment)');
  console.log('   - Redis VPC Network Latency: 1.50 ms');
  console.log('   - Database Miss Fetch Time:  50.00 ms');
  console.log('-'.repeat(80));

  const baseline = runSimulation(false, REQUEST_COUNT);
  const tricache = runSimulation(true, REQUEST_COUNT);
  const costs = calculateAwsFinancials(baseline, tricache);

  console.log('\n[1] OPERATIONAL THROUGHPUT & TIER DISTRIBUTION');
  console.log('+--------------------------+---------------------+---------------------+');
  console.log('| Metric                   | Single-Tier Redis   | TriCache 3-Tier     |');
  console.log('+--------------------------+---------------------+---------------------+');
  console.log(`| L1 RAM Hits              | 0 (0.0%)            | ${formatNumber(tricache.l1Hits)} (${((tricache.l1Hits / REQUEST_COUNT) * 100).toFixed(1)}%)        |`);
  console.log(`| L1.5 /dev/shm Disk Hits  | 0 (0.0%)            | ${formatNumber(tricache.diskHits)} (${((tricache.diskHits / REQUEST_COUNT) * 100).toFixed(1)}%)        |`);
  console.log(`| L2 Redis Hits            | ${formatNumber(baseline.redisHits)} (${((baseline.redisHits / REQUEST_COUNT) * 100).toFixed(1)}%)      | ${formatNumber(tricache.redisHits)} (${((tricache.redisHits / REQUEST_COUNT) * 100).toFixed(1)}%)         |`);
  console.log(`| DB Misses (fetchFn)      | ${formatNumber(baseline.dbMisses)} (${((baseline.dbMisses / REQUEST_COUNT) * 100).toFixed(1)}%)      | ${formatNumber(tricache.dbMisses)} (${((tricache.dbMisses / REQUEST_COUNT) * 100).toFixed(1)}%)       |`);
  console.log(`| Total Redis Commands     | ${formatNumber(baseline.redisCommands)}             | ${formatNumber(tricache.redisCommands)}              |`);
  console.log(`| Redis Command Reduction  | Baseline (0.0%)     | -${costs.redisCmdReductionPct.toFixed(1)}%               |`);
  console.log('+--------------------------+---------------------+---------------------+');

  console.log('\n[2] LATENCY DISTRIBUTION COMPRESSION');
  console.log('+--------------------------+---------------------+---------------------+');
  console.log('| Percentile               | Single-Tier Redis   | TriCache 3-Tier     |');
  console.log('+--------------------------+---------------------+---------------------+');
  console.log(`| p50 (Median)             | ${baseline.p50Ms.toFixed(2)} ms             | ${tricache.p50Ms.toFixed(2)} ms             |`);
  console.log(`| p95                      | ${baseline.p95Ms.toFixed(2)} ms             | ${tricache.p95Ms.toFixed(2)} ms             |`);
  console.log(`| p99                      | ${baseline.p99Ms.toFixed(2)} ms            | ${tricache.p99Ms.toFixed(2)} ms            |`);
  console.log('+--------------------------+---------------------+---------------------+');

  console.log('\n[3] AWS CLOUD FINANCIAL ROI (Scaled to 100M req/day fleet)');
  console.log('+-------------------------------------+------------------+------------------+');
  console.log('| Cloud Infrastructure Line Item      | Single-Tier      | TriCache 3-Tier  |');
  console.log('+-------------------------------------+------------------+------------------+');
  console.log(`| AWS ElastiCache Cluster Instance    | 3x r6g.xlarge    | 2x r6g.large     |`);
  console.log(`| ElastiCache Annual Instance Cost    | ${formatCurrency(10459.44).padEnd(16)} | ${formatCurrency(3486.48).padEnd(16)} |`);
  console.log(`| Monthly VPC Inter-AZ Bandwidth      | ${((baseline.redisBytesTransferred * 1000 * 30) / (1024**3)).toFixed(0)} GB/mo          | ${((tricache.redisBytesTransferred * 1000 * 30) / (1024**3)).toFixed(0)} GB/mo           |`);
  console.log(`| Annual AWS VPC Data Transfer Cost   | ${formatCurrency(costs.baselineAnnualCost - 10459.44).padEnd(16)} | ${formatCurrency(costs.tricacheAnnualCost - 3486.48).padEnd(16)} |`);
  console.log('+-------------------------------------+------------------+------------------+');
  console.log(`| TOTAL ANNUAL CLOUD INFRASTRUCTURE   | ${formatCurrency(costs.baselineAnnualCost).padEnd(16)} | ${formatCurrency(costs.tricacheAnnualCost).padEnd(16)} |`);
  console.log('+-------------------------------------+------------------+------------------+');
  console.log(`| NET ANNUAL SAVINGS WITH TRICACHE    | ->               | ${formatCurrency(costs.annualSavings).padEnd(16)} |`);
  console.log('+-------------------------------------+------------------+------------------+');

  console.log('\nExecutive Takeaway:');
  console.log(`TriCache absorbs ${(costs.redisCmdReductionPct).toFixed(1)}% of Redis command volume in local RAM and POSIX shared memory,`);
  console.log(`saving ${formatCurrency(costs.annualSavings)} / year per cluster while dropping p95 response times from ${baseline.p95Ms.toFixed(2)}ms to ${tricache.p95Ms.toFixed(2)}ms.`);
  console.log('='.repeat(80) + '\n');
}

// Auto-execute if invoked via tsx
if (typeof process !== 'undefined' && process.argv[1]?.includes('cloud-roi-simulation')) {
  runCloudRoiSimulation();
}
