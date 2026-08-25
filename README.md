# ReachInbox Email Scheduler

## 1. Project Overview
A production-oriented full-stack email scheduling platform developed as an SDE internship assignment. The system allows authenticated users to configure email senders, compose campaigns, ingest recipients (via manual entry or CSV), and durably schedule emails subject to strict hourly and per-email rate limits. 

## 2. Key Features
*   **Google OAuth Authentication:** Secure login using Google profiles with HttpOnly JWT session cookies.
*   **Campaign Management:** Bulk scheduling via JSON or CSV file ingestion.
*   **Durable Job Queuing:** Background processing using BullMQ and Redis.
*   **Distributed Rate Limiting:** Lua-scripted Redis limiters enforcing exact delays and hourly caps per sender.
*   **Idempotent Execution:** Atomic PostgreSQL status checks ensuring emails are never sent twice.
*   **Observability Dashboard:** A React frontend featuring real-time, state-aware polling of active jobs.
*   **Failure & Retry Handling:** Granular tracking of failed jobs with one-click batch retry capabilities.

## 3. Architecture
The application is a modular monolith containing a RESTful API and a distinct background Worker process. 
*   **PostgreSQL** serves as the absolute source of truth for application state and job lifecycles.
*   **Redis** acts as the high-throughput message broker for BullMQ and the distributed rate limiter.
*   **The API** handles user requests, parses CSVs, transactionally saves jobs to the database, and pushes job IDs to the queue.
*   **The Worker** independently polls BullMQ, claims jobs atomically in PostgreSQL, validates rate limits, and dispatches emails via Nodemailer.

## 4. Tech Stack
*   **Frontend**: React, Vite, TypeScript, Tailwind CSS, React Router, Axios.
*   **Backend**: Node.js, Express.js, TypeScript, Zod.
*   **Database & ORM**: PostgreSQL 16, Prisma.
*   **Queue & Cache**: BullMQ, Redis 7.
*   **Email**: Nodemailer (currently targeting Ethereal SMTP).
*   **Infrastructure**: Docker, Docker Compose.

## 5. Repository Structure
*   `/backend` - Express API, Use Cases, Repositories, and Worker logic.
*   `/frontend` - React SPA (Dashboard, Campaign Management).
*   `docker-compose.yml` - Complete application and infrastructure orchestration.

## 6. Prerequisites
*   Node.js (v22+)
*   npm (v10+)
*   Docker & Docker Compose

## 7. Environment Variables
Copy `.env.example` to `.env` in the root directory. 
Critical variables include:
*   `DATABASE_URL`: Connection string for PostgreSQL.
*   `REDIS_URL`: Connection string for Redis.
*   `JWT_SECRET`: Secret key for signing HttpOnly cookies.
*   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: OAuth 2.0 credentials.
*   `WORKER_CONCURRENCY`: Number of concurrent jobs the BullMQ worker should process.
*   `MIN_EMAIL_DELAY_MS`: Distributed delay enforced between emails for a single sender.
*   `MAX_EMAILS_PER_HOUR_PER_SENDER`: Total emails allowed per sender per rolling hour.

## 8. Local Development Setup
1. Install dependencies across all workspaces:
   ```bash
   npm install
   ```
2. Start the local database and Redis containers:
   ```bash
   docker compose up -d postgres redis
   ```
3. Apply database migrations:
   ```bash
   npm run dev -w backend -- npx prisma migrate dev
   # OR run directly in the backend directory:
   # cd backend && npx prisma migrate dev
   ```
4. Start the backend API, the backend worker, and the frontend React app (in separate terminal tabs):
   ```bash
   npm run dev -w backend
   npm run dev:worker
   npm run dev -w frontend
   ```

## 9. Docker Setup
To run the complete application stack (Database, Redis, API, Worker, and Nginx Frontend) without installing Node locally:
```bash
docker compose up --build
```
*   The frontend will be available at `http://localhost:8080`.
*   The API will be available at `http://localhost:3000`.
*   Database migrations are automatically applied during the backend container startup.

## 10. Database and Prisma
PostgreSQL ensures ACID compliance for all campaign schedules.
*   **Models**: `User`, `Sender`, `EmailBatch`, and `EmailJob`.
*   **Migrations**: Managed by Prisma (`/backend/prisma/schema.prisma`). 
*   **Transactions**: Campaign creation utilizes Prisma's `$transaction` to ensure an `EmailBatch` and its thousands of `EmailJob`s are committed atomically.

## 11. Authentication / Google OAuth
Authentication is handled via `google-auth-library`. 
*   Upon successful OAuth callback, an `HttpOnly`, `SameSite=lax` JWT cookie is issued.
*   The frontend operates entirely without direct access to the token.
*   The backend middleware rigorously enforces strict tenant boundaries; users can only view and schedule against their own `Sender` and `EmailBatch` records.

## 12. Campaign Creation and CSV Ingestion
The `/api/v1/campaigns/import` endpoint uses `multer` (memory storage) and `csv-parse/sync` to ingest recipients. 
*   The backend maps CSV rows to scheduled jobs, evenly spacing their target execution times based on the configured delay.
*   Data is validated via Zod before persistence.

