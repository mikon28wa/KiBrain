import { describe, expect, it } from 'vitest';
import { createAuthService, hashSessionToken } from '../src/auth';
import { createInMemoryAuthRepository } from './auth-helpers';

const email = 'user@example.com';
const password = 'password123';

describe('auth service', () => {
  it('registers a user and stores a bcrypt hash (not the plain password)', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);

    const result = await service.register(email, password);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.email).toBe(email);
      expect(result.user.passwordHash).not.toBe(password);
      expect(result.user.passwordHash).toMatch(/^\$2/); // bcrypt hash prefix
    }
  });

  it('rejects a duplicate email', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);

    await service.register(email, password);
    const result = await service.register(email, password);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with correct credentials and returns a session token', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);
    await service.register(email, password);

    const result = await service.login(email, password);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toBeTruthy();
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('rejects a wrong password', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);
    await service.register(email, password);

    const result = await service.login(email, 'wrong-password');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login for an unknown email', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);

    const result = await service.login('nobody@example.com', password);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('resolves a valid session to its user', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);
    await service.register(email, password);
    const login = await service.login(email, password);
    if (!login.ok) throw new Error('login failed');

    const user = await service.getUserBySessionToken(login.token);

    expect(user?.email).toBe(email);
  });

  it('expires sessions after the TTL', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);
    await service.register(email, password);
    const login = await service.login(email, password);
    if (!login.ok) throw new Error('login failed');

    const session = repo.sessions.get(hashSessionToken(login.token));
    expect(session).toBeDefined();
    session!.expiresAt = new Date(Date.now() - 1000);

    const user = await service.getUserBySessionToken(login.token);

    expect(user).toBeNull();
  });

  it('logs out by deleting the session', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);
    await service.register(email, password);
    const login = await service.login(email, password);
    if (!login.ok) throw new Error('login failed');

    await service.logout(login.token);

    const user = await service.getUserBySessionToken(login.token);
    expect(user).toBeNull();
  });
});
