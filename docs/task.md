# Tasks: SwiftQueue Implementation

- [x] 1. Initialize project folders, package.json files, and tsconfig.json configurations.
- [x] 2. Set up Redis connections and base configurations in `server/` and `worker/`.
- [x] 3. Implement the Producer Logic (`server/src/queue/producer.ts`) with delayed jobs interval loop and job reclaimer.
- [x] 4. Implement the Express routes and WebSocket server for live updates.
- [x] 5. Implement the Worker process (`worker/src/index.ts` and `worker/src/processor.ts`) with atomic polling (`BRPOPLPUSH`).
- [x] 6. Build the Vite React Frontend Dashboard with Tailwind CSS and WebSocket listeners.
- [x] 7. Add Dockerfiles and `docker-compose.yml` to bundle all services together.
- [x] 8. Verify the full application and scale workers to test concurrent, race-free executions.
