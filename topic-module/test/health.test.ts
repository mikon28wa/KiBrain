
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { configFromEnv } from '../src/config';

describe('service skeleton', () => {
  it('starts and serves /health with 200 {"status":"ok"}', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('actually listens on a port (start smoke test)', async () => {
    const app = buildApp();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    expect(address).toContain('127.0.0.1');

    const response = await fetch(`${address}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('loads configuration from ENV with documented defaults', () => {
    const previous: Array<[string, string | undefined]> = [
      ['DB_HOST', process.env.DB_HOST],
      ['DB_USER', process.env.DB_USER],
      ['DB_NAME', process.env.DB_NAME],
      ['BRAIN_API_BASE_URL', process.env.BRAIN_API_BASE_URL],
    ];
    try {
      delete process.env.DB_HOST;
      delete process.env.DB_USER;
      delete process.env.DB_NAME;
      delete process.env.BRAIN_API_BASE_URL;
      const config = configFromEnv();
      expect(config.dbHost).toBe('localhost');
      expect(config.dbName).toBe('kibrain_topic_dev');
      expect(config.brainApiBaseUrl).toBe('http://localhost:3000');
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('rejects an invalid PORT with a ConfigError', () => {
    const previous = process.env.PORT;
    try {
      process.env.PORT = 'not-a-number';
      expect(() => configFromEnv()).toThrow(/PORT/);
    } finally {
      if (previous === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previous;
      }
    }
  });
});
