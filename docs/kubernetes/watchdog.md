# Dynamic Tier Latency Watchdog

In multi-tenant cloud clusters, host disk controllers frequently suffer from "noisy-neighbor" throttling where disk read latency degrades from 0.02ms to 50ms+. Continuing to read from a stalled disk tier degrades application throughput.

---

## Asymmetric Redis Hysteresis

TriCache's `TierLatencyWatchdog` monitors real-time rolling p95 read latencies across both the disk tier and L2 Redis.

![Disk Latency Staging & Asymmetric Redis Hysteresis Flowchart](/docs/Disk_latency_staging_flowchart_20260910220302.jpeg)

::: details Latency Staging Architecture
```
Disk p95 Latency > 15ms  ───────►  Stage 1 (25% Bypass)
Disk p95 Latency > 25ms  ───────►  Stage 2 (75% Bypass)
Disk Stalled / Error     ───────►  Stage 3 (100% Bypass to Redis)
                                         │
                                         ▼
Redis p95 Latency < 10ms ◄───────  Canary Cooldown (30s)
(Safe Hysteresis Recovery)
```
:::

## Graduated Bypass Stages

Under cloud multi-tenancy, disk latency degrades progressively rather than failing completely. A binary on/off switch causes severe load spikes on Redis. TriCache implements a **4-stage graduated shedding state machine**:

* **Stage 0 (Healthy — 0% Bypass)**: Normal 3-tier operation. Local disk p95 latency is $< 10\text{ms}$ or within $1.5\times$ of Redis latency. All spilled reads resolve from off-heap `/dev/shm` or NVMe.
* **Stage 1 (Light Degradation — 25% Bypass)**: When disk p95 crosses $10\text{ms}$ and exceeds $1.5\times$ Redis latency, TriCache probabilistically diverts 25% of disk lookups directly to Redis, shaving off the longest queue tails.
* **Stage 2 (Moderate Degradation — 75% Bypass)**: When disk p95 crosses $25\text{ms}$ and exceeds $2.25\times$ Redis latency, 75% of disk reads are diverted to Redis to alleviate host I/O contention.
* **Stage 3 (Severe Stall — 100% Bypass)**: When disk p95 exceeds $50\text{ms}$ or encounters I/O errors, 100% of reads bypass the disk tier. Enters a randomized 30-second canary cooldown.

```typescript
import { CacheService } from 'tricache';

const cache = new CacheService({
  watchdog: {
    enabled: true,
    minDiskBypassMs: 10,       // Stage 1 trigger threshold (p95 >= 10ms)
    bypassRatio: 1.5,          // Must be >= 1.5x slower than Redis
    cooldownMs: 30_000,        // Base cooldown before canary probing
    redisCutoffMs: 15,         // Redis circuit trip threshold
    redisRecoveryFloorMs: 10,  // Redis sustained recovery requirement
  },
});
```

---

## Anti-Flapping Safeguard

Diverting traffic to Redis increases Redis server load. Without dampening safeguards, this creates an oscillating **control-loop flapping shockwave** where traffic bounces violently between disk and Redis.

### 1. Asymmetric Redis Hysteresis
* **Diversion Cutoff**: If Redis p95 response time reaches **15ms**, TriCache immediately halts diversion to protect Redis from cascade exhaustion.
* **Recovery Floor**: TriCache **strictly refuses** to re-engage diversion until Redis latency drops below **10ms across 16 consecutive samples**. This asymmetric gap guarantees that Redis has genuinely recovered before absorbing additional traffic.

### 2. Anti-Synchronicity Jitter ($\pm 30\%$)
When hundreds of container pods run concurrently across a Kubernetes cluster, fixed cooldown timers cause all pods to re-probe disk at the exact same millisecond. TriCache applies cryptographically uniform jitter ($\pm 30\%$) to cooldown intervals (e.g. 30s becomes 21s–39s), desynchronizing recovery waves across the fleet.

### 3. Single-Canary Half-Open Probing
Upon cooldown expiration, TriCache permits exactly **one trial read** to probe the disk tier. All concurrent application requests remain shielded and diverted until the canary read completes successfully under the latency threshold.

---

## Real-Time Telemetry & Introspection

Monitor the latency watchdog state machine, rolling p95 latencies, and total bypassed requests:

```typescript
const stats = cache.getWatchdogStats();

console.log(stats);
// {
//   bypassActive: false,
//   bypassStage: 0,
//   diskP95Ms: 0.04,
//   redisP95Ms: 1.25,
//   redisDampened: false,
//   bypassedTotal: 0
// }
```
