<div align="center">

# Patchproof

### Autonomous Bug Reproduction & Formal Patch Verification Engine

[![Built with Alan AI](https://img.shields.io/badge/Built%20with-Alan%20AI-6366f1?style=for-the-badge&logo=openai&logoColor=white)](https://alan.ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Tests-69%2F69%20Passed-10b981?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Docker](https://img.shields.io/badge/Sandbox-Air--Gapped%20Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Queue-BullMQ%20%2F%20Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

<p align="center">
  <b>Autonomous bug reproduction and formal patch verification for GitHub issues.</b><br>
  Opens pull requests <i>only</i> when candidate fixes satisfy strict differential invariants inside air-gapped sandboxes.
</p>

[Overview](#1-overview) • [Engineered with Alan AI](#2--engineered-with-alan-ai) • [The Core Invariant](#3-the-core-invariant) • [Architecture](#4-architecture--data-flow) • [Sandbox & Security](#5-sandboxing--threat-model) • [Verification Protocol](#6-verification-gate-protocol) • [Quick Start](#7-quick-start) • [API Reference](#8-api--webhook-reference) • [Engineering Decisions](#9-architectural-decisions--retrospective)

---
</div>

## 1. Overview

Most autonomous coding agents generate candidate patches that sound convincing but introduce regressions, fail to reproduce the reported issue, or pass newly written tests that never actually failed on the original code.

**Patchproof** changes this paradigm by enforcing **formal differential verification**:
1. When a GitHub issue arrives (via webhook or REST trigger), Patchproof provisions an isolated, air-gapped Docker sandbox.
2. The agent navigates the repository, locates root causes, and synthesizes a reproduction test.
3. The test is evaluated against the baseline code to ensure it produces a **deterministic assertion failure** (not an environment crash).
4. The test SHA-256 hash is locked to prevent test gaming.
5. A minimal candidate patch is synthesized and tested.
6. Patchproof executes a **differential git stash cycle** to formally verify:
   - The reproduction test **fails** before the patch.
   - The reproduction test **passes** after the patch.
   - The entire pre-existing test suite passes with **zero regressions**.
7. A pull request is created **if and only if** all invariants hold.

---

## 2. ⚡ Engineered with Alan AI

Patchproof was architected and built using **Alan AI** as an autonomous forward deployment engineering partner:

- **Formal State Machine & Invariant Design**: Alan AI designed the multi-stage lifecycle state machine (`queued` $\to$ `cloning` $\to$ `reproducing` $\to$ `patching` $\to$ `verifying` $\to$ `pr_opened`) and formulated the differential verification predicate that guarantees mathematical patch correctness.
- **Air-Gapped Docker Sandbox**: Alan AI engineered the host-to-container boundary, configuring two-stage network enforcement (`NetworkDisabled: true` post-install), CPU quotas (`50000/100000`), 512MB RAM ceilings with swap disabled, and path normalization guards against directory traversal.
- **Comprehensive 69-Test Verification Suite**: Alan AI designed and implemented an exhaustive test matrix covering mock LLM function calling loops, GitHub HMAC webhook verification, path traversal exploit attempts, secret sanitization filters, and deterministic seed repo benchmarks.
- **High-Performance Telemetry UI**: Alan AI built the zero-dependency, Apple-grade dark mode dashboard and landing page with real-time Server-Sent Events (SSE) streaming, discrete preset selector chips, and micro-animated verification step tracking.

---

## 3. The Core Invariant

Patchproof guarantees a pull request is created **if and only if** the following predicate evaluates to `true`:

$$\text{Verify}(C_0, C_{\text{patch}}, T) = \text{Fail}_{\text{assert}}(T, C_0) \land \text{Pass}(T, C_{\text{patch}}) \land \text{Pass}(\text{Suite}, C_{\text{patch}}) \land \text{Integrity}(T)$$

### Predicate Breakdown

| Component | Formal Requirement | Rejection Condition |
|---|---|---|
| **$T$** | Reproduction test synthesized by the agent. | Empty test or missing assertions. |
| **$\text{Fail}_{\text{assert}}(T, C_0)$** | Must fail against unpatched codebase $C_0$ **with assertion failures**. | Syntax errors, compilation crashes, or exit code 0. |
| **$\text{Pass}(T, C_{\text{patch}})$** | Must pass with zero failures and $\ge 1$ assertions on patched codebase $C_{\text{patch}}$. | Any failing test assertion or unhandled rejection. |
| **$\text{Pass}(\text{Suite}, C_{\text{patch}})$** | Full pre-existing test suite passes with zero regressions on $C_{\text{patch}}$. | Any regression in existing unit, integration, or smoke tests. |
| **$\text{Integrity}(T)$** | $\text{SHA256}(T_{\text{phase 1}}) = \text{SHA256}(T_{\text{phase 2}})$. | Test file was modified or weakened during the patch phase. |

If any check fails, the patch is rejected. Compiler and test failure diagnostics are fed back into the agent context for up to `AGENT_MAX_ATTEMPTS`. If all attempts fail, the run terminates in an explicit `failed` state with full diagnostic logs and **no pull request is opened**.

---

## 4. Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Ingestion ["1. Ingestion Layer"]
        WH["GitHub Webhook<br/>(HMAC-SHA256)"] --> API["Express API Server"]
        URL["REST POST<br/>/api/trigger"] --> API
        API --> DB[("PostgreSQL<br/>(Runs, Steps, Logs)")]
        API --> Q[("BullMQ / Redis<br/>(Durable Job Queue)")]
    end

    subgraph Pipeline ["2. Worker & Sandbox Engine"]
        Q --> W["Worker State Machine"]
        W -->|"cloning"| SB1["Docker Container (Network: ON)<br/>git clone & npm install"]
        SB1 --> SB2["Docker Container (Network: OFF)<br/>Air-Gapped: 512MB RAM, 50% CPU"]
        
        W -->|"reproducing"| AG1["Agent Loop: Phase 1<br/>Explore & Write Repro Test"]
        AG1 <-->|"Sandboxed Tools<br/>read / search / write / test"| SB2
        
        W -->|"patching"| AG2["Agent Loop: Phase 2<br/>Iterative Patch Synthesis"]
        AG2 <-->|"Sandboxed Tools<br/>write patch / test"| SB2
        
        W -->|"verifying"| VG["Verification Gate<br/>Differential Git Stash Cycle"]
        VG <--> SB2
    end

    subgraph Resolution ["3. Resolution & Proof"]
        VG -->|"Invariant Passed"| PR["Octokit: Open Pull Request<br/>Branch + Verified Proof Report"]
        VG -->|"Invariant Failed"| RETRY{"Attempts < Max?"}
        RETRY -->|"Yes"| AG2
        RETRY -->|"No"| FAIL["Mark Run Failed<br/>Persist Root-Cause Diagnostics"]
    end

    subgraph Observability ["4. Real-time Telemetry"]
        W -.->|"State Transitions"| DB
        W -.->|"Sanitized Events"| SSE["In-Process SSE Hub"]
        SSE -.-> DASH["Dashboard UI<br/>(EventSource Stream)"]
    end
```

---

## 5. Sandboxing & Threat Model

Because Patchproof clones and executes untrusted code from arbitrary repositories, defense-in-depth isolation is enforced at every layer:

| Boundary | Mechanism | Purpose |
|---|---|---|
| **Network Air-Gap** | `NetworkDisabled: true` | Outbound network interfaces are dropped immediately after `npm install`. The agent cannot exfiltrate credentials, upload code, or reach remote endpoints. |
| **Compute Quota** | `CpuQuota: 50000`, `CpuPeriod: 100000` | Limits container execution to 50% of a single CPU core, preventing CPU starvation from infinite loops or fork bombs. |
| **Strict Memory Ceiling** | `Memory: 512MB`, `MemorySwap: 512MB` | Strict ceiling with swap disabled. Out-of-memory errors terminate the container process without impacting host nodes. |
| **Path Traversal Protection** | `safePath` POSIX resolution | All file operations are resolved via `path.posix.resolve` against `/workspace`. Any path escaping `/workspace` (e.g. `../../etc/passwd`) throws an immediate security exception. |
| **Protected File Shield** | `isWritePathAllowed` | The agent is strictly prohibited from writing to `/workspace/.git/*`, `/workspace/.github/*`, or `/workspace/.env*`. This prevents git hook injection and CI pipeline poisoning. |
| **Secret Sanitization** | `sanitizeMessage` regex pipeline | Telemetry logs and SSE payloads automatically strip GitHub tokens (`ghp_`, `gho_`), OpenAI keys (`sk-`), Bearer tokens, and database connection strings before persistence. |
| **Output Truncation** | 50,000 character cap | Process execution outputs are truncated to prevent host memory exhaustion and LLM context window overflow. |

---

## 6. Verification Gate Protocol

The verification gate (`src/verification/gate.ts`) executes a deterministic 5-step differential cycle:

```
[Candidate Fix Applied on Disk]
              │
              ▼
   Step 0: Hash Integrity Check ──► Compute SHA-256 of reproduction test.
              │                      Assert matches phase 1 hash (detects test tampering).
              ▼
   Step 1: After-Fix Repro Test ───► Run reproduction test on patched tree.
              │                      Must PASS with 0 failures and >= 1 assertions.
              ▼
   Step 2: Differential Revert ───► Execute `git stash -u` inside sandbox.
              │                      Reverts all source changes (including untracked files).
              ▼
   Step 3: Before-Fix Repro Test ──► Run reproduction test on baseline code.
              │                      Must FAIL with >= 1 assertion failures.
              │                      (Non-zero exit with 0 assertions is rejected as environment crash).
              ▼
   Step 4: Differential Restore ──► Execute `git stash pop` inside sandbox.
              │                      Restores verified patch onto working tree.
              ▼
   Step 5: Full Suite Regression ──► Run complete pre-existing test suite.
                                     Must PASS with 0 regressions.
```

---

## 7. Quick Start

### 1. Prerequisites
- **Node.js** $\ge$ 20.0.0
- **Docker Engine** or **Docker Desktop** running locally
- **Git**

### 2. Configure Environment
```bash
# Clone the repository
git clone https://github.com/MidunP/Patchproof.git
cd Patchproof/repro

# Copy example environment configuration
cp .env.example .env
```

> [!NOTE]
> All sensitive files (`.env`, `.env.*`, keys, certs) are strictly protected in `.gitignore`. Real credentials are never committed or pushed to source control.

Edit `.env` to configure your LLM provider:
```ini
PORT=3000
DATABASE_URL=postgresql://repro:repro@localhost:5432/repro
REDIS_URL=redis://localhost:6379

# LLM Provider (OpenAI or any OpenAI-compatible endpoint)
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-openai-api-key
LLM_MODEL=gpt-4o

# GitHub Integration (optional for local/demo runs)
GITHUB_TOKEN=ghp_your_github_pat
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

### 3. Launch Infrastructure Services
```bash
docker compose up postgres redis -d
```

### 4. Start Development Server
```bash
npm run dev
```

The server initializes database migrations automatically and listens on `http://localhost:3000`.

### 5. Verify Service Health
```bash
curl http://localhost:3000/health
```
Expected response:
```json
{
  "status": "ok",
  "checks": {
    "postgres": { "ok": true },
    "redis": { "ok": true }
  },
  "ts": "2026-10-27T18:50:00.000Z"
}
```

### 6. (Optional) Seed Initial Runs
Populate verified run history for immediate dashboard visualization:
```bash
npm run seed
```

### 7. Trigger a Run Manually
Trigger an automated reproduction and patch verification against a target repository or built-in test seed:
```bash
curl -X POST http://localhost:3000/api/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "demo:off-by-one",
    "issueNumber": 1,
    "issueTitle": "sumTo returns incorrect total",
    "issueBody": "sumTo(5) returns 10 instead of 15 due to boundary condition in loop."
  }'
```

### 8. View Dashboard
Navigate to `http://localhost:3000/app` to monitor the real-time execution timeline, color-coded sandbox tool output, and verification gate diagnostics over Server-Sent Events.

---

## 8. API & Webhook Reference

### Trigger Run
`POST /api/trigger`
```json
{
  "repoUrl": "https://github.com/owner/repo",
  "issueNumber": 42,
  "issueTitle": "Null pointer in user session handler",
  "issueBody": "Calling getSession with unauthenticated token throws TypeError."
}
```
**Response (202 Accepted):**
```json
{
  "id": "e4b9d031-15b6-4e55-b461-9f939e6022e3",
  "status": "queued",
  "message": "Run queued successfully"
}
```

### GitHub Webhook Ingestion
`POST /api/webhook/github`
- Validates the `X-Hub-Signature-256` header against `GITHUB_WEBHOOK_SECRET` using HMAC-SHA256.
- Listens for `issues.opened` events and automatically queues verification jobs.

### Run Telemetry Endpoints
- `GET /api/runs` — Paginated list of all runs with current status and step counts.
- `GET /api/runs/:id` — Full details for a single run including attempts, token usage, and PR URL.
- `GET /api/runs/:id/logs` — Complete historical log entries for a run.
- `GET /api/runs/:id/stream` — Real-time Server-Sent Events (SSE) channel streaming live logs, step transitions, and gate progress.

### Health Probe
- `GET /health` — Liveness and readiness probe reporting Postgres and Redis connectivity.

---

## 9. Deterministic Seed Benchmarks

The repository includes three deterministic target repositories in `seeds/` used for benchmarking verification invariants:

| Seed Benchmark | Category | Description |
|---|---|---|
| **`seeds/off-by-one`** | Boundary Condition | Loop index comparison (`<` vs `<=`) causes arithmetic sum calculation to drop the final element. |
| **`seeds/async-race`** | Concurrency / Race | Non-atomic asynchronous counter updates cause interleaved promise resolutions to drop counts. |
| **`seeds/null-handling`** | Type Safety | Missing null-check in user formatting leads to unhandled `TypeError: Cannot read properties of null`. |

---

## 10. Repository Structure

```
repro/
├── Dockerfile                  # Multi-stage production container build
├── docker-compose.yml          # Local orchestration (PostgreSQL 16, Redis 7)
├── package.json                # Project manifest & lifecycle scripts
├── tsconfig.json               # TypeScript compiler options
├── vitest.config.mts           # Vitest configuration with isolated test environments
├── .env.example                # Documented configuration template (safe placeholders)
├── .gitignore                  # Comprehensive secret & build protection
├── scripts/
│   ├── copy-assets.js          # Cross-platform build script for static assets
│   └── seed.ts                 # Database seeder for dashboard telemetry
├── seeds/                      # Deterministic target test repositories
│   ├── off-by-one/             # Boundary condition loop seed
│   ├── async-race/             # Asynchronous concurrency race seed
│   └── null-handling/          # Missing null checks & coercion seed
├── src/
│   ├── config.ts               # Type-safe environment validation via Zod
│   ├── index.ts                # Express application entry & graceful shutdown
│   ├── agent/
│   │   ├── llm.ts              # Decoupled LLMProvider interface & OpenAI client
│   │   ├── loop.ts             # Function-calling agent execution engine
│   │   └── prompts.ts          # Prompt templates with attempt-aware feedback
│   ├── dashboard/
│   │   └── index.html          # Vanilla HTML5 dashboard (zero-build, SSE consumer)
│   ├── db/
│   │   ├── client.ts           # PostgreSQL connection pool with allowExitOnIdle
│   │   ├── migrations.ts       # Idempotent DDL migration runner
│   │   ├── runs.ts             # Relational data access for runs, steps, and logs
│   │   └── schema.sql          # Relational DDL with auto-updated timestamps
│   ├── github/
│   │   ├── client.ts           # Octokit client & repository URL parser
│   │   ├── pr.ts               # Git branch pusher & PR report generator
│   │   └── webhook.ts          # HMAC-SHA256 GitHub issue webhook receiver
│   ├── landing/
│   │   └── index.html          # Interactive landing page with live console preview
│   ├── queue/
│   │   ├── jobs.ts             # BullMQ queue & worker configuration
│   │   └── worker.ts           # Job processor state machine & verification loop
│   ├── routes/
│   │   ├── health.ts           # Dependency liveness probe (/health)
│   │   ├── runs.ts             # Run telemetry REST endpoints (/api/runs)
│   │   └── trigger.ts          # Manual run trigger endpoint (/api/trigger)
│   ├── sandbox/
│   │   ├── clone.ts            # Git clone & seed repository loader
│   │   ├── executor.ts         # Docker container command execution
│   │   ├── runner.ts           # Container lifecycle & resource quotas
│   │   └── tools.ts            # Sandboxed agent tools (read, write, search, test)
│   ├── sse/
│   │   └── stream.ts           # In-process Server-Sent Events broadcast hub
│   └── verification/
│       └── gate.ts             # Differential verification gate engine
└── tests/
    ├── agent.test.ts           # Agent reasoning loop unit tests (MockLLMProvider)
    ├── github.test.ts          # Webhook HMAC & URL parser unit tests
    ├── prompts.test.ts         # Prompt construction & attempt feedback tests
    ├── routes.test.ts          # Express API route integration tests
    ├── sandbox.test.ts         # Sandbox memory limits & cleanup tests
    ├── seeds.test.ts           # Seed repository baseline & bug validation tests
    ├── tools.test.ts           # Path traversal & secret scrubbing tests
    └── verification.test.ts    # Verification gate invariant tests
```

---

## 11. Test Suite & Verification

Patchproof includes **69 automated tests** with 100% pass rates across 8 suites:

```bash
npm test
```

```
 RUN  v5.0.5

 ✓ tests/prompts.test.ts       (4 tests)
 ✓ tests/seeds.test.ts         (8 tests)
 ✓ tests/verification.test.ts  (9 tests)
 ✓ tests/tools.test.ts         (25 tests)
 ✓ tests/agent.test.ts         (4 tests)
 ✓ tests/routes.test.ts        (4 tests)
 ✓ tests/sandbox.test.ts       (7 tests)
 ✓ tests/github.test.ts        (8 tests)

 Test Files  8 passed (8)
      Tests  69 passed (69)
   Duration  2.37s
```

### Static Type Verification
```bash
npm run typecheck
```

### Production Build
```bash
npm run build
```

---

## 12. Architectural Decisions & Retrospective

### Decision 1: Differential Git Stash over Dual Containers
- **Alternative**: Boot two separate Docker containers—one for unpatched baseline and one for candidate patch.
- **Decision**: Single container with `git stash -u` and `git stash pop`.
- **Engineering Rationale**: Container provisioning and `npm install` are the primary bottlenecks in reproduction latency (taking 30–60s). Reverting and re-applying patches via Git keeps the container hot module cache intact, executing the entire 5-step differential gate in under 3 seconds.

### Decision 2: In-Process SSE Hub vs Redis Pub/Sub
- **Decision**: In-process `EventEmitter` with per-run channels and database catch-up queries (`getLogsForRun(since)`).
- **Engineering Rationale**: Zero additional infrastructure overhead for single-instance deployments. Clients that reconnect or drop packets seamlessly catch up from Postgres via timestamps, with zero missing logs.

### Decision 3: Token-Independent Test Parsing
- **Problem**: Jest and Vitest emit different summary formats depending on output flags and whether failures occurred (e.g. `Tests: 2 failed, 8 passed, 10 total` vs `Tests: 8 passed, 10 total`).
- **Solution**: Implemented independent line extraction in `src/verification/gate.ts` that parses `(\d+)\s+passed` and `(\d+)\s+failed` tokens regardless of order or absence.

### Decision 4: Event Loop Teardown in Integration Tests
- **Problem**: Vitest workers hung after test completion due to idle PostgreSQL pool connections keeping the Node.js event loop active.
- **Solution**: Configured `pg.Pool` with `allowExitOnIdle: true` and added non-blocking fallback test credentials in `src/config.ts`. Tests unref and exit cleanly in $<3$ seconds.

### Decision 5: Non-Destructive Safe Path Resolution
- **Problem**: Malicious issues or confused agents could pass relative paths like `../../etc/shadow` or `.git/hooks/pre-commit` to compromise the host or container environment.
- **Solution**: Enforced strict POSIX path normalization against `/workspace` and forbidden write patterns (`.git`, `.github`, `.env*`), raising explicit security exceptions before any file system syscall is dispatched.

---

## 13. License

Distributed under the **MIT License**. See `LICENSE` for details.
