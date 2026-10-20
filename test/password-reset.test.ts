import { describe, expect, it } from 'vitest';
import {
  PASSWORD_RESET_TTL_MS,
  createPasswordResetService,
  generatePasswordResetToken,
  hashPasswordResetToken,
  type PasswordResetRepository,
  type PasswordResetTokenRecord,
} from '../src/auth/passwordReset';
import type { Mailer } from '../src/auth/mailer';

interface TestUser {
  id: string;
  email: string;
}

function createInMemoryRepo(users: TestUser[] = []) {
  const userList = [...users];
  const tokens = new Map<string, PasswordResetTokenRecord>();
  const passwordHashByUser = new Map<string, string>();
  const sessions = new Map<string, string>(); // sessionId -> userId

  const repo: PasswordResetRepository = {
    async findUserByEmail(email) {
      return userList.find((u) => u.email === email) ?? null;
    },
    async findUserById(id) {
      return userList.find((u) => u.id === id) ?? null;
    },
    async createPasswordResetToken(input) {
      tokens.set(input.tokenHash, {
        id: `t-${tokens.size + 1}`,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
      });
    },
    async findPasswordResetTokenByHash(hash) {
      return tokens.get(hash) ?? null;
    },
    async markPasswordResetTokenUsed(hash) {
      const t = tokens.get(hash);
      if (t) t.usedAt = new Date();
    },
    async updateUserPassword(userId, passwordHash) {
      passwordHashByUser.set(userId, passwordHash);
    },
    async deleteSessionsByUserId(userId) {
      for (const [sessionId, ownerId] of sessions) {
        if (ownerId === userId) sessions.delete(sessionId);
      }
    },
  };

  return { repo, tokens, passwordHashByUser, sessions };
}

function createMockMailer() {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const mailer: Mailer = {
    async sendMail(mail) {
      sent.push({ to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
  return { mailer, sent };
}

const hashPassword = async (p: string) => `hashed:${p}`;

function extractToken(text: string): string {
  const match = text.match(/token=([^&\s\n]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

describe('password reset token', () => {
  it('generates a random token and hashes it with SHA-256', () => {
    const token = generatePasswordResetToken();
    expect(token).toBeTruthy();
    expect(token).not.toBe(generatePasswordResetToken());
    expect(hashPasswordResetToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('password reset service', () => {
  it('resets the password with a token delivered by email', async () => {
    const { repo, passwordHashByUser } = createInMemoryRepo([{ id: 'u1', email: 'u@example.com' }]);
    const { mailer, sent } = createMockMailer();
    const service = createPasswordResetService({
      repository: repo,
      mailer,
      hashPassword,
      baseUrl: 'http://example.com',
    });

    await service.requestReset('u@example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('u@example.com');

    const token = extractToken(sent[0].text);
    expect(token).toBeTruthy();

    const result = await service.resetPassword(token, 'newpass123');
    expect(result.ok).toBe(true);
    expect(passwordHashByUser.get('u1')).toBe('hashed:newpass123');
  });

  it('rejects an expired token', async () => {
    const { repo } = createInMemoryRepo([{ id: 'u1', email: 'u@example.com' }]);
    const { mailer } = createMockMailer();
    const service = createPasswordResetService({ repository: repo, mailer, hashPassword });

    const token = generatePasswordResetToken();
    await repo.createPasswordResetToken({
      tokenHash: hashPasswordResetToken(token),
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await service.resetPassword(token, 'newpass123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EXPIRED');
  });

  it('rejects a reused token', async () => {
    const { repo } = createInMemoryRepo([{ id: 'u1', email: 'u@example.com' }]);
    const { mailer } = createMockMailer();
    const service = createPasswordResetService({ repository: repo, mailer, hashPassword });

    const token = generatePasswordResetToken();
    await repo.createPasswordResetToken({
      tokenHash: hashPasswordResetToken(token),
      userId: 'u1',
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });

    const first = await service.resetPassword(token, 'newpass123');
    expect(first.ok).toBe(true);

    const second = await service.resetPassword(token, 'otherpass456');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('USED');
  });

  it('rejects an unknown token', async () => {
    const { repo } = createInMemoryRepo([{ id: 'u1', email: 'u@example.com' }]);
    const { mailer } = createMockMailer();
    const service = createPasswordResetService({ repository: repo, mailer, hashPassword });

    const result = await service.resetPassword('does-not-exist', 'newpass123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID');
  });

  it('does not send email for unknown users and returns ok', async () => {
    const { repo } = createInMemoryRepo([]);
    const { mailer, sent } = createMockMailer();
    const service = createPasswordResetService({ repository: repo, mailer, hashPassword });

    const result = await service.requestReset('unknown@example.com');
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('invalidates all sessions for the user when the password is reset', async () => {
    const { repo, sessions } = createInMemoryRepo([{ id: 'u1', email: 'u@example.com' }]);
    const { mailer } = createMockMailer();
    const service = createPasswordResetService({ repository: repo, mailer, hashPassword });

    sessions.set('session-1', 'u1');
    sessions.set('session-2', 'u1');

    const token = generatePasswordResetToken();
    await repo.createPasswordResetToken({
      tokenHash: hashPasswordResetToken(token),
      userId: 'u1',
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });

    const result = await service.resetPassword(token, 'newpass123');
    expect(result.ok).toBe(true);
    expect(sessions.size).toBe(0);
  });
});
