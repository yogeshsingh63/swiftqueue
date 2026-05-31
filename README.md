# SwiftQueue: Custom Distributed Task Queue & Monitoring Dashboard

SwiftQueue is a custom, high-performance, lightweight distributed task queue broker and real-time dashboard built from scratch using raw **Redis** structures and **WebSockets**. It is designed with reliability in mind, utilizing atomic queues and an automatic stalled-job reclaimer to prevent task loss if worker nodes crash mid-execution.

**This is a general-purpose infrastructure service** — any application on your machine (Node.js, Python, Go, or even a `curl` command) can push background jobs into SwiftQueue via HTTP.

---

## V2 Features

- **Real Job Execution**: Workers make actual HTTP requests, download and hash files, scrape web pages, and process data pipelines — no fake `setTimeout` delays.
- **Priority Queues**: Jobs are routed to high/medium/low priority Redis lists. Workers always check high-priority first.
- **Exponential Backoff Retries**: Failed jobs are retried with doubling delays (2s → 4s → 8s) instead of instant retries.
- **Job Results Storage**: Each completed job's result is stored in Redis with a 1-hour TTL and queryable via API.
- **Job History**: Last 200 completed/failed job summaries viewable on the dashboard with expandable result details.
- **Job Creation Form**: Dashboard includes a form to create custom jobs with type-specific payloads, priority, delay, and retry configuration.
- **Live Progress Streaming**: Workers publish progress (0-100%) via Redis Pub/Sub, streamed to dashboard in real-time.

---

## Technical Stack & Architecture

- **Backend Broker**: Node.js + Express (TypeScript), running the producer logic, delayed jobs loop, job reclaimer, and WS metrics engine.
- **Queue/State Database**: Redis (using raw `ioredis` commands). No third-party queue libraries (like BullMQ/Celery) are used.
- **Workers**: Independent, horizontal-scaling Node.js processes pulling jobs atomically with priority awareness.
- **Frontend Console**: Vite + React + Tailwind CSS, streaming telemetry and charting stats over WebSockets.
- **Containerization**: Docker and Docker Compose orchestration supporting multi-worker replication.

---

## Redis Namespace Schema

- `queue:waiting:high` / `queue:waiting:medium` / `queue:waiting:low` (Lists): Priority-separated waiting queues.
- `queue:processing` (List): Buffer list holding active jobs popped atomically.
- `queue:processing_start` (Hash): Maps `jobId` to Unix milliseconds timestamp when execution started.
- `queue:delayed` (Sorted Set): Holds scheduled jobs and retry-backoff jobs with execution timestamps.
- `queue:dlq` (List): Dead Letter Queue for jobs that failed all retry attempts.
- `queue:stats` (Hash): Tracks running counters: `enqueued`, `success`, and `failure`.
- `queue:events` (Pub/Sub): Publishes telemetry log streams to the WebSocket broker.
- `queue:progress` (Pub/Sub): Publishes live job progress updates.
- `job:result:<id>` (String): Stores completed job results with 1-hour TTL.
- `queue:history` (List): Last 200 job summaries for the history view.

---

## Real Job Types

| Job Type | What It Does | Real-World Use Case |
|---|---|---|
| `http_request` | Makes actual HTTP calls (GET/POST/PUT) to any URL | Webhook delivery, API integrations |
| `hash_file` | Downloads a file and computes SHA-256 hash | File integrity verification, deduplication |
| `data_pipeline` | Fetches JSON from an API, filters, and aggregates | ETL jobs, data synchronization |
| `web_scrape` | Fetches HTML and extracts metadata (title, links, etc.) | SEO auditing, content monitoring |

---

## Reliability & Atomic Polling Pattern

Workers pull jobs via priority-ordered RPOPLPUSH:
```redis
RPOPLPUSH queue:waiting:high queue:processing    # Non-blocking, check first
RPOPLPUSH queue:waiting:medium queue:processing  # Non-blocking, check second
RPOPLPUSH queue:waiting:low queue:processing     # Non-blocking, check last
```

If a worker crashes while processing:
1. The job stays quarantined inside `queue:processing`.
2. The Server's **Job Reclaimer Loop** detects it every 5 seconds.
3. If stalled for >15 seconds, it reclaims the job, increments retry count, and re-queues it.

---

## Integration with Other Projects

SwiftQueue runs as a standalone service. Any application can push jobs into it:

```bash
# From any terminal, script, or application:
curl -X POST http://localhost:5000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "http_request",
    "payload": { "url": "https://httpbin.org/post", "method": "POST", "body": {"key": "value"} },
    "priority": "high",
    "maxRetries": 5,
    "retryStrategy": "exponential"
  }'
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/jobs` | Create a single job |
| `POST` | `/api/jobs/bulk` | Bulk create jobs |
| `GET` | `/api/jobs/stats` | Get current queue stats |
| `GET` | `/api/jobs/history` | Get last N job summaries |
| `GET` | `/api/jobs/:id/result` | Get result of a completed job |
| `POST` | `/api/jobs/dlq/replay` | Replay all DLQ jobs |
| `DELETE` | `/api/jobs/dlq/clear` | Clear the DLQ |

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

---

## Project Documentation

- [docs/initial_prompt.md](docs/initial_prompt.md): The original V1 requirements and V2 vision.
- [docs/implementation_plan.md](docs/implementation_plan.md): Technical plan and architecture.
- [docs/task.md](docs/task.md): Implementation task tracker.
- [docs/walkthrough.md](docs/walkthrough.md): Detailed walkthrough of changes.
