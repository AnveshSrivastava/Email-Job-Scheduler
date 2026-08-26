# ReachInbox Email Job Scheduler

## Overview
A production-ready email scheduling and queueing application. It provides an authenticated React dashboard to schedule, import (CSV/JSON), and monitor email campaigns. The backend asynchronously processes, limits, and reliably delivers these emails using a persistent distributed queue architecture (PostgreSQL + BullMQ + Redis).

## Architecture
The system follows a strict, asynchronous processing model to ensure reliability:

Frontend
→ Express API
→ PostgreSQL
→ Redis/BullMQ
→ Worker
→ SMTP/Ethereal

1. **Frontend**: A React/Vite SPA provides the UI.
2. **Express API**: Handles auth, validation, and writes the initial intention to PostgreSQL, ensuring the database is the absolute source of truth.
3. **BullMQ / Redis**: The API immediately enqueues the database job IDs into Redis (BullMQ).
4. **Worker**: A separate, scalable Node.js worker polls Redis. It enforces concurrency, idempotency, and distributed rate limiting via Lua scripts before claiming the job.
5. **SMTP/Ethereal**: The worker processes the job using Nodemailer and dispatches it.

## Features
**Backend**:
- scheduler
- persistence
- rate limiting
- concurrency
- retry
- idempotency
- authentication
- CSV import

**Frontend**:
- Google login
- dashboard
- compose campaign
- sender management
- scheduled emails
- sent emails
- failed emails
- retry

## Prerequisites
- Docker & Docker Compose
- Node.js v22+ (if running natively outside Docker)
- A Google Cloud Platform account (for OAuth 2.0 Client ID)
- An Ethereal Email account (for testing SMTP delivery)

## Environment Variables
The application is configured via standard environment variables. Review `.env.example` for the required keys. 

**Never commit real credentials.** Provide the following variables to run:
- `DATABASE_URL`
- `REDIS_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `FRONTEND_URL`
- `WORKER_CONCURRENCY`, `MIN_EMAIL_DELAY_MS`, `MAX_EMAILS_PER_HOUR_PER_SENDER`

## Ethereal Email Setup
The system simulates email delivery using Ethereal to prevent sending actual spam during testing.
1. Go to [https://ethereal.email/](https://ethereal.email/)
2. Click **Create Ethereal Account**.
3. Copy the generated Username and Password.
4. Update your `.env` (or directly in `docker-compose.yml`) with:
   ```env
   SMTP_HOST=smtp.ethereal.email
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=<your_ethereal_username>
   SMTP_PASSWORD=<your_ethereal_password>
   SMTP_FROM=ReachInbox Scheduler <test@reachinbox.test>
   ```

*(Note: If you run the project without providing real Ethereal credentials, the dummy values in docker-compose.yml will naturally result in a `535 Authentication failed` error in the worker logs. This proves the queue and worker are functioning correctly, but upstream rejected the payload.)*

## Run With Docker
The repository uses a multi-stage Docker setup.
```bash
docker compose build
docker compose up -d
```
- Access the Frontend at: `http://localhost:8080`
- Access the API at: `http://localhost:3000`

## Run Locally
To run without Docker (assuming local Postgres/Redis):

