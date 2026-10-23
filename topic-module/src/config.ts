
/**
 * ⓘ CODE COMPASS: [Configuration] — ENV configuration loader
 *
 * What is it? A single, typed loader that reads all environment variables the
 * topic-module service needs: database connection data (host, port, user,
 * password, database name), the HTTP port (PORT) and the Brain API base URL
 * (BRAIN_API_BASE_URL) that later steps use to reach the Brain REST API.
 *
 * What is it needed for? Leitregel of this module: no secrets in code — every
 * deployable value arrives via ENV. Having one loader guarantees that the
 * whole service reads configuration through one validated path instead of
 * scattered `process.env` accesses (single source of truth).
 *
 * How does it work? `configFromEnv()` reads the variables, applies documented
 * defaults for local development, validates that required values are present
 * and non-empty, and returns a frozen `ModuleConfig` object.
 *
 * What does it work with? `src/app.ts` (builds the Fastify instance from the
 * config), `src/index.ts` (start script), and the later DB layer (step 2) and
 * Brain client (step 5). Tests inject configurations directly.
 *
 * What happens on errors? A missing required variable makes the loader throw
 * a `ConfigError` with the variable NAME only — never the value — before the
 * service starts. The start script exits with code 1.
 *
 * What to consider on changes? Add new variables here (and to
 * `.env.example`) rather than reading `process.env` elsewhere. Keep the
 * returned object frozen; never log the config (it contains the DB password).
 */

export class ConfigError extends Error {
  constructor(variableName: string) {
    super(`Missing required configuration variable: ${variableName}`);
    this.name = 'ConfigError';
  }
}

export interface ModuleConfig {
  /** MySQL host of the module's OWN database/schema (EU principle). */
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  /** HTTP port the module service listens on. */
  port: number;
  /** Base URL of the Brain REST API (read access, later steps). */
  brainApiBaseUrl: string;
}

function readRequired(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw !== undefined && raw !== '') {
    return raw;
  }
  if (fallback !== undefined) {
    return fallback; // documented development default (may be empty, e.g. DB_PASSWORD)
  }
  throw new ConfigError(name);
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    throw new ConfigError(name);
  }
  return parsed;
}

/**
 * Build the module configuration from environment variables.
 *
 * Defaults follow the Brain core conventions (see src/db/index.ts) and are
 * for local development only; production values are supplied via ENV (see
 * `.env.example` and the Compose file). DB_NAME defaults to the module's
 * dedicated schema `kibrain_topic_dev` — the module never shares the Brain
 * database.
 */
export function configFromEnv(): ModuleConfig {
  const config: ModuleConfig = {
    dbHost: readRequired('DB_HOST', 'localhost'),
    dbPort: readInt('DB_PORT', 3306),
    dbUser: readRequired('DB_USER', 'root'),
    dbPassword: readRequired('DB_PASSWORD', ''),
    dbName: readRequired('DB_NAME', 'kibrain_topic_dev'),
    port: readInt('PORT', 3001),
    brainApiBaseUrl: readRequired('BRAIN_API_BASE_URL', 'http://localhost:3000'),
  };
  return Object.freeze(config);
}
