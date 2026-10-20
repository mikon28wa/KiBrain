import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import type { AuthRepository } from './index';

/**
 * Drizzle-backed {@link AuthRepository}. Used in production; tests inject an
 * in-memory repository instead.
 */
export function createDrizzleAuthRepository(database = db): AuthRepository {
  return {
    async findUserByEmail(email) {
      const rows = await database.select().from(users).where(eq(users.email, email)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, email: row.email, passwordHash: row.passwordHash };
    },

    async findUserById(id) {
      const rows = await database.select().from(users).where(eq(users.id, id)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, email: row.email, passwordHash: row.passwordHash };
    },

    async createUser(email, passwordHash) {
      const id = randomUUID();
      await database.insert(users).values({ id, email, passwordHash });
      return { id, email, passwordHash };
    },

    async findSessionByTokenHash(tokenHash) {
      const rows = await database
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, userId: row.userId, tokenHash: row.tokenHash, expiresAt: row.expiresAt };
    },

    async createSession(session) {
      await database.insert(sessions).values({
        id: session.id,
        userId: session.userId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
      });
    },

    async deleteSessionByTokenHash(tokenHash) {
      await database.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
  };
}