**Backend:**
```bash
cd backend
npm install
npm run dev
# In a new terminal, start the queue worker:
npm run dev:worker
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Database
Powered by Prisma and PostgreSQL 16. Migrations are automatically applied in the Docker startup sequence (`npx prisma migrate deploy`).
Key models:
- **User**: Stores Google OAuth identity.
- **Sender**: Authorized email addresses.
- **EmailBatch**: Represents a single campaign/import action.
- **EmailJob**: The atomic unit of work representing a single recipient, holding status (`SCHEDULED`, `SENT`, `FAILED`).

## API
Key endpoints:
- `GET /health` - System health check
- `GET /api/v1/auth/google` - Initiate OAuth flow
- `GET /api/v1/auth/me` - Get current authenticated user
- `POST /api/v1/auth/logout` - Clear auth cookies
- `GET /api/v1/senders` - List senders
- `POST /api/v1/senders` - Create a sender
- `GET /api/v1/campaigns` - List email batches
- `POST /api/v1/campaigns` - Schedule a single/multiple emails
- `POST /api/v1/campaigns/import` - Schedule via CSV upload
- `GET /api/v1/campaigns/:id/jobs` - Paginate detailed jobs
- `POST /api/v1/campaigns/:id/retry` - Manually retry failed jobs

### Hourly Rate Limiting
- **Redis-backed:** Tracks the number of successful sends per sender in a specific hour window using a highly efficient Lua script.
- **Per-sender:** The limit applies individually to each sender (e.g. `email-rate:sender-id:2026-08-25T14`).
- **Configurable:** Driven by the `MAX_EMAILS_PER_HOUR_PER_SENDER` environment variable (e.g., 100).
- **Atomic/Concurrency-safe:** Evaluated inside a Redis Lua script, meaning multiple concurrent workers can safely evaluate and increment the limit without race conditions.
- **Jobs are delayed/rescheduled rather than dropped:** When the limit is reached, the worker calculates the timestamp of the next available hour window, updates the Postgres status to `SCHEDULED`, and instructs BullMQ to dynamically delay the job.
- **Behavior when the limit is reached:** No jobs are failed or lost. They gracefully wait in the Redis sorted set until capacity frees up in the next hour.
- **Behavior with multiple workers:** Because the Lua script is atomic, adding multiple horizontal worker containers will never allow the global limit to be exceeded.

### Delay
**`MIN_EMAIL_DELAY_MS`** enforces a strict minimum delay between consecutive emails for the *same sender*. It is backed by a short-lived Redis key (e.g. `sender-throttle:senderId:next`) that stores the exact millisecond when the next email is allowed. If a job attempts to run before this time, the Lua script delays it to that exact millisecond.

### Scheduling
- **BullMQ delayed jobs:** Leverages Redis sorted sets (`zset`) to natively hold jobs in memory until their `scheduledAt` timestamp matures.
- **Redis persistence:** Redis is backed by a Docker volume (`reachinbox_redis_data`), ensuring delayed jobs survive container restarts.
- **PostgreSQL persistence:** The absolute source of truth. Every job has a `EmailJob` record.
- **Restart behavior:** If the entire stack crashes, Redis volumes reload the delayed queues exactly as they were, and jobs that matured during the downtime are processed immediately.
- **Idempotency:** A unique `idempotencyKey` is generated for every batch sequence. The worker strictly verifies that the job's Postgres status is `SCHEDULED` before claiming it, making duplicate sends impossible even under catastrophic network retry scenarios.

### Time Validation
- **Frontend prevents selecting past dates:** The React `datetime-local` input dynamically enforces a `min` attribute based on the exact local timezone of the user's browser. It also runs a pre-submit validation check.
- **Backend independently rejects past scheduledAt values:** The Express API strictly evaluates the incoming timestamp against the server's UTC time. If `scheduledAt <= current server time`, the backend instantly rejects the request with a `400 Bad Request` validation error, preventing stale UI state or API abuse.

## Concurrency
Worker concurrency (`WORKER_CONCURRENCY`, defaulting to 5) dictates how many jobs the Node.js event loop pulls from Redis simultaneously. It is entirely safe because rate limits are strictly enforced via atomic Redis operations *across* all concurrent tasks.

## Testing
The repository features an exhaustive suite of deterministic integration tests checking everything from queue isolation to atomic rate limiting.
```bash
cd backend
npm run typecheck
npm run lint
npm run format
npm run test
```

## Assumptions / Trade-offs
- **Google OAuth**: Must be configured externally in GCP console. Local development redirects won't work unless you supply a valid Client ID/Secret.
- **Ethereal Verification**: Dummy credentials are provided by default to prevent Docker compose from crashing. They will fail to authenticate, which is logged and safely handled by the failure system.
- **Outbox Pattern**: The system enqueues to Redis immediately after committing to Postgres. An Outbox Pattern (polling DB for orphaned jobs) is excluded for assignment scope, meaning a crash in the sub-millisecond window between Postgres commit and Redis publish could conceptually leave a job orphaned.
- **Polling**: The React dashboard polls the backend. WebSockets/SSE would be preferred at a larger scale.

## Demo Checklist
For the evaluation video, the following sequence demonstrates all assignment requirements:
1. Complete the Google OAuth login flow.
2. In the Dashboard, add a Sender.
3. Compose and schedule an email (with a visible delay, e.g., 2 minutes).
4. View the Scheduled table to see the job pending.
5. In your terminal, stop the stack: `docker compose stop worker redis`.
6. Wait 30 seconds to demonstrate downtime.
7. Restart the stack: `docker compose start worker redis`.
8. Watch the dashboard; the job will seamlessly transition to the Sent table when the delay matures, proving full restart persistence.
9. (Optional) Schedule a batch of 10+ emails and watch the worker logs artificially stagger them by 2 seconds each.
