# KiBrain

TypeScript/Node scaffold with a Fastify API, Drizzle ORM (MySQL), auth utilities and an
MCP placeholder module, plus a React (Vite) frontend in `web/` and a VS Code extension
placeholder in `extension/`.

## Folder structure

```
src/
  db/        Drizzle schema + MySQL connection
  auth/      Password hashing/verification (bcrypt)
  api/       Fastify application
  mcp/       Model Context Protocol helpers (placeholder)
web/         React frontend (Vite + TypeScript)
extension/   VS Code extension (placeholder)
```

## Setup

1. Install dependencies:

   ```sh
   npm install
   cd web && npm install && cd ..
   ```

2. Configure the database by copying `.env.example` to `.env` and filling in your
   local MySQL development database credentials (`DB_HOST`, `DB_USER`, `DB_PASSWORD`,
   `DB_NAME`).

3. Generate/apply database migrations (optional):

   ```sh
   npm run db:generate   # create SQL migrations from src/db/schema.ts
   npm run db:migrate    # apply migrations to the database
   ```

## Scripts

| Command               | Description                                   |
| --------------------- | --------------------------------------------- |
| `npm run build`       | Compile TypeScript to `dist/`                 |
| `npm test`            | Run the Vitest test suite                     |
| `npm run lint`        | Lint the codebase with ESLint                 |
| `npm run dev`         | Run the API in watch mode (tsx)               |
| `npm start`           | Run the compiled API                          |
| `npm run db:generate` | Generate Drizzle SQL migrations               |
| `npm run db:migrate`  | Apply Drizzle migrations                      |

The web frontend lives in `web/` and has its own scripts (`cd web && npm run dev`,
`npm run build`).
