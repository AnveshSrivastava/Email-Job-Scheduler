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

### PLANNED
*   Database domain models via Prisma
*   Authentication (Google OAuth)
*   Email scheduling API
*   BullMQ worker architecture
*   Distributed throttling & rate limiting
*   Idempotency handling
*   Restart and failure behavior
*   Frontend dashboard
