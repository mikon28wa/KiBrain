import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { passwordResetTokens, sessions, users } from '../db/schema';
import type { Mailer } from './mailer';

/** Password-reset tokens are valid for one hour. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** Generate a cryptographically random one-time password-reset token. */
export function generatePasswordResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash a password-reset token (SHA-256) before persisting it. */
export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface PasswordResetRepository {
  findUserByEmail(email: string): Promise<{ id: string; email: string } | null>;
  findUserById(id: string): Promise<{ id: string; email: string } | null>;
  createPasswordResetToken(input: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void>;
  findPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  markPasswordResetTokenUsed(tokenHash: string): Promise<void>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  /** Delete every session belonging to the user (revokes stolen cookies). */
  deleteSessionsByUserId(userId: string): Promise<void>;
}

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: { code: 'INVALID' | 'EXPIRED' | 'USED'; message: string } };

export interface PasswordResetService {
  requestReset(email: string): Promise<{ ok: true }>;
  resetPassword(token: string, newPassword: string): Promise<ResetPasswordResult>;
}

export interface PasswordResetDeps {
  repository: PasswordResetRepository;
  mailer: Mailer;
  hashPassword: (password: string) => Promise<string>;
  now?: () => number;
  /** Optional base URL used to build the reset link in the email. */
  baseUrl?: string;
}

export function createPasswordResetService(deps: PasswordResetDeps): PasswordResetService {
  const { repository, mailer, hashPassword } = deps;
  const now = deps.now ?? (() => Date.now());

  async function sendResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = deps.baseUrl
      ? `${deps.baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`
      : undefined;

    await mailer.sendMail({
      to: email,
      subject: 'Passwort zurücksetzen',
      text: resetUrl
        ? `Setze dein Passwort über diesen Link zurück: ${resetUrl}\nDieser Link ist 1 Stunde gültig.`
        : `Dein Code zum Zurücksetzen des Passworts: ${token}\nDieser Code ist 1 Stunde gültig.`,
    });
  }

  return {
    async requestReset(email) {
      const user = await repository.findUserByEmail(email);
      if (user) {
        const token = generatePasswordResetToken();
        const tokenHash = hashPasswordResetToken(token);
        const expiresAt = new Date(now() + PASSWORD_RESET_TTL_MS);
        await repository.createPasswordResetToken({ tokenHash, userId: user.id, expiresAt });
        await sendResetEmail(email, token);
      }
      // Always respond identically to avoid leaking whether the email exists.
      return { ok: true };
    },

    async resetPassword(token, newPassword) {
      const tokenHash = hashPasswordResetToken(token);
      const record = await repository.findPasswordResetTokenByHash(tokenHash);
      if (!record) {
        return { ok: false, error: { code: 'INVALID', message: 'Ungültiges Token' } };
      }
      if (record.usedAt) {
        return { ok: false, error: { code: 'USED', message: 'Token wurde bereits verwendet' } };
      }
      if (record.expiresAt.getTime() <= now()) {
        return { ok: false, error: { code: 'EXPIRED', message: 'Token ist abgelaufen' } };
      }

      const user = await repository.findUserById(record.userId);
      if (!user) {
        return { ok: false, error: { code: 'INVALID', message: 'Ungültiges Token' } };
      }

      const passwordHash = await hashPassword(newPassword);
      await repository.updateUserPassword(user.id, passwordHash);
      await repository.deleteSessionsByUserId(user.id);
      await repository.markPasswordResetTokenUsed(tokenHash);
      return { ok: true };
    },
  };
}

export function createDrizzlePasswordResetRepository(
  database = db,
): PasswordResetRepository {
  return {
    async findUserByEmail(email) {
      const rows = await database
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserById(id) {
      const rows = await database
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async createPasswordResetToken(input) {
      await database.insert(passwordResetTokens).values({
        id: randomUUID(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      });
    },

    async findPasswordResetTokenByHash(tokenHash) {
      const rows = await database
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
      };
    },

    async markPasswordResetTokenUsed(tokenHash) {
      await database
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.tokenHash, tokenHash));
    },

    async updateUserPassword(userId, passwordHash) {
      await database.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async deleteSessionsByUserId(userId) {
      await database.delete(sessions).where(eq(sessions.userId, userId));
    },
  };
}
