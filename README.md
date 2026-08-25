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

## Development Commands
*   `npm run dev` - Run development servers for all workspaces
*   `npm run build` - Build all workspaces
*   `npm run test` - Run tests for all workspaces
*   `npm run lint` - Lint all workspaces
*   `npm run typecheck` - Typecheck all workspaces
*   `npm run format` - Format code with Prettier
*   `npm run format:check` - Check formatting

## Current Project Status
**Phase 1**: Infrastructure & tooling setup. Application features (scheduling, database models, etc.) are implemented incrementally in later phases.

## Testing
Run `npm run test` from the root to execute all workspace tests.

## Architecture
See `docs/architecture.md` for engineering design decisions.

## Git Workflow
Ensure all code passes `npm run typecheck`, `npm run lint`, and `npm run test` before committing.
# Email-Job-Scheduler
