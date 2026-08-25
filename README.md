# ReachInbox Email Scheduler

## Overview
A production-oriented full-stack email scheduling system for an SDE internship assignment. Phase 1 establishes the repository infrastructure, with application features to follow.

## Tech Stack
*   **Backend**: Node.js, TypeScript, Express.js, Prisma, Zod
*   **Frontend**: React, Vite, TypeScript, Tailwind CSS
*   **Database**: PostgreSQL
*   **Queue**: BullMQ (planned)
*   **Cache**: Redis
*   **Infrastructure**: Docker Compose

## Repository Structure
*   `/backend` - Express API and background workers (eventually)
*   `/frontend` - React/Vite dashboard (eventually)
*   `/docs` - Architecture and engineering documentation

## Prerequisites
*   Node.js (v18+)
*   npm
*   Docker & Docker Compose

## Local Setup
1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Create your local environment file: `cp .env.example .env`
4.  Start Docker services (Postgres, Redis): `docker compose up -d`
5.  Run the backend: `npm run dev -w backend`
6.  Run the frontend: `npm run dev -w frontend`

## Environment Variables
See `.env.example` for the required configuration. Do not commit actual secrets to the repository.

## Database
The project uses PostgreSQL as the primary data store and source of truth, managed via Prisma ORM. 
- Local development requires the Docker Compose PostgreSQL instance.
- Run `npx prisma migrate dev` in the `/backend` directory to apply schema changes.
- The schema is located at `/backend/prisma/schema.prisma`.

## Development Commands
*   `npm run dev` - Run development servers for all workspaces
*   `npm run build` - Build all workspaces
*   `npm run test` - Run tests for all workspaces
*   `npm run lint` - Lint all workspaces
*   `npm run typecheck` - Typecheck all workspaces
*   `npm run format` - Format code with Prettier
*   `npm run format:check` - Check formatting

## Domain Model
- **User**: Represents a system user (future Google OAuth identity). Owns senders and batches.
- **Sender**: Represents an SMTP sending identity/configuration associated with a User.
- **EmailBatch**: Represents one scheduling/import operation created by a User, referencing a Sender.
- **EmailJob**: Represents exactly ONE recipient email that should eventually be sent. Owned by a Batch.

## Data Ownership
A User owns Senders and Batches. An EmailBatch owns EmailJobs. The EmailJob is the fundamental unit of work representing one send operation to one recipient.

## Persistence Guarantees
PostgreSQL is the authoritative source of email state. The database guarantees uniqueness of user emails, idempotency keys for jobs, and strict sequence ordering within a batch. It survives process and queue restarts. Note: Database idempotency alone does not guarantee no duplicate SMTP delivery in a distributed environment (this will be addressed in the worker phase).

## Queue & Worker Architecture (Phase 3 & 4)
- **BullMQ**: Acts as the scheduling and queue layer. Jobs are enqueued containing only the `emailJobId`.
- **Redis**: Provides persistence for BullMQ, storing the delayed jobs and active queues. Also serves as the atomic distributed lock and rate limiter storage.
- **Worker**: Consumes jobs, claims them atomically in PostgreSQL to ensure single execution, processes them, and records the `SENT` or `FAILED` state back to the database.
- **Delayed Jobs**: Scheduled jobs calculate their delay and wait in BullMQ natively without polling schedulers.
- **Worker Concurrency**: Configured via the `WORKER_CONCURRENCY` environment variable.
- **Distributed Throttling**: A custom Redis Lua script enforces both a global `MIN_EMAIL_DELAY_MS` and a strict `MAX_EMAILS_PER_HOUR_PER_SENDER` capacity window atomically. If limits are reached, jobs are rescheduled seamlessly back into the BullMQ delayed queue.
- **SMTP Delivery**: Uses `nodemailer` to process actual job delivery. It pulls credentials from environment variables (`SMTP_HOST`, `SMTP_USER`, etc.) to interface cleanly with Ethereal SMTP.
- **Idempotent Processing**: Workers verify job status before proceeding. If a job is already `SENT` or cannot be atomically transitioned from `SCHEDULED` to `PROCESSING`, it is safely ignored.

## Local Infrastructure
- **Starting Services**: Run `docker compose up -d` to start PostgreSQL and Redis.
- **Environment Variables**: Use `.env.example` to set up `DATABASE_URL` and `REDIS_URL`. Ethereal SMTP credentials should be filled in for `SMTP_USER` and `SMTP_PASSWORD`.

## Current Project Status
**Phase 7**: React/Vite Frontend implemented. Full authentication flow and campaign dashboard connected. Use `npm run dev` to start both the backend API and the frontend dashboard.

## API Overview
### Base URL
`http://localhost:3000/api/v1`

### Authentication Endpoints
* `GET /auth/google` - Redirects to Google OAuth.
* `GET /auth/google/callback` - OAuth callback (returns HttpOnly JWT cookie).
* `GET /auth/me` - Get current authenticated user.
* `POST /auth/logout` - Clear JWT cookie.

### Protected Endpoints (Requires HttpOnly JWT Cookie)
* `POST /campaigns` - Create a new email campaign (JSON).
* `POST /campaigns/import` - Create a campaign via CSV upload (multipart/form-data).
* `GET /campaigns/:id` - Retrieve campaign metadata.
* `GET /campaigns/:id/jobs` - Retrieve paginated jobs for a campaign.

### Example: Create Campaign
```bash
curl -X POST http://localhost:3000/api/v1/campaigns \\
  -H "Content-Type: application/json" \\
  --cookie "token=<jwt_token>" \\
  -d '{
    "senderId": "<sender-uuid>",
    "subject": "Hello",
    "body": "World",
    "startAt": "2026-08-25T15:00:00.000Z",
    "delaySeconds": 2,
    "hourlyLimit": 100,
    "recipients": [{"email": "alice@example.com"}]
  }'
```

### Example: CSV Import
```bash
curl -X POST http://localhost:3000/api/v1/campaigns/import \\
  --cookie "token=<jwt_token>" \\
  -F "senderId=<sender-uuid>" \\
  -F "subject=Hello CSV" \\
  -F "body=World" \\
  -F "startAt=2026-08-25T15:00:00.000Z" \\
  -F "delaySeconds=2" \\
  -F "hourlyLimit=100" \\
  -F "file=@recipients.csv"
```

## Testing
Run `npm run test` from the root to execute all workspace tests.

## Architecture
See `docs/architecture.md` for engineering design decisions.

## Git Workflow
Ensure all code passes `npm run typecheck`, `npm run lint`, and `npm run test` before committing.
# Email-Job-Scheduler

### Sender Management Endpoints
* `GET /senders` - List senders belonging to the authenticated user.
* `POST /senders` - Create a new sender identity.
