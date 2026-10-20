import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/api';
import { createAuthService } from '../src/auth';
import { createInMemoryAuthRepository } from './auth-helpers';

const email = 'user@example.com';
const password = 'password123';

function buildTestApp() {
  const service = createAuthService(createInMemoryAuthRepository());
  return { app: buildApp(service), service };
}

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
});