## 13. BullMQ Architecture
*   **Producer**: The `CreateCampaignUseCase` commits jobs to Postgres, then maps the records to BullMQ `queue.add()` calls.
*   **Queue**: Powered by Redis, storing job IDs and target execution timestamps.
*   **Delayed Queue**: Jobs that hit a rate limit are natively shifted to BullMQ's delayed queue.

## 14. Worker Lifecycle
The worker operates as a standalone Node process (`worker.ts`). It claims jobs from BullMQ, interacts with the DB, executes Nodemailer, and reports success/failure. If the worker crashes, BullMQ handles stalled job recovery automatically, redelivering them once a worker comes back online.

## 15. Idempotency / Atomic Job Claiming
To prevent the catastrophic failure of sending duplicate emails (e.g., due to at-least-once delivery or concurrent worker overlap):
*   The worker executes an atomic `UPDATE` against PostgreSQL: `UPDATE EmailJob SET status = 'PROCESSING' WHERE id = X AND status = 'SCHEDULED'`.
*   If the row count is 0, the worker skips the job.
*   This ensures only one process can ever claim and send a specific email.

## 16. Redis Distributed Delay Limiting
A custom Redis Lua script enforces a strict `MIN_EMAIL_DELAY_MS` between sequential emails from the same sender, regardless of how many horizontal worker instances are running.

## 17. Redis Hourly Rate Limiting
The same Lua script maintains an atomic sliding/rolling counter to enforce `MAX_EMAILS_PER_HOUR_PER_SENDER`.
*   If a job hits this limit, it is *not* marked as failed.
*   Instead, the worker resets the DB status to `SCHEDULED` and utilizes BullMQ's `moveToDelayed` to pause execution until the hour rolls over.

## 18. Retry Behavior
Failed jobs (e.g., SMTP timeouts) are tracked distinctly.
*   Users can trigger a retry via `POST /api/v1/campaigns/:id/retry`.
*   This endpoint safely isolates `FAILED` jobs, increments their `attempts` counter, resets them to `SCHEDULED`, and re-enqueues them into BullMQ.

## 19. Frontend Dashboard
The React SPA utilizes a 3-second `useEffect` polling interval on the `CampaignDetails` screen.
*   Polling automatically halts when all jobs in a campaign reach terminal states (`SENT` or `FAILED`).
*   Global state is intentionally kept lightweight using React Context (no Redux/Zustand required).

## 20. API Overview
*   `GET /api/v1/auth/google` - OAuth initiation.
*   `POST /api/v1/auth/logout` - Cookie destruction.
*   `GET /api/v1/senders` - List user senders.
*   `POST /api/v1/campaigns` - Schedule via JSON.
*   `POST /api/v1/campaigns/import` - Schedule via CSV.
*   `GET /api/v1/campaigns/:id/jobs` - Job observability.
*   `POST /api/v1/campaigns/:id/retry` - Batch retry failures.

## 21. Testing
The repository emphasizes rigorous automated testing:
*   **Backend**: 50 robust Integration Tests (Vitest + Supertest) asserting database locks, concurrent queue behavior, and route-level authorization.
*   **Frontend**: React Testing Library component tests.

## 22. Build/Lint/Typecheck Commands
Run these commands from the root directory to validate the workspace:
*   `npm run test` - Execute frontend and backend test suites.
*   `npm run lint` - Run ESLint across all workspaces.
*   `npm run typecheck` - Verify TypeScript typings (`tsc --noEmit`).
*   `npm run format` - Format code via Prettier.
*   `npm run build` - Compile all production artifacts.

## 23. Restart/Recovery Behavior
*   Jobs scheduled for the future are persisted in PostgreSQL.
*   If the worker process is stopped and restarted, BullMQ seamlessly resumes active queues.
*   Stalled jobs (interrupted mid-execution) are eventually reclaimed by BullMQ and re-evaluated by the atomic PostgreSQL status lock.

## 24. Known Limitations
1.  **Ethereal SMTP**: The system currently targets Ethereal (dummy) SMTP for safe assignment evaluation. Real provider integrations (SendGrid, SES) are not yet implemented.
2.  **No Outbox Sweeper**: There is a microscopic, theoretical window between committing the Postgres transaction and enqueuing to BullMQ. If the Node process crashes in that exact millisecond, jobs remain permanently `SCHEDULED` in the DB but absent from the queue.
3.  **Memory Limits**: CSV parsing currently loads the entire file into memory (5MB limit configuration) rather than utilizing disk-streaming.

## 25. Architecture Trade-offs
*   **Skipping the Outbox Pattern**: Implementing a true Outbox pattern requires a dedicated background cron sweeper to reconcile DB states with BullMQ. Given strict assignment time constraints, best-effort post-commit enqueuing was chosen.
*   **Polling over WebSockets**: The frontend dashboard polls the API every 3 seconds. While WebSockets or SSE would be more efficient at scale, polling drastically reduces architectural complexity and infrastructure requirements for this specific feature scope.
