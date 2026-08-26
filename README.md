# ReachInbox Email Scheduler

A full-stack, production-ready system for scheduling and managing email campaigns. The application ensures reliable, rate-limited email delivery using background workers, persistent storage, and robust error handling, featuring a comprehensive dashboard for manual and bulk (CSV) campaign management.

## Features

### Backend
- Email scheduling with precision and reliability
- BullMQ delayed jobs for execution timing
- Persistent PostgreSQL storage for application state and job tracking
- Worker concurrency control
- Configurable minimum delay between email sends
- Redis-backed per-sender hourly rate limiting
- Rate-limit rescheduling to the next available hour
- Idempotent job claiming / duplicate-processing protection
- SMTP delivery through Ethereal (test SMTP provider)
- Persistence across application/worker restarts

### Frontend
- Google OAuth authentication
- User profile, header, and secure logout
- Scheduled emails view and Sent emails view
- Compose campaign flow
- CSV recipient upload and parsing
- Scheduling controls with defensive HTML5 timezone-aware inputs
- Delay and hourly-limit configuration
- Loading, empty, and error states
- Human-readable validation errors explicitly mapped from API responses

## Tech Stack

- **Frontend:** React, React Router, TailwindCSS, Vite
- **Backend:** Node.js, Express.js, TypeScript
- **Database:** PostgreSQL
- **Queue:** BullMQ
- **Cache/Rate Limiting:** Redis
- **SMTP:** Nodemailer (configured for Ethereal)
- **ORM:** Prisma
- **Infrastructure:** Docker, Docker Compose
- **Testing:** Vitest, Supertest, Testing Library

## Project Structure

```text
/
├── backend/            # Express API, BullMQ Worker, Prisma schemas, and Backend Tests
├── frontend/           # React SPA, Tailwind config, and Frontend Tests
├── docker-compose.yml  # Container orchestration for Postgres, Redis, API, Worker, and Frontend
└── README.md
```

## Prerequisites

- Node.js (v20+ recommended)
- npm
- Docker and Docker Compose (for spinning up Postgres and Redis)
- Google OAuth Credentials (Client ID & Secret)
- Ethereal Email Credentials (for SMTP)

## Environment Variables

### Backend (`.env`)

| Variable | Purpose | Required | Example/Placeholder |
|---|---|---|---|
| `NODE_ENV` | Environment mode | Yes | `development` |
| `PORT` | API Server Port | Yes | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | Yes | `postgresql://user:pass@localhost:5432/db` |
| `REDIS_URL` | Redis connection string | Yes | `redis://localhost:6379` |
| `WORKER_CONCURRENCY` | Concurrent jobs per worker | Yes | `5` |
| `MIN_EMAIL_DELAY_MS` | Delay between sequence sends | Yes | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Fallback hourly limit | Yes | `100` |
| `SMTP_HOST` | SMTP server host | Yes | `smtp.ethereal.email` |
| `SMTP_PORT` | SMTP server port | Yes | `587` |
| `SMTP_SECURE` | Use TLS | Yes | `false` |
| `SMTP_USER` | Ethereal username | Yes | `your_ethereal_user` |
| `SMTP_PASSWORD` | Ethereal password | Yes | `your_ethereal_pass` |
| `SMTP_FROM` | Default From address | Yes | `ReachInbox Scheduler <test@reachinbox.test>` |
| `JWT_SECRET` | Secret for signing sessions | Yes | `your_jwt_secret` |
| `GOOGLE_CLIENT_ID` | OAuth Client ID | Yes | `...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth Secret | Yes | `your_google_secret` |
| `GOOGLE_CALLBACK_URL` | OAuth redirect URI | Yes | `http://localhost:3000/api/v1/auth/google/callback` |
| `FRONTEND_URL` | Permitted CORS origin | Yes | `http://localhost:8080` (or 5173 for dev) |

### Frontend (`frontend/.env`)

