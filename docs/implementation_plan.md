# Implementation Plan - SwiftQueue (Custom Distributed Task Queue & Monitoring Dashboard)

SwiftQueue is a custom, high-performance, lightweight distributed task queue and real-time monitoring dashboard built from scratch. It utilizes raw Redis data structures for queue operations, worker concurrency, and reliable delivery, eliminating the need for third-party libraries like BullMQ or Celery.

## User Review Required

> [!IMPORTANT]
> **Key Decisions & Protocols:**
> 1. **Atomic Worker State Transitions**: We will use Redis `RPOPLPUSH queue:waiting queue:processing` to pull jobs atomically.
> 2. **Crashed Worker Recovery**: If a worker crashes mid-task, the job remains in `queue:processing`. We will implement a **Job Reclaimer Loop** (running on the server/producer every 5 seconds) that checks if any job has been in `queue:processing` for longer than a threshold (e.g., 15 seconds) and moves it back to `queue:waiting` (updating its retry count) or to the DLQ.
> 3. **WebSocket Real-time Communication**: The React dashboard will establish a WebSocket connection to the Express server to receive stats and log streams in real-time.
> 4. **No Third-Party Queue Libraries**: All operations on lists, sorted sets, hashes, and transactions will be executed via raw `ioredis` commands.

---

## Proposed Changes

We will create a multi-package monorepo containing:
- `server/`: Express backend + WebSocket server.
- `worker/`: Independent, scaling worker processes.
- `dashboard/`: A high-aesthetic, glassmorphism React + Vite frontend.
- Root config: Orchestration with `concurrently` (for dev) and `docker-compose` (for multi-process scaling).

### Project Root

#### [NEW] [package.json](file:///home/yogesh/Downloads/swiftqueue/package.json)
Root configuration with scripts to install dependencies and run the server, worker, and dashboard concurrently during local development.

#### [NEW] [docker-compose.yml](file:///home/yogesh/Downloads/swiftqueue/docker-compose.yml)
Multi-container configuration to spin up:
- Redis (standard image)
- Express Server (running on port 5000)
- Multiple scaling Worker instances
- Frontend Dashboard (served via Vite dev server or compiled build)

---

### Backend Server (`server/`)

#### [NEW] [server/package.json](file:///home/yogesh/Downloads/swiftqueue/server/package.json)
Express, ioredis, ws, ts-node-dev, cors, and uuid dependencies.

#### [NEW] [server/tsconfig.json](file:///home/yogesh/Downloads/swiftqueue/server/tsconfig.json)
TypeScript compiler configuration.

#### [NEW] [server/src/config/redis.ts](file:///home/yogesh/Downloads/swiftqueue/server/src/config/redis.ts)
Initializes and exports the Redis client pool using `ioredis`.

#### [NEW] [server/src/queue/producer.ts](file:///home/yogesh/Downloads/swiftqueue/server/src/queue/producer.ts)
Includes:
- `enqueue(type, payload, delayMs)`: Generates a unique Job UUID, wraps it with retry metadata, and pushes it to `queue:waiting` (standard) or `queue:delayed` (delayed).
- `delayedJobsScanner`: A periodic loop (every 500ms) using a Redis transaction (`WATCH` + `ZRANGEBYSCORE` + `MULTI` + `EXEC`) to atomically migrate expired delayed jobs to `queue:waiting`.
- `jobReclaimer`: A periodic loop (every 5s) to reclaim jobs stuck in `queue:processing` for over 15s.

#### [NEW] [server/src/routes/jobs.ts](file:///home/yogesh/Downloads/swiftqueue/server/routes/jobs.ts)
REST API endpoints:
- `POST /api/jobs`: Enqueue a job (type: 'email' | 'report' | 'image', isDelayed: boolean, forceFail: boolean).
- `POST /api/jobs/bulk`: Bulk enqueue jobs (e.g., 10 instant jobs or 5 delayed jobs).
- `GET /api/stats`: Fetch current snapshot of statistics.
- `DELETE /api/jobs/dlq`: Purge or replay DLQ (Dead Letter Queue).

#### [NEW] [server/src/index.ts](file:///home/yogesh/Downloads/swiftqueue/server/src/index.ts)
Initializes Express, hooks up the WebSocket server (`ws`), streams live queue statistics (every 1s), and broadcasts live processing log events.

