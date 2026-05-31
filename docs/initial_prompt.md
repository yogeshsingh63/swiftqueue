# SwiftQueue — Project Vision & Requirements

## Original V1 Prompt (Foundation)

Build a custom distributed task queue and monitoring dashboard named "SwiftQueue" from scratch using raw Redis commands (no BullMQ/Celery). Demonstrate reliable queue patterns (RPOPLPUSH), worker crash recovery, and a premium React dashboard.

## V2 Goals — From Mock to Real

V1 was a proof-of-concept with fake `setTimeout` delays pretending to do work. V2 upgrades the entire system to execute **real tasks** and adds production-quality queue features.

### What Changed in V2

| Area | V1 (Mock) | V2 (Real) |
|---|---|---|
| Job Processors | `setTimeout(2000)` | Real HTTP calls, file hashing, data pipelines, web scraping |
| Job Payloads | Hardcoded dummy data | User-defined via dashboard form or API |
| Job Results | Fire and forget | Stored in Redis with 1-hour TTL, queryable per job |
| Priority | FIFO only | High/Medium/Low with 3 separate Redis lists |
| Retry Strategy | Instant retry | Exponential backoff via delayed queue |
| Job History | None | Last 200 jobs viewable on dashboard with expandable results |
| Dashboard | Bulk inject buttons only | Full job creation form + quick actions + history table |
| Progress | None | Live 0-100% updates streamed via WebSocket |

### Technology Stack
1. Backend: Node.js with TypeScript and Express
2. State & Queue Store: Redis (using ioredis for communication)
3. Real-time Metrics: WebSockets (ws package) streaming statistics
4. Workers: Independent Node.js processes with priority-aware polling
5. Dashboard: React.js with Tailwind CSS (dark-theme, glassmorphism UI)
6. Deploy: Docker & Docker Compose (supporting worker scaling)

### Design Principles
- **Job-agnostic queue engine**: SwiftQueue doesn't care what the job does. Adding a new job type = writing one new handler function.
- **Zero-loss delivery**: RPOPLPUSH atomicity ensures no job is ever lost, even if a worker crashes mid-task.
- **Self-healing**: The Job Reclaimer automatically recovers stalled jobs without manual intervention.
- **Universal integration**: Any application (any language) can use SwiftQueue by making an HTTP POST.

### Future Possibilities
- Custom job type registration via API (no code changes needed)
- Worker health monitoring (heartbeats, CPU/memory stats)
- Job chaining (Job A completion triggers Job B)
- Rate limiting per job type
- Persistent job results in a database (MongoDB/PostgreSQL) instead of Redis TTL
