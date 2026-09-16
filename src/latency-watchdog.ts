/**
 * TierLatencyWatchdog — Graduated, self-healing tier latency watchdog.
 *
 * Prevents EBS/cloud NVMe latency degradation from impacting application p95 response times.
 * Incorporates control-theory safeguards:
 *  - Amortized zero-allocation p95 calculation (fires every 32 samples on pre-allocated typed arrays).
 *  - Graduated probabilistic shedding (Stage 0: 0% -> Stage 1: 25% -> Stage 2: 75% -> Stage 3: 100%).
 *  - Asymmetric hysteresis on Redis circuit (cuts diversion at 15ms, requires recovery below 10ms).
 *  - Anti-synchronicity cooldown jitter (±30%) to eliminate fleet-wide failover shockwaves.
 *  - Single-canary half-open recovery probing.
 */

export interface LatencyWatchdogOptions {
  enabled?: boolean;
  minDiskBypassMs?: number;
  bypassRatio?: number;
  cooldownMs?: number;
  redisCutoffMs?: number;
  redisRecoveryFloorMs?: number;
  minSamples?: number;
  disableRedis?: boolean;
}

export interface LatencyWatchdogTelemetry {
  bypassActive: boolean;
  bypassStage: 0 | 1 | 2 | 3;
  diskP95Ms: number;
  redisP95Ms: number;
  redisDampened: boolean;
  bypassedTotal: number;
}

export class TierLatencyWatchdog {
  private readonly enabled: boolean;
  private readonly minDiskBypassMs: number;
  private readonly bypassRatio: number;
  private readonly cooldownMs: number;
  private readonly redisCutoffMs: number;
  private readonly redisRecoveryFloorMs: number;
  private readonly minSamples: number;
  private disableRedis: boolean;

  // Zero-allocation rolling ring buffers
  private readonly diskRing = new Float32Array(32);
  private readonly redisRing = new Float32Array(32);
  private readonly scratch = new Float32Array(32);

  private diskIdx = 0;
  private redisIdx = 0;
  private diskCount = 0;
  private redisCount = 0;

  // Cached amortized p95 values
  private cachedDiskP95 = 0;
  private cachedRedisP95 = 0;

  // State machine & control-theory flags
  private stage: 0 | 1 | 2 | 3 = 0;
  private redisDampened = false; // Asymmetric hysteresis latch
  private redisRecoveryConsecutiveSamples = 0;
  private bypassedUntilMonotonic = 0;
  private canaryInFlight = false;
  private bypassedTotal = 0;

  constructor(options: LatencyWatchdogOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.minDiskBypassMs = options.minDiskBypassMs ?? 10;
    this.bypassRatio = options.bypassRatio ?? 1.5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.redisCutoffMs = options.redisCutoffMs ?? 15;
    this.redisRecoveryFloorMs = options.redisRecoveryFloorMs ?? 10;
    this.minSamples = options.minSamples ?? 16;
    this.disableRedis = options.disableRedis ?? false;
  }

  public setDisableRedis(disabled: boolean): void {
    this.disableRedis = disabled;
    if (disabled) {
      this.stage = 0;
      this.bypassedUntilMonotonic = 0;
      this.canaryInFlight = false;
      this.redisRecoveryConsecutiveSamples = 0;
    }
  }

  /**
   * Record disk read duration in milliseconds (zero-allocation hot path).
   */
  public recordDisk(ms: number): void {
    if (!this.enabled) return;
    this.diskRing[this.diskIdx++ & 31] = ms;
    this.diskCount++;

    // Amortized: recalculate only every 32 samples
    if ((this.diskIdx & 31) === 0) {
      this.recalculateP95();
    }
  }

  /**
   * Record Redis read duration in milliseconds (zero-allocation hot path).
   */
  public recordRedis(ms: number): void {
    if (!this.enabled || this.disableRedis) return;
    this.redisRing[this.redisIdx++ & 31] = ms;
    this.redisCount++;

    if (ms <= this.redisRecoveryFloorMs) {
      this.redisRecoveryConsecutiveSamples++;
    } else {
      this.redisRecoveryConsecutiveSamples = 0;
    }

    // Amortized: recalculate only every 32 samples
    if ((this.redisIdx & 31) === 0) {
      this.recalculateP95();
    }
  }

  private recalculateP95(): void {
    if (this.diskCount >= this.minSamples) {
      this.cachedDiskP95 = this.computeP95(this.diskRing, Math.min(this.diskCount, 32));
    }
    if (this.redisCount >= this.minSamples) {
      this.cachedRedisP95 = this.computeP95(this.redisRing, Math.min(this.redisCount, 32));
    }

    this.evaluateControlLoop();
  }

  private computeP95(ring: Float32Array, count: number): number {
    for (let i = 0; i < count; i++) {
      this.scratch[i] = ring[i];
    }
    this.scratch.subarray(0, count).sort();
    const rank = Math.min(count - 1, Math.max(0, Math.floor((count - 1) * 0.95)));
    return this.scratch[rank];
  }

