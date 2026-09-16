# Cgroup-Aware Memory Budgeting

Setting naive container memory limits without budgeting for Node.js V8 heap internals and `/dev/shm` tmpfs leads to unexpected **Linux OOMKills** (Exit Code 137).

---

## The Container Memory Breakdown

In Linux containers, `/dev/shm` tmpfs allocations count directly against the container's cgroup memory quota:

$$\text{Cgroup Memory Usage} = \text{V8 Heap} + \text{Node.js Buffers/OS} + \text{tmpfs (/dev/shm)}$$

For a container with `resources.limits.memory: 2048Mi` (2 GB), apply the **Golden Ratio**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Container Limit: 2,048 MB                                              │
├───────────────────┬───────────────────┬────────────────────────────────┤
│ V8 Heap (--max-old)│ /dev/shm Spill    │ OS / Native Buffers / Libuv    │
│ 768 MB (37.5%)    │ 768 MB (37.5%)    │ 512 MB (25.0%)                 │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

| Component | Target Budget | Description |
|:---|:---|:---|
| **V8 Heap (`--max-old-space-size`)** | **768 MB** | L1 RAM cache entries (`l1MaxBytes: 512MB`) + application objects. |
| **POSIX `/dev/shm` tmpfs** | **768 MB** | L1.5 disk spill quota (`diskMaxBytes: 600MB`). |
| **OS / Native Buffers / Libuv** | **512 MB** | Node.js runtime overhead, OpenSSL TLS buffers, libuv event loop. |

---

## Proactive OOM Guard (`oomProtection: true`)

Even with strict budgeting, unexpected traffic spikes can threaten container limits. TriCache includes a GC-aware OOM guard:

```typescript
const cache = CacheService.create({
  oomProtection: true,
  oomHeapThreshold: 0.85,    // Emergency eviction triggers at 85% heap usage
  oomCheckIntervalMs: 5_000, // Checks heap pressure every 5s
  oomEvictPercent: 0.20,     // Sheds 20% of coldest entries to L1.5 disk
});
```

When heap usage crosses `oomHeapThreshold`, TriCache emergency-evicts the coldest entries from L1 RAM to L1.5 disk, preventing the Linux kernel from terminating the pod.
