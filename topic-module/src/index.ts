
/**
 * ⓘ CODE COMPASS: [Start script] — service entry point
 *
 * What is it? The start script of the topic-module service: it loads the ENV
 * configuration, builds the Fastify app and starts listening.
 *
 * What is it needed for? `pnpm dev` (tsx watch) and `pnpm start` (compiled
 * dist) both run this file; the Docker container (see Dockerfile) starts the
 * compiled build with it. It is the only place that binds a port.
 *
 * How does it work? `configFromEnv()` validates the environment, `buildApp()`
 * assembles the HTTP surface, and `listen()` binds 0.0.0.0:{port}.
 *
 * What does it work with? `src/config.ts` and `src/app.ts`.
 *
 * What happens on errors? Configuration errors (ConfigError) are reported to
 * stderr with the variable name and the process exits with code 1; listen
 * errors (e.g. port in use) are logged and also exit with code 1.
 *
 * What to consider on changes? Keep the shutdown path strict: this skeleton
 * has no DB connections yet; once later steps add them, extend the shutdown
 * handling here (close pool before exit) so the stop mode (step 4) and
 * graceful shutdown remain orderly.
 */

import { buildApp } from './app';
import { configFromEnv } from './config';

const config = configFromEnv();
const app = buildApp();

app.listen({ port: config.port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`KiBrain topic-module listening at ${address}`);
});
