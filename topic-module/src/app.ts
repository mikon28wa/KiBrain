
/**
 * ⓘ CODE COMPASS: [Application] — Fastify application factory
 *
 * What is it? `buildApp()` constructs the Fastify application instance of the
 * topic-module service WITHOUT starting it (same pattern as the Brain core,
 * which keeps the app testable via `app.inject()`).
 *
 * What is it needed for? It is the single place where the HTTP surface of the
 * module is assembled. Step 1 wires only the health endpoint; later steps
 * (REST endpoints, MCP server) register their routes/plugins here.
 *
 * How does it work? A Fastify instance is created with logging disabled
 * (matching the Brain core) and the health route is registered:
 * GET /health → 200 {"status":"ok"}.
 *
 * What does it work with? `src/index.ts` (start script) calls it and listens
 * on the configured port; `test/health.test.ts` injects requests into it.
 *
 * What happens on errors? Route-level errors are turned into Fastify's
 * default 500 responses (no stack or data disclosure in responses). Startup
 * misconfiguration (e.g. invalid PORT) fails in the start script, not here.
 *
 * What to consider on changes? Keep this factory side-effect free (no
 * listening, no DB connections) so tests stay hermetic. Register new routes
 * in dedicated files and compose them here; keep the health endpoint free of
 * dependencies so it remains usable for uptime monitoring in production
 * (step 34).
 */

import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: false });

  /**
   * Liveness endpoint. Deliberately dependency-free: no DB check, no auth.
   * Monitors uptime (step 34); it reveals only that the process serves
   * requests, no data.
   */
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