| Variable | Purpose | Required | Example/Placeholder |
|---|---|---|---|
| `VITE_API_URL` | Base URL for API requests | Yes | `http://localhost:3000/api/v1` |

## Setup

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd reachinbox-email-scheduler
   ```

2. **Configure Environment Variables**
   - Copy `.env.example` to `.env` in the root (used for backend configuration).
   - Copy `frontend/.env.example` to `frontend/.env`.
   - Populate your Google OAuth and Ethereal credentials.

3. **Start Infrastructure (PostgreSQL & Redis)**
   ```bash
   docker compose up -d postgres redis
   ```

4. **Backend Setup**
   ```bash
   cd backend
   npm install
   npx prisma db push
   npm run dev          # Starts the Express API on port 3000
   ```

5. **Worker Setup** (In a new terminal)
   ```bash
   cd backend
   npm run dev:worker   # Starts the standalone BullMQ worker process
   ```

6. **Frontend Setup** (In a new terminal)
   ```bash
   cd frontend
   npm install
   npm run dev          # Starts Vite dev server
   ```

## Ethereal Email Setup

This project uses [Ethereal Email](https://ethereal.email/) to simulate SMTP deliveries without sending real emails.
1. Visit [ethereal.email](https://ethereal.email/) and click "Create Ethereal Account".
2. Copy the provided Username and Password.
3. Paste them into `SMTP_USER` and `SMTP_PASSWORD` in your `.env` file.
4. When campaigns are processed, emails are "sent" to Ethereal. You can view the rendered test emails in the Ethereal web interface under the "Messages" tab.

## Architecture

```text
Frontend
   ↓
Express API
   ↓
PostgreSQL
   ↓
BullMQ / Redis
   ↓
Email Worker
   ↓
Redis Rate Limiter
   ↓
