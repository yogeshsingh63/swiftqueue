# Initial Prompt: Custom Distributed Task Queue & Monitoring Dashboard "SwiftQueue"

You are going to build a high-performance, lightweight Custom Distributed Task Queue & Monitoring Dashboard named "SwiftQueue" from scratch. 

### CRITICAL REQUIREMENTS:
- Do NOT use third-party queue libraries (like BullMQ, Bee-Queue, or Celery). Build this custom queue logic directly on top of raw ioredis commands to showcase a deep understanding of Redis data structures.
- Reliable Queue Pattern: Workers must move jobs atomically from the waiting state to the processing state (using RPOPLPUSH or LMOVE) so that if a worker crashes mid-task, the job is not lost and can be recovered.

---

### Technology Stack:
1. Backend: Node.js with TypeScript and Express.
2. State & Queue Store: Redis (using ioredis for communication).
3. Real-time Metrics: WebSockets (ws package) streaming statistics.
4. Workers: Independent Node.js processes.
5. Dashboard: React.js with Tailwind CSS (modern dark-theme, glassmorphism UI).
6. Deploy: Docker & Docker Compose (supporting worker scaling).

---

### Project Structure to Create:
Please create this folder structure inside the workspace:

```text
swiftqueue/
├── package.json            # Root scripts to run backend + frontend concurrently
├── docker-compose.yml
├── README.md
├── server/                 # Express API + WebSocket Broker
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts        # Express + WebSocket setup
│   │   ├── config/redis.ts # Redis client pool
│   │   ├── queue/producer.ts # Enqueue logic (JSON serialization)
│   │   └── routes/jobs.ts  # REST endpoints (POST /jobs, GET /stats)
├── worker/                 # Independent Workers
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts        # Worker polling loop
│   │   └── processor.ts    # Simulates Email (2s), Report Gen (4s), Image Processing (3s)
└── dashboard/              # React frontend (Vite + TS)
    ├── index.html
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── components/     # StatCard, JobLog, TriggerActions
```

---

### Detailed Implementation Specifications:

#### 1. Redis Data Architecture
Design the system using these Redis key namespaces:
- `queue:waiting` (List): Holds serialized JSON job definitions waiting to be processed.
- `queue:processing` (List/Hash): Atomic buffer holding jobs currently being processed by workers.
- `queue:delayed` (Sorted Set): Holds job IDs with execution Unix timestamps as scores.
- `queue:dlq` (List): Dead Letter Queue for jobs that failed all retry attempts.
- `queue:stats` (Hash): Counter tracking total successes, failures, and enqueued counts.

#### 2. Producer Logic (server/src/queue/producer.ts)
- Implement an enqueue method that generates a unique jobId (UUID/nanoid), wraps the payload, sets retryCount: 0, maxRetries: 3, and serializes it.
- For standard jobs: LPUSH queue:waiting <job_json>
- For delayed jobs: ZADD queue:delayed <timestamp> <job_json>
- Implement an interval loop (every 500ms) executing a lightweight Redis transaction (MULTI/EXEC) to query ZRANGEBYSCORE queue:delayed 0 <current_timestamp>, pop expired jobs, and LPUSH them to queue:waiting.

#### 3. Atomic Worker Loop (worker/src/index.ts)
- Use a polling loop. To prevent race conditions and ensure no jobs are lost, use Redis RPOPLPUSH queue:waiting queue:processing (or BRPOPLPUSH for blocking polls).
- Once a job is pulled:
  - Simulate the task execution inside processor.ts.
  - On Success: Remove the job from queue:processing (LREM) and increment the success counter in queue:stats.
  - On Failure: 
    - Check if retryCount < maxRetries.
    - If yes, increment retryCount, serialize, remove from queue:processing, and put back into queue:waiting.
    - If no, move the job to queue:dlq, remove from queue:processing, and increment the failure counter.

#### 4. Real-time Metrics Engine
- Express server runs a WebSocket server (ws).
- Poll Redis every 1000ms using a pipeline to get:
  - LLEN queue:waiting
  - LLEN queue:processing
  - LLEN queue:dlq
  - HGETALL queue:stats (success/failure counts)
- Broadcast this snapshot to all connected dashboard pages.

#### 5. Premium React Dashboard UI
- Aesthetic: Futuristic dark mode. Deep slate #0f172a background, glassmorphism panels, glowing borders.
- Controls:
  - Button to add 10 instant jobs.
  - Button to add 5 delayed jobs (10-second delay).
  - Button to trigger a job designed to fail (for DLQ demonstration).
- Visualization:
  - Live cards showing counts: Active, Pending, DLQ, Completed, Failed.
  - Log console showing live streaming logs ("Job #102 finished in 2.3s", "Job #103 failed - retrying (1/3)...").
