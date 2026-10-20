import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth';

describe('auth', () => {
  it('hashes a password and verifies it', async () => {
    const password = 'correct horse battery staple';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });
});
