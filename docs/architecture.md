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

### PLANNED
*   Authentication (Google OAuth)
*   Email scheduling API
*   BullMQ worker architecture
*   Distributed throttling & rate limiting
*   Idempotency handling (worker level reconciliation)
*   Restart and failure behavior
*   Frontend dashboard

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
