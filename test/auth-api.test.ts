import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/api';
import { createAuthService } from '../src/auth';
import type { PasswordResetService } from '../src/auth/passwordReset';
import { createInMemoryAuthRepository } from './auth-helpers';

const email = 'user@example.com';
const password = 'password123';

function buildTestApp() {
  const service = createAuthService(createInMemoryAuthRepository());
  return { app: buildApp(service), service };
}

const mockPasswordResetService: PasswordResetService = {
  requestReset: async () => ({ ok: true }),
  resetPassword: async () => ({ ok: true }),
};

describe('auth routes', () => {
  it('registers a user', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe(email);
  });

  it('returns 409 for a duplicate email', async () => {
    const { app } = buildTestApp();
    await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(409);
  });

  it('sets an HttpOnly Secure 7-day session cookie on login', async () => {
    const { app } = buildTestApp();
    await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('Max-Age=604800');
    expect(header).toContain('SameSite=Lax');
  });

  it('returns 401 for a wrong password', async () => {
    const { app } = buildTestApp();
    await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrong' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('clears the session cookie on logout', async () => {
    const { app } = buildTestApp();
    await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(header).toContain('Max-Age=0');
  });

  it('rejects registration with an invalid email (400)', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: { field: string }) => e.field)).toContain('email');
  });

  it('rejects registration with a password shorter than 8 characters (400)', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'short' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: { field: string }) => e.field)).toContain('password');
  });

  it('rejects registration with a password longer than 72 bytes (400)', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'a'.repeat(73) },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: { field: string }) => e.field)).toContain('password');
  });

  it('rate-limits registration to 5 requests per minute per IP', async () => {
    const { app } = buildTestApp();

    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(429);
  });

  it('rate-limits login to 5 requests per minute per IP', async () => {
    const { app } = buildTestApp();

    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(429);
  });

  it('rate-limits password-reset requests to 5 per minute per IP', async () => {
    const app = buildApp(undefined, undefined, mockPasswordResetService);

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/auth/password-reset/request',
        payload: { email },
      });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email },
    });

    expect(response.statusCode).toBe(429);
  });

  it('rejects password reset with a short password (400)', async () => {
    const app = buildApp(undefined, undefined, mockPasswordResetService);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      payload: { token: 'token', password: 'short' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: { field: string }) => e.field)).toContain('password');
  });

  it('rejects password reset with a password longer than 72 bytes (400)', async () => {
    const app = buildApp(undefined, undefined, mockPasswordResetService);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      payload: { token: 'token', password: 'a'.repeat(73) },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: { field: string }) => e.field)).toContain('password');
  });
});