---

### Worker Process (`worker/`)

#### [NEW] [worker/package.json](file:///home/yogesh/Downloads/swiftqueue/worker/package.json)
Dependencies: `ioredis`, typescript, ts-node, etc.

#### [NEW] [worker/tsconfig.json](file:///home/yogesh/Downloads/swiftqueue/worker/tsconfig.json)
TypeScript worker compiler configuration.

#### [NEW] [worker/src/processor.ts](file:///home/yogesh/Downloads/swiftqueue/worker/src/processor.ts)
Contains simulated job execution:
- `email`: Takes 2s.
- `report`: Takes 4s.
- `image`: Takes 3s.
- Jobs marked with `forceFail: true` will throw an error immediately to showcase the retry and DLQ logic.

#### [NEW] [worker/src/index.ts](file:///home/yogesh/Downloads/swiftqueue/worker/src/index.ts)
Atomic Worker loop:
1. Long-polls Redis using `BRPOPLPUSH queue:waiting queue:processing 1` (or `RPOPLPUSH` with sleep). We'll use `BRPOPLPUSH` for blocking, low-overhead atomic pops.
2. Extracts job data, records the processing start time (stored in a separate Redis hash `queue:processing_times` or inside the job payload).
3. Calls the processor.
4. **Success**: Removes job from `queue:processing` (via `LREM`), deletes its processing time, increments `success` counter in `queue:stats`, and publishes a success log event via Redis Pub/Sub (or direct WS webhook).
5. **Failure**: Increments retry count. If `retryCount < maxRetries`, removes from `queue:processing`, updates payload, and pushes back to `queue:waiting`. Otherwise, moves to `queue:dlq`, removes from `queue:processing`, and increments `failure` counter.

---

### React Dashboard UI (`dashboard/`)

#### [NEW] [dashboard/package.json](file:///home/yogesh/Downloads/swiftqueue/dashboard/package.json)
Vite, React, Tailwind CSS, Lucide React (for premium icons), and Recharts (for live chart monitoring).

#### [NEW] [dashboard/tailwind.config.js](file:///home/yogesh/Downloads/swiftqueue/dashboard/tailwind.config.js)
Tailwind layout with modern custom slate/dark colors, neon glow effects, and border gradients.

#### [NEW] [dashboard/src/App.tsx](file:///home/yogesh/Downloads/swiftqueue/dashboard/src/App.tsx)
The primary UI view. Integrates WebSocket listener for real-time stats and worker log streaming.

#### [NEW] [dashboard/src/components/StatCard.tsx](file:///home/yogesh/Downloads/swiftqueue/dashboard/src/components/StatCard.tsx)
Glassmorphism cards showing counts of Active, Pending, DLQ, Completed, and Failed jobs with custom colors and micro-animations.

#### [NEW] [dashboard/src/components/TriggerActions.tsx](file:///home/yogesh/Downloads/swiftqueue/dashboard/src/components/TriggerActions.tsx)
Actions bar containing buttons:
- "Add 10 Instant Jobs"
- "Add 5 Delayed Jobs (10s)"
- "Trigger Failure Job (DLQ)"
- "Clear/Replay DLQ"

#### [NEW] [dashboard/src/components/JobLog.tsx](file:///home/yogesh/Downloads/swiftqueue/dashboard/src/components/JobLog.tsx)
A stylized console terminal streaming log entries (e.g., "[17:15:54] Worker #1 started Job #102 (Email)", "[17:15:56] Job #102 finished successfully in 2.0s").

---

## Verification Plan

### Automated/Local Tests
- Spin up the entire stack using `docker-compose up --build`.
- Run multiple worker containers (e.g. `docker-compose up --build --scale worker=3`) to verify concurrent execution, race condition safety, and performance.
- Verify through logs that jobs are never duplicated across workers.
- Test worker crashes by stopping a worker container mid-task (`docker stop`) and verifying the **Job Reclaimer** picks up the job and puts it back for retry.

### Manual Verification
- Access the dashboard at `http://localhost:5173`.
- Interact with controls and observe WebSocket updates.
- Check Redis values via Redis CLI: `redis-cli KEYS "queue:*"` to verify structures.
