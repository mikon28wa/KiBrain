import type { AuthRepository, AuthSession, AuthUser } from '../src/auth';

export interface InMemoryAuthRepository extends AuthRepository {
  users: Map<string, AuthUser>;
  sessions: Map<string, AuthSession>;
}

/** In-memory auth repository for unit tests (no database required). */
export function createInMemoryAuthRepository(): InMemoryAuthRepository {
  const users = new Map<string, AuthUser>();
  const sessions = new Map<string, AuthSession>();
  let userSeq = 0;

  return {
    users,
    sessions,

    async findUserByEmail(email) {
      return users.get(email) ?? null;
    },

    async findUserById(id) {
      for (const user of users.values()) {
        if (user.id === id) return user;
      }
      return null;
    },

    async createUser(email, passwordHash) {
      if (users.has(email)) {
        throw new Error('duplicate email');
      }
      const user: AuthUser = { id: `user-${++userSeq}`, email, passwordHash };
      users.set(email, user);
      return user;
    },

    async findSessionByTokenHash(tokenHash) {
      return sessions.get(tokenHash) ?? null;
    },

    async createSession(session) {
      sessions.set(session.tokenHash, session);
    },

    async deleteSessionByTokenHash(tokenHash) {
      sessions.delete(tokenHash);
    },
  };
}