  /**
   * Core Control Loop:
   *  - Evaluates asymmetric hysteresis on Redis circuit.
   *  - Assigns graduated stage (0, 1, 2, 3) with anti-synchronicity jitter.
   */
  private evaluateControlLoop(): void {
    if (this.disableRedis) {
      this.stage = 0;
      return;
    }

    // 1. Asymmetric Hysteresis on Redis:
    // If Redis is struggling (>15ms), latch dampening ON to protect fleet
    if (this.cachedRedisP95 >= this.redisCutoffMs) {
      this.redisDampened = true;
    } else if (
      this.redisDampened &&
      this.cachedRedisP95 <= this.redisRecoveryFloorMs &&
      this.redisRecoveryConsecutiveSamples >= this.minSamples
    ) {
      // Only release dampening once Redis stabilizes firmly below 10ms across at least 16 consecutive samples
      this.redisDampened = false;
    }

    // If Redis is dampened, refuse to divert additional traffic to Redis
    if (this.redisDampened) {
      this.stage = 0;
      return;
    }

    // Require adequate samples on both tiers before making diversion decisions
    if (this.diskCount < this.minSamples || this.redisCount < this.minSamples) {
      return;
    }

    const diskP95 = this.cachedDiskP95;
    const redisP95 = Math.max(0.1, this.cachedRedisP95);

    // 2. Graduated Stage Evaluation
    if (diskP95 >= 50) {
      // Hard stall: Stage 3 (100% bypass)
      if (this.stage !== 3) {
        this.stage = 3;
        this.bypassedUntilMonotonic = performance.now() + this.calculateJitteredCooldown();
        this.bypassedTotal++;
      }
    } else if (diskP95 >= this.minDiskBypassMs * 2.5 && diskP95 >= redisP95 * (this.bypassRatio * 1.5)) {
      // Severe contention: Stage 2 (75% bypass)
      if (this.stage !== 2) {
        this.stage = 2;
        this.bypassedTotal++;
      }
    } else if (diskP95 >= this.minDiskBypassMs && diskP95 >= redisP95 * this.bypassRatio) {
      // Moderate contention: Stage 1 (25% bypass)
      if (this.stage !== 1) {
        this.stage = 1;
        this.bypassedTotal++;
      }
    } else {
      // Normal operating conditions
      this.stage = 0;
      this.bypassedUntilMonotonic = 0;
      this.canaryInFlight = false;
    }
  }

  private calculateJitteredCooldown(): number {
    // ±30% anti-synchronicity jitter
    const jitterFactor = 0.7 + Math.random() * 0.6; // [0.7, 1.3]
    return this.cooldownMs * jitterFactor;
  }

  /**
   * Determine whether a read is permitted to check the disk tier.
   *
   * In Stage 1 and 2, sheds traffic probabilistically.
   * In Stage 3, blocks all reads except for a single canary probe once cooldown expires.
   *
   * @param randomOverride Optional seeded random number [0, 1) for deterministic unit testing.
   */
  public isDiskAllowed(randomOverride?: number): boolean {
    if (!this.enabled || this.disableRedis) return true;

    if (this.stage === 0) return true;

    const rand = randomOverride !== undefined ? randomOverride : Math.random();

    // Stage 1: Probabilistic 25% diversion (75% hit disk)
    if (this.stage === 1) {
      return rand > 0.25;
    }

    // Stage 2: Probabilistic 75% diversion (25% hit disk)
    if (this.stage === 2) {
      return rand > 0.75;
    }

    // Stage 3: 100% bypass with half-open single canary probe
    const now = performance.now();
    if (now < this.bypassedUntilMonotonic) {
      return false; // Cooldown active, 100% diverted to Redis
    }

    // Cooldown elapsed: Permit exactly ONE canary probe in half-open state
    if (!this.canaryInFlight) {
      this.canaryInFlight = true;
      return true; // Canary allowed
    }

    // Other concurrent requests wait for canary result
    return false;
  }

  /**
   * Callback invoked when the single canary read probe completes.
   */
  public onCanaryResult(success: boolean, elapsedMs: number): void {
    if (!this.canaryInFlight) return;
    this.canaryInFlight = false;

    if (success && elapsedMs < this.minDiskBypassMs) {
      // Canary succeeded and was fast: Recover cleanly
      this.stage = 0;
      this.bypassedUntilMonotonic = 0;
      this.recordDisk(elapsedMs);
    } else {
      // Canary failed or was still slow: Extend cooldown with fresh jitter
      this.bypassedUntilMonotonic = performance.now() + this.calculateJitteredCooldown();
      this.bypassedTotal++;
    }
  }

  public getTelemetry(): LatencyWatchdogTelemetry {
    return {
      bypassActive: this.stage > 0,
      bypassStage: this.stage,
      diskP95Ms: Number(this.cachedDiskP95.toFixed(2)),
      redisP95Ms: Number(this.cachedRedisP95.toFixed(2)),
      redisDampened: this.redisDampened,
      bypassedTotal: this.bypassedTotal,
    };
  }
}
