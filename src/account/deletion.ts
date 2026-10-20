import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db';
import { apiTokens, auditLog, chats, passwordResetTokens, sessions, users } from '../db/schema';

/** Accounts are hard-deleted 30 days after the deletion was requested. */
export const DELETION_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** Storage boundary for account-deletion operations. */
export interface DeletionRepository {
  /** Lock the account: set `deletion_requested_at`. */
  setDeletionRequestedAt(userId: string, at: Date): Promise<void>;
  getDeletionRequestedAt(userId: string): Promise<Date | null>;
  /** Unlock the account: clear `deletion_requested_at`. */
  clearDeletionRequestedAt(userId: string): Promise<void>;
  /** Hard-delete every account whose request is at or before `cutoff`. */
  deleteAccountsRequestedBefore(cutoff: Date): Promise<number>;
}

export interface DeletionService {
  requestDeletion(userId: string): Promise<{ ok: true; requestedAt: Date }>;
  revokeDeletion(userId: string): Promise<{ ok: true; revoked: boolean }>;
  /** Run the periodic deletion job; `at` is a timestamp in milliseconds. */
  deleteExpiredAccounts(at?: number): Promise<number>;
}

export function createDeletionService(
  repository: DeletionRepository,
  now: () => number = () => Date.now(),
): DeletionService {
  return {
    async requestDeletion(userId) {
      const requestedAt = new Date(now());
      await repository.setDeletionRequestedAt(userId, requestedAt);
      return { ok: true, requestedAt };
    },

    async revokeDeletion(userId) {
      const requestedAt = await repository.getDeletionRequestedAt(userId);
      if (!requestedAt) {
        return { ok: true, revoked: false };
      }
      await repository.clearDeletionRequestedAt(userId);
      return { ok: true, revoked: true };
    },

    async deleteExpiredAccounts(at = now()) {
      const cutoff = new Date(at - DELETION_GRACE_PERIOD_MS);
      return repository.deleteAccountsRequestedBefore(cutoff);
    },
  };
}

/** Drizzle-backed {@link DeletionRepository}; used in production. */
export function createDrizzleDeletionRepository(database = db): DeletionRepository {
  return {
    async setDeletionRequestedAt(userId, at) {
      await database.update(users).set({ deletionRequestedAt: at }).where(eq(users.id, userId));
    },

    async getDeletionRequestedAt(userId) {
      const rows = await database
        .select({ deletionRequestedAt: users.deletionRequestedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0]?.deletionRequestedAt ?? null;
    },

    async clearDeletionRequestedAt(userId) {
      await database.update(users).set({ deletionRequestedAt: null }).where(eq(users.id, userId));
    },

    async deleteAccountsRequestedBefore(cutoff) {
      return database.transaction(async (tx) => {
        const rows = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(isNotNull(users.deletionRequestedAt), lte(users.deletionRequestedAt, cutoff)));

        for (const row of rows) {
          const userId = row.id;
          // Order matters: child rows referencing the user (no cascade) must go
          // before the user row. chats/messages/tags cascade from chats.
          await tx.delete(auditLog).where(eq(auditLog.userId, userId));
          await tx.delete(apiTokens).where(eq(apiTokens.userId, userId));
          await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
          await tx.delete(chats).where(eq(chats.userId, userId));
          await tx.delete(sessions).where(eq(sessions.userId, userId));
          await tx.delete(users).where(eq(users.id, userId));
        }

        return rows.length;
      });
    },
  };
}