Ethereal SMTP
```

### Scheduling Flow
1. **API Entry:** A user uploads a JSON or CSV payload to `/api/v1/campaigns`.
2. **Job Creation:** The API validates the payload (Zod) and inserts `EmailJob` records into PostgreSQL for each recipient, tracking sequence numbers and calculating incremental scheduled times based on the minimum delay.
3. **Queueing:** The API schedules these jobs in BullMQ using the native delayed jobs mechanism (NOT cron polling).
4. **Execution:** The BullMQ Worker natively receives the job exactly when the delayed timestamp matures.
5. **Dispatch:** The worker claims the job atomically in Postgres, enforces the hourly rate limit in Redis, and dispatches the payload via Nodemailer to Ethereal.
6. **State Update:** The job is marked as `SENT` (or `FAILED`) in Postgres.

### Persistence and Restart Behavior
- **API Restart:** Active HTTP requests fail, but state remains consistent in Postgres.
- **Worker Restart:** If a worker crashes mid-send, BullMQ's native lock timeout triggers. The job is marked as stalled and safely retried without being lost.
- **Durable Storage:** The exact intent (campaigns, users, scheduling bounds) is stored in Postgres. Redis purely manages the temporal mechanics (delays, active locks, rate limit counters). Scheduled jobs completely survive total application and worker restarts.

### Concurrency and Idempotency
- **State Flow:** `SCHEDULED` → `PROCESSING` → `SENT`
- **Database Claim:** The worker executes an atomic SQL query: `UPDATE EmailJob SET status = 'PROCESSING' WHERE id = ? AND status = 'SCHEDULED'`. If zero rows are returned, the worker instantly aborts. This inherently guarantees that two parallel worker nodes popping the same job ID cannot duplicate the send.
- **SMTP Guarantee Trade-off:** The system guarantees *at-most-once* database claiming. However, standard SMTP lacks a two-phase commit protocol. If the worker crashes explicitly *after* the SMTP server acknowledges the email, but *before* the Postgres `SENT` update executes, the job will eventually retry. Therefore, absolute exactly-once delivery cannot be guaranteed without external SMTP provider idempotency keys (which Nodemailer/Ethereal do not natively support).

### Rate Limiting
- **Scope:** Enforced as an *hourly limit per sender per campaign*.
- **Storage:** Counters are maintained atomically in Redis using an isolated Lua script.
- **Atomicity:** The key combines the sender ID and the current hour string (e.g., `email-rate:sender-xyz:2026-08-26T14`). 
- **Rescheduling:** If the Lua script rejects the job (the hourly limit is reached), the worker intentionally halts and propagates a `DelayedError` to BullMQ. BullMQ natively reschedules the job to the start of the next hour (preserving the `originalScheduledAt` intent in Postgres).
- Jobs are *never* dropped or permanently failed due to rate limits; they simply cascade into the future gracefully.

### Send Delay and Worker Concurrency
- **Worker Concurrency:** Configured globally via `WORKER_CONCURRENCY` (parallel jobs pulled by BullMQ).
- **Minimum Delay:** Enforced per-campaign (`delaySeconds`). Jobs are spaced sequentially during the Postgres insertion phase so they inherently mature in BullMQ sequentially.

## API Overview

| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| `GET` | `/api/v1/auth/google` | Initiates Google OAuth flow |
| `GET` | `/api/v1/auth/me` | Fetches the authenticated user profile (Requires JWT) |
| `GET` | `/api/v1/senders` | Retrieves a list of available sender identities |
| `POST` | `/api/v1/campaigns` | Creates a new campaign (JSON) |
| `POST` | `/api/v1/campaigns/import` | Creates a new campaign (CSV `multipart/form-data`) |
| `GET` | `/api/v1/campaigns/:id` | Retrieves aggregated campaign details |
| `GET` | `/api/v1/campaigns/:id/jobs` | Retrieves paginated status of individual jobs |

*Validation errors adhere to a strict structure:* `{ error: { code: "VALIDATION_ERROR", details: ["Message 1", "Message 2"] } }`

## Frontend

**User Flow:**
1. User logs in via **Google OAuth**.
2. **Dashboard** displays historical campaigns.
3. User navigates to **New Campaign**.
4. User selects manual entry or **CSV recipient upload**.
5. User explicitly selects a future **Start At** time and configures delays/limits.
6. User clicks submit. The UI extracts the successful `batchId` and instantaneously navigates to the details page without requiring a manual refresh.
7. User observes the **Scheduled emails** progressing to **Sent emails** in real-time.

## CSV / Recipient Handling

- **Format:** Standard comma-separated values (`.csv`).
- **Detection:** The backend explicitly parses the CSV buffer looking for an `email` column header.
- **Validation:** Missing files, empty records, and missing `email` columns are strictly rejected before job scheduling, returning precise human-readable errors (e.g., "Your CSV must contain an 'email' column.").

## Error Handling

- **Invalid Schedule Time:** The frontend enforces a dynamic `min` time bound and explicitly prevents past-dated submissions ("That time has already passed...").
- **Validation Errors:** Zod errors are joined and mapped into human-readable banners ("Please enter an email subject."). Form states are fully preserved so users do not lose their input.
- **Network Errors:** Safely caught via an interceptor utility ("Unable to connect to the server.").
- Internal JavaScript exceptions (e.g., `.id of undefined`) have been completely eradicated from the UI flows.

## Configuration

| Configuration | Purpose | Example |
| ------------- | ------- | ------- |
| `WORKER_CONCURRENCY` | Maximum simultaneous jobs processed by the BullMQ worker | `5` |
| `MIN_EMAIL_DELAY_MS` | Global fallback delay spacing | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Global fallback hourly limit | `100` |
| `PORT` | API Server execution port | `3000` |

## Testing

The project is heavily tested utilizing `vitest`.

- **Backend:** 56 tests covering routing, idempotency locks, Redis rate-limiting loops, BullMQ delay states, and CSV boundaries.
- **Frontend:** 8 tests covering robust DOM manipulation, Axios error interception, and dynamic datetime calculations.
- **Verification Commands:**
  ```bash
  cd frontend && npm run test && npm run typecheck && npm run build
  cd backend && npm run test && npm run typecheck && npm run lint
  ```

## Production / Deployment Notes

To run the complete system natively in Docker:
```bash
docker compose up --build -d
```
- **Services Initialized:** `postgres`, `redis`, `backend`, `worker`, and `frontend`.
- **Requirements:** Ensure your root `.env` is populated with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and Ethereal credentials prior to building the containers.
- The `frontend` is built directly into static assets via Vite, served via an internal mechanism.
- The `worker` container runs isolated from the `backend` container, facilitating horizontal scaling.

## Design Decisions & Trade-offs

- **BullMQ Delayed Jobs vs Cron:** Cron jobs introduce significant polling overhead and latency. BullMQ's delayed mechanism offloads temporal tracking natively to Redis, drastically improving sub-second dispatch accuracy.
- **Redis Rate Limiting:** Utilizes fixed-window hourly buckets instead of a rolling window to minimize Lua script complexity and Redis memory overhead, though it technically permits clustered bursting directly across the hour boundary.
- **PostgreSQL Source of Truth:** BullMQ jobs are transient by nature. Persisting individual `EmailJob` records in Postgres ensures data durability across catastrophic Redis failures and powers paginated historical queries.

## Assignment Requirement Mapping

| Requirement | Implementation |
|---|---|
| TypeScript backend | ✅ Implemented (Node/Express/TypeScript) |
| Express.js | ✅ Implemented |
| BullMQ + Redis | ✅ Implemented (Job delays & Workers) |
| PostgreSQL | ✅ Implemented (Prisma ORM) |
| Ethereal SMTP | ✅ Implemented (Nodemailer) |
| Delayed scheduling | ✅ Implemented (BullMQ `delay` parameter) |
| Worker concurrency | ✅ Implemented (`WORKER_CONCURRENCY` env) |
| Minimum send delay | ✅ Implemented (Incremental `startAt` manipulation) |
| Hourly rate limiting | ✅ Implemented (Redis Lua scripts & `DelayedError`) |
| Persistent jobs | ✅ Implemented (PostgreSQL durability) |
| Idempotency/concurrency protection | ✅ Implemented (Atomic SQL `UPDATE` claims) |
| Google OAuth | ✅ Implemented (Google Auth Library) |
| Compose campaign | ✅ Implemented (JSON Payload) |
| CSV upload | ✅ Implemented (Multer + `csv-parse`) |
| Scheduled emails | ✅ Implemented (Dashboard Details View) |
| Sent emails | ✅ Implemented (Dashboard Details View) |
| Error handling | ✅ Implemented (Centralized Axios interceptor & Zod mappings) |

## Demo

When recording a demo video for this repository, you should demonstrate:
1. **Login:** Successfully authenticating via Google.
2. **Compose Campaign:** The empty datetime field, filling out a CSV/JSON payload, and selecting a future date.
3. **Scheduled Emails:** Submitting the campaign and observing the immediate, crash-free navigation to the Details dashboard.
4. **Sent Emails:** Observing the UI reflect the `SCHEDULED` to `SENT` transition.
5. **Validation Error:** Attempting to schedule a campaign in the past to demonstrate the human-readable UI protection.
6. **Persistence:** (Optional) Restarting the backend worker during a dispatch to show BullMQ's automatic recovery.

*(Demo URL placeholder)*

## Known Limitations

- **Ethereal Delivery Sandbox:** The application utilizes Ethereal Email. No physical emails will reach actual external inboxes unless the SMTP variables are swapped to a production relay (e.g., SendGrid).
- **External SMTP Idempotency:** The worker ensures at-most-once database claims, but relies on a non-transactional SMTP handshake, risking duplicate emails in the event of an abrupt power loss explicitly between the SMTP `250 OK` response and the final Postgres `UPDATE` query. 
