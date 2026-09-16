# Liveness vs. Readiness Probes

A common anti-pattern in containerized caching is coupling cache degradation to the Kubernetes **Liveness Probe**. If Redis experiences transient network partitions or storage slows down, failing the liveness probe causes Kubernetes to terminate and restart the pod, triggering a **cascading container restart storm**.

---

## The Rule of Separation

| Probe Type | Kubernetes Action on Failure | Correct TriCache Hook |
|:---|:---|:---|
| **Liveness Probe (`/healthz`)** | **Restarts Container** (kills process) | Return `200 OK` as long as the Node.js event loop is alive. **Never check Redis or disk latency here.** |
| **Readiness Probe (`/ready`)** | **Removes from Ingress Load Balancer** | Hook into `cache.health()`. Sheds incoming ingress traffic while keeping the pod alive to heal and drain queues. |

---

## Implementation Example

```typescript
import express from 'express';
import { cache } from './cache';

const app = express();

// 1. Kubernetes Liveness Probe: always 200 unless event loop has crashed
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// 2. Kubernetes Readiness Probe: evaluates cache health & tier status
app.get('/ready', (req, res) => {
  const health = cache.health();
  if (health.healthy) {
    res.status(200).json(health);
  } else {
    // 503 sheds ingress traffic until storage stabilizes or snapshots finish hydrating
    res.status(503).json(health);
  }
});
```

### Readiness Gating During Cold Starts

Gate your server startup on `await cache.ready()`:

```typescript
// Guarantees zero cold-cache traffic spikes by awaiting snapshot hydration
await cache.ready();

app.listen(3000, () => {
  console.log('Server ready for traffic');
});
```
