# Ephemeral Storage Eviction Defense

In Kubernetes clusters, pod eviction triggered by **Ephemeral Storage Quotas** is one of the most disruptive outage vectors for stateful and caching workloads. When a container exceeds its ephemeral storage limit or exhausts node disk capacity, the `kubelet` performs an immediate, non-graceful eviction:

```
Warning  Evicted  kubelet  The node was low on resource: ephemeral-storage. 
Container app exceeded its local ephemeral storage limit "2Gi".
```

Unlike memory OOM kills (which terminate a single container and restart it inside the same pod), ephemeral storage eviction **evicts the entire Pod immediately**, descheduling it from the node and forcing Kubernetes to reschedule it elsewhere—triggering cold cache penalties, ingress traffic drops, and thundering herds.

---

## The Root Causes in Container Caching

1. **Unbounded Disk Spilling**: When L1 memory is under pressure, caching engines evict to local disk. If disk eviction rates lag behind write rates, disk usage spikes past container limits.
2. **Co-located Inodes & Temporary Files**: Pods share node ephemeral storage with logs (`/var/log/pods`), Docker/Containerd image layers, and `/tmp`. A surge in logging can trigger node `DiskPressure` even if the cache stayed within its own budget.
3. **Blocking Synchronous Cleanup**: Standard file cleanup algorithms (`fs.rmdirSync` or large recursive sweeps) block the Node.js event loop for hundreds of milliseconds, tripping readiness and liveness probes while trying to free space.

---

## TriCache's Multi-Tier Defense Mechanism

TriCache implements an autonomous, non-blocking storage protection engine directly inside `DiskTier`:

![TriCache's Multi-Tier Defense Mechanism](/docs/Spill_requests_workflow_diagram_20260910220124.jpeg)

::: details Spill Requests Workflow Details
```
Incoming Spill Requests
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Write Rate Counter (Every 2,000 writes)                   │
│    Proactive statfsSync() check against host filesystem     │
└────────────────────────┬────────────────────────────────────┘
                         │
        Free Space < 10%?│ Free Space >= 10%
       ┌─────────────────┴─────────────────┐
       ▼                                   ▼
┌─────────────────────────┐  ┌────────────────────────────────┐
│ Spill Shedding Mode     │  │ Check Local Tier Quota         │
│ Drop spill to disk      │  │ (e.g. maxBytes = 2GB)          │
│ Keep in L1 / Evict safe │  └─────────────┬──────────────────┘
│ Prevents Pod Eviction   │                │
└─────────────────────────┘                ├─ Usage >= 80% ──► Trigger Non-blocking Chunked Prune
                                           │                   (500 files/chunk via setImmediate)
                                           ▼
                             ┌────────────────────────────────┐
                             │ Safe Async Off-Heap Write      │
                             │ (/dev/shm or local tmpfs)      │
                             └────────────────────────────────┘
```
:::

---

## 1. Proactive Host Volume Health (`statfsSync`)

TriCache does not rely solely on tracking internal file sizes. It probes the actual host filesystem mounted to the container:

* **Frequency**: Evaluated every 2,000 write operations (or on-demand via `checkHostVolumeHealth()`).
* **Threshold**: If available disk space falls below **10%** of total volume capacity, TriCache transitions the disk tier into `hostVolumeLowSpace` protection mode.
* **Action**: Spill writes to disk are immediately paused. Items stay in memory or are safely evicted via L1 policies, safeguarding the Pod against node-level eviction.
* **Auto-Recovery**: As soon as available capacity recovers above $10\%$, normal spilling resumes seamlessly with zero manual intervention.

```typescript
import { CacheService } from 'tricache';

// TriCache automatically runs statfsSync on the configured disk directory
const cache = new CacheService({
  disk: {
    dir: '/dev/shm/tricache-disk',
    maxBytes: 1024 * 1024 * 1024, // 1 GB
  },
});
```

---

## 2. Fast Write Shedding (Zero Event-Loop Stalls)

When disk capacity reaches maximum quota (`maxBytes`), during active pruning cycles, or when host volume free space is $<10\%$, TriCache sheds disk writes instantly:

```typescript
// Fast-shed incoming spills while host volume is low (<10%), pruning is active, or quota is reached
if (this._hostVolumeLowSpace || this._isPruning || this.diskUsageBytes >= this.opts.maxBytes) {
  this._spillsShedTotal++;
  return;
}
```

* **No Blocking I/O**: Drops the disk write asynchronously without attempting blocking synchronous disk deletion in the request critical path.
* **Zero Disruption to App**: The L1 in-memory tier continues serving sub-millisecond cache hits without latency degradation.
* **Observable**: Increments the `_spillsShedTotal` telemetry counter, exposed via Prometheus metrics and the Visual Dashboard.

---

## 3. Non-Blocking Chunked Pruning

When disk usage crosses the **80% high-watermark**, TriCache activates background chunked pruning down to the **60% low-watermark**:

* **500 Entries per Chunk**: Files are scanned and unlinked in batches of 500 entries at a time.
* **Event-Loop Cooperative**: Yields control back to the Node.js event loop using `setImmediate()` between batches, guaranteeing that HTTP requests and Kubernetes health probes are never starved.
* **Atomic Deletion**: Tracks active readers to prevent deleting files that are currently being deserialized.

---

## 4. Graceful Shutdown & Snapshot Flush (`SIGTERM`)

When Kubernetes scales down a deployment or rolls out an update, it sends a `SIGTERM` to the container before waiting `terminationGracePeriodSeconds` (default 30s):

```typescript
// Gracefully drain and persist critical state on container teardown
process.on('SIGTERM', async () => {
  console.log('[K8s] SIGTERM received. Flushing pending disk writes...');
  await cache.close(); // Flushes memory index, awaits pending writes, closes locks
  process.exit(0);
});
```

* Closes pending file handles cleanly.
* Removes temporary `.tmp.*` atomic write staging files.
* Bypasses orphan lock file retention, allowing new pods mounting shared volumes to acquire locks immediately.

---

## Recommended Kubernetes Manifest

Ensure your container specification defines matching ephemeral storage limits and allocates off-heap `/dev/shm` tmpfs:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-cache-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        image: my-repo/api:latest
        resources:
          requests:
            cpu: "1"
            memory: "1Gi"
            ephemeral-storage: "500Mi"
          limits:
            cpu: "2"
            memory: "2Gi"
            ephemeral-storage: "2Gi" # Hard limit monitored by kubelet
        volumeMounts:
        - name: dshm
          mountPath: /dev/shm
      volumes:
      - name: dshm
        emptyDir:
          medium: Memory
          sizeLimit: 1Gi # Isolated memory bus tmpfs
```

> [!TIP]
> Always configure TriCache's `disk.maxBytes` to be at least **20% lower** than the Kubernetes volume `sizeLimit` (e.g. 800 MB cache limit for a 1 GiB `emptyDir`). This guarantees TriCache's 80% watermark triggers well before the container runtime can enforce a hard eviction.
