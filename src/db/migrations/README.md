# Database migrations

This directory is managed by drizzle-kit.

- `npm run db:generate` creates SQL migrations from `src/db/schema.ts`.
- `npm run db:migrate` applies them to the configured MySQL database.
