# Kubernetes Production & SRE Architecture

> **Enterprise SRE Reference**: Zero-IOPS Off-Heap Storage, CIS/SOC2 `readOnlyRootFilesystem: true`, and Cgroup Memory Budgeting.

TriCache is engineered specifically to eliminate the standard failure modes of stateful in-memory caching inside Kubernetes clusters: V8 garbage collection stalls, container OOMKills, EBS burst-credit exhaustion, and node eviction triggered by ephemeral storage exhaustion.

---

## SRE Deep Dives

Explore the dedicated Kubernetes guides:

| Topic | Focus Area | Key Architectural Advantage |
|:---|:---|:---|
| **[/dev/shm Off-Heap tmpfs](/kubernetes/dev-shm)** | Container Memory Bus | 0.02ms latency off-heap RAM, zero V8 GC pauses, zero cloud EBS IOPS, compliant with `readOnlyRootFilesystem: true`. |
| **[Cgroup Memory Budgeting](/kubernetes/cgroups)** | Container Sizing | Cgroup v1/v2 enforcement, 40/40/20 heap-to-spill ratios, GC-aware OOM emergency purges. |
| **[Liveness vs. Readiness Probes](/kubernetes/probes)** | Traffic Routing | Hard separation between `/healthz` (process survival) and `/ready` (traffic admission & degradation). |
| **[Dynamic Latency Watchdog](/kubernetes/watchdog)** | Blast-Radius Shielding | Asymmetric Redis hysteresis and 4-stage graduated disk shedding under noisy-neighbor load. |
| **[Ephemeral Eviction Defense](/kubernetes/eviction-defense)** | Quota Safety | Proactive `statfs` host capacity checks, anti-eviction write shedding, and graceful SIGTERM snapshot flusher. |

---

## The Golden Path Manifest

A hardened Kubernetes `Deployment` manifest passing CIS Benchmarks and SOC2 compliance:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-service
  template:
    metadata:
      labels:
        app: api-service
    spec:
      containers:
        - name: web
          image: my-registry.example.com/api-service:v1.2.0
          securityContext:
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 10001
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          resources:
            requests:
              cpu: "500m"
              memory: "1536Mi"
            limits:
              cpu: "2000m"
              memory: "2048Mi"
          volumeMounts:
            - name: dshm
              mountPath: /dev/shm
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            periodSeconds: 5
      volumes:
        - name: dshm
          emptyDir:
            medium: Memory
            sizeLimit: 512Mi
```
