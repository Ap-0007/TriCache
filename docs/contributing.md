# Contributing to TriCache

Thank you for your interest in contributing to **TriCache**! We welcome contributions of all kinds: bug fixes, performance optimizations, new framework adapters, documentation improvements, and architectural ideas.

---

## Code of Conduct

This project and everyone participating in it is governed by the TriCache Code of Conduct. By participating, you are expected to uphold this code.

---

## Getting Started

### Prerequisites
- **Node.js**: `\ge 20.10.0` (LTS or current)
- **pnpm**: `\ge 9.0.0` (pinned via `packageManager: pnpm@11.22.0`)
- **Git**
- Optional: **Redis / Valkey** running locally or in Docker on port `6379` (unit tests run standalone mock/memory cache; live integration tests automatically connect if available).

### Fork & Clone
1. Fork the repository on GitHub: [https://github.com/Kareem411/TriCache](https://github.com/Kareem411/TriCache)
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/TriCache.git
   cd TriCache
   ```
3. Set the upstream remote:
   ```bash
   git remote add upstream https://github.com/Kareem411/TriCache.git
   ```
4. Install dependencies:
   ```bash
   pnpm install
   ```

---

## Development Workflow

### Useful Commands

| Command | Description |
|---|---|
| `pnpm test` | Run the full Vitest test suite once |
| `pnpm test:watch` | Run Vitest in interactive watch mode |
| `pnpm lint` | Run Oxlint fast static analysis |
| `pnpm typecheck` | TypeScript type-check source files |
| `pnpm typecheck:all` | TypeScript type-check source AND test files |
| `pnpm build` | Build ESM, CJS, and type declarations with `tsup` |
| `pnpm bench` | Run microbenchmarks (L1/L2/SWR throughput & latency) |
| `pnpm bench:roi` | Run deterministic cloud ROI Zipfian simulation |
| `pnpm docs:dev` | Start local documentation preview server |
| `pnpm docs:build` | Build production documentation bundle |

### Running Tests
All tests must pass before opening a pull request:
```bash
pnpm test
```

### Type Checking & Linting
Ensure type safety and code cleanliness:
```bash
pnpm typecheck:all
pnpm lint
```

---

## Pull Request Guidelines

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Keep PRs focused on a single change or feature.
3. Add unit tests for any new functionality or bug fixes.
4. If you touch a hot path in L1 memory or serialization, run `pnpm bench` and include before/after throughput numbers in your PR description.
5. Ensure documentation is updated accordingly.
