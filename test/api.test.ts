import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/api';

describe('api', () => {
  it('serves a health check', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
