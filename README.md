# SwiftQueue: Custom Distributed Task Queue & Monitoring Dashboard

SwiftQueue is a custom, high-performance, lightweight distributed task queue broker and real-time dashboard built from scratch using raw **Redis** structures and **WebSockets**. It is designed with reliability in mind, utilizing atomic queues and an automatic stalled-job reclaimer to prevent task loss if worker nodes crash mid-execution.

---

## Technical Stack & Architecture

- **Backend Broker**: Node.js + Express (TypeScript), running the producer logic, delayed jobs loop, and WS statistics engine.
- **Queue/State Database**: Redis (using raw `ioredis` commands). No third-party queue libraries (like BullMQ/Celery) are used.
- **Workers**: Independent, horizontal-scaling Node.js processes pulling jobs atomically.
- **Frontend Console**: Vite + React + Tailwind CSS, streaming telemetries, and charting stats over WebSockets.
- **Containerization**: Docker and Docker Compose orchestration supporting multi-worker replication.

---

## Redis Namespace Schema

SwiftQueue utilizes standard Redis structures optimized for reliable queue operations:
- `queue:waiting` (List): Holds serialized JSON job definitions queued for processing.
- `queue:processing` (List): Buffer list holding active jobs popped atomically.
- `queue:processing_start` (Hash): Maps `jobId` to Unix milliseconds timestamp when execution started.
- `queue:delayed` (Sorted Set): Holds scheduled jobs with their execution timestamp as the sorting score.
- `queue:dlq` (List): Dead Letter Queue for jobs that failed all retry attempts.
- `queue:stats` (Hash): Tracks running counters: `enqueued`, `success`, and `failure`.
- `queue:events` (Pub/Sub): Publishes telemetry log streams to the WebSocket broker.

---

## Reliability & Atomic Polling Pattern

To ensure zero-loss delivery, workers pull jobs via:
```redis
BRPOPLPUSH queue:waiting queue:processing 1
```
If a worker crashes while processing:
1. The job stays quarantined inside `queue:processing`.
2. The Server's **Job Reclaimer Loop** checks jobs in `queue:processing` every 5 seconds.
3. If a job has been active for more than **15 seconds** (or has stalled prior to registering its start time), the reclaimer atomically removes it from processing, increments `retryCount`, and:
   - Re-queues it back to `queue:waiting` if `retryCount <= maxRetries`.
   - Quarantines it to `queue:dlq` (incrementing failure counts) if retry limits are exceeded.

---

## Project Documentation & History

For detailed implementation and design decisions, refer to the files in the `docs/` folder:
- [docs/initial_prompt.md](file:///home/yogesh/Downloads/swiftqueue/docs/initial_prompt.md): The original requirements and data schemas.
- [docs/implementation_plan.md](file:///home/yogesh/Downloads/swiftqueue/docs/implementation_plan.md): The technical plan, architecture layout, and file-by-file specs.
- [docs/task.md](file:///home/yogesh/Downloads/swiftqueue/docs/task.md): Completed checkmarks tracking the implementation flow.
- [docs/walkthrough.md](file:///home/yogesh/Downloads/swiftqueue/docs/walkthrough.md): Comprehensive review of components, test scripts, and verification instructions.

---

## Development Setup

### Option A: Local Execution (Requires Local Redis)

1. **Install all dependencies** from the root:
   ```bash
   npm run install:all
   ```
2. **Launch all services concurrently** (Vite Dashboard, Express, Worker):
   ```bash
   npm run dev
   ```
3. Open your browser to `http://localhost:5173`.

### Option B: Docker Orchestration (Recommended)

1. **Spin up the stack** (instantiates Redis, Server, Dashboard, and 1 Worker):
   ```bash
   docker compose up --build
   ```
2. **Scale the workers** (test atomic execution, race condition safety, and concurrency):
   ```bash
   docker compose up --build --scale worker=3
   ```
3. Access the dashboard at `http://localhost:5173`.
