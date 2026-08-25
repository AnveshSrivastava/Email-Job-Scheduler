# ReachInbox Email Scheduler - Architecture

## Project Goals
Establish a boring, predictable, reproducible foundation for a full-stack email scheduling system. Prioritize maintainability, testability, correctness, and clean separation of concerns.

## High-Level Architecture
*   **Backend/Frontend Separation**: Strict separation between the React frontend and the Express/Node backend.
*   **Database as Source of Truth**: PostgreSQL will hold the primary application state (Users, Jobs, Email Batches).
*   **Redis & BullMQ**: Redis serves as the backing store for BullMQ, which will handle job scheduling and execution infrastructure.

## Status

### IMPLEMENTED
*   Monorepo structure (npm workspaces)
*   Root configuration (TypeScript, Prettier, EditorConfig)
*   Docker Compose (Postgres, Redis infrastructure)
*   Backend basic scaffolding (Express, Health endpoint, config validation)
*   Frontend basic scaffolding (Vite, React, Tailwind)
*   Database domain models via Prisma
*   Database persistence layers (Repositories)
*   BullMQ worker architecture (Queue, Redis)
*   Worker-level restart/idempotency behavior
*   Distributed throttling & rate limiting (Redis Lua script)
*   Minimum delay enforcement (Redis Atomic)
*   SMTP Delivery (Nodemailer / Ethereal SMTP)
*   Email scheduling API (Campaign creation, JSON, CSV ingestion)
*   Authentication (Google OAuth, JWT HttpOnly cookies)

### PLANNED
*   Frontend dashboard (Implemented)

## Domain Model (Phase 2)
The data model uses PostgreSQL as the absolute source of truth. Redis/BullMQ will strictly be used as an execution mechanism in later phases.

```text
User
 │
 ├── Sender
 │
 └── EmailBatch
       │
       └── EmailJob
              │
              └── Sender
```

*   **User**: The root identity (planned Google OAuth integration).
*   **Sender**: User's sending identity/credentials.
*   **EmailBatch**: The grouping entity for a scheduling operation. Tracks aggregated constraints (hourlyLimit, delay).
*   **EmailJob**: The fundamental unit of work. One EmailJob = One recipient delivery. 
    *   Tracks its own state (PENDING -> SCHEDULED -> PROCESSING -> SENT / FAILED).
    *   Uses `idempotencyKey` to prevent duplicate creation from same request.
    *   Uses `sequenceNumber` for strict ordering within a batch.
    *   Timestamps are stored in UTC.
    *   Stores the `bullJobId` for reconciliation, but the job status relies on PostgreSQL.

## Expected Query Patterns
*   Fetch scheduled jobs: `WHERE status = 'SCHEDULED' ORDER BY scheduledAt` -> Handled by composite index `@@index([status, scheduledAt])`.
*   Fetch jobs for batch: `WHERE batchId = ? ORDER BY sequenceNumber` -> Handled by index `@@index([batchId])`.
*   Uniqueness constraints prevent race conditions during insertion and ensure idempotency.

## Application Layer & Queue Consistency (Phase 5)
- **HTTP API to Queue**: When a user creates a campaign, the HTTP controller forwards the request to the `CreateCampaignUseCase`.
- **Transaction Boundary**: The use case atomically creates the `EmailBatch` and all constituent `EmailJob` records in PostgreSQL within a single Prisma transaction, marking them as `SCHEDULED`.
- **Consistency Trade-off (Post-Commit Enqueue)**: Due to the 48-hour assignment limitation, we chose a simple post-commit best-effort enqueue rather than a full transactional outbox pattern. This means if the API process crashes *exactly* after the DB transaction commits but *before* jobs are sent to BullMQ, the jobs will remain stuck in the `SCHEDULED` state. While a true distributed system would require an outbox table and a sweeper, the current design favors architectural simplicity and limits surface area. This behavior was explicitly chosen over a cron sweeper.

## Authentication (Phase 6)
- **Google OAuth**: Users authenticate via `/api/v1/auth/google` which redirects to Google consent.
- **JWT Storage**: Upon callback, the API creates or looks up the user, issues a JWT, and securely sets it as an `HttpOnly`, `SameSite=Lax` cookie.
- **Middleware Boundary**: The `authMiddleware` intercepts all protected routes, verifies the JWT, and attaches the trusted identity to `req.user.id`. The legacy `x-user-id` header is strictly ignored by production routes, ensuring robust zero-trust boundary handling at the Express layer.
- **Business Layer Independence**: The `CreateCampaignUseCase` continues to receive only a trusted `userId` parameter, entirely decoupled from the HTTP transport and authentication mechanics.

## Frontend Architecture (Phase 7)
- **Vite & React**: A minimal SPA utilizing `react-router-dom` for routing and `axios` for API communication.
- **Authentication Flow**: The browser requests `/api/v1/auth/google` to initiate OAuth. Once authenticated, the backend returns an `HttpOnly` JWT cookie. The frontend Axios client specifies `withCredentials: true` to seamlessly append this cookie to all subsequent API requests. The frontend maintains zero state regarding the JWT itself, delegating all token management strictly to the browser's cookie jar.
- **Protected Routes**: The SPA conditionally renders the `/dashboard` and `/campaigns/:id` components based on the success of `/api/v1/auth/me`.
