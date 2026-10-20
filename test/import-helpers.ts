import type { ImportStore, ImportTransactionManager } from '../src/api/chatImport';
import type { AuthService, AuthUser } from '../src/auth';

export interface InMemoryImportState {
  users: Array<{ id: string; email: string; passwordHash: string }>;
  chats: Array<{
    id: string;
    userId: string;
    title: string;
    sourceProvider: string;
    sourceChatId: string;
    consent: boolean;
  }>;
  messages: Array<{ id: string; chatId: string; role: string; content: string; sequenceOrder: number }>;
  tags: Array<{ id: string; chatId: string; tag: string }>;
}

export type ImportFailurePoint = 'createUser' | 'createChat' | 'createMessages' | 'createTags';

/**
 * In-memory transaction manager that simulates a database transaction: writes
 * are staged and only committed when the operation succeeds; on failure the
 * staged writes are discarded (rollback).
 */
export function createInMemoryImportManager(): {
  manager: ImportTransactionManager;
  state: InMemoryImportState;
  setFailOn: (f: ImportFailurePoint | undefined) => void;
} {
  const state: InMemoryImportState = { users: [], chats: [], messages: [], tags: [] };
  let failOn: ImportFailurePoint | undefined;

  const manager: ImportTransactionManager = {
    run(fn) {
      const staged: InMemoryImportState = { users: [], chats: [], messages: [], tags: [] };
      let seq = 0;
      const store: ImportStore = {
        async findUserByEmail(email) {
          return state.users.find((u) => u.email === email) ?? null;
        },
        async createUser(user) {
          if (failOn === 'createUser') throw new Error('injected failure: createUser');
          staged.users.push(user);
        },
        async createChat(chat) {
          if (failOn === 'createChat') throw new Error('injected failure: createChat');
          staged.chats.push(chat);
        },
        async createMessages(chatId, messages) {
          if (failOn === 'createMessages') throw new Error('injected failure: createMessages');
          messages.forEach((m, i) => {
            staged.messages.push({
              id: `m-${++seq}`,
              chatId,
              role: m.role,
              content: m.content,
              sequenceOrder: i,
            });
          });
        },
        async createTags(chatId, tags) {
          if (failOn === 'createTags') throw new Error('injected failure: createTags');
          tags.forEach((tag) => {
            staged.tags.push({ id: `t-${++seq}`, chatId, tag });
          });
        },
      };

      return fn(store).then((result) => {
        state.users.push(...staged.users);
        state.chats.push(...staged.chats);
        state.messages.push(...staged.messages);
        state.tags.push(...staged.tags);
        return result;
      });
    },
  };

  return {
    manager,
    state,
    setFailOn(f) {
      failOn = f;
    },
  };
}

export function createMockAuthService(user: AuthUser | null): AuthService {
  return {
    register: async () => ({ ok: false, error: { code: 'EMAIL_TAKEN', message: 'unused' } }),
    login: async () => ({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'unused' } }),
    logout: async () => {},
    getUserBySessionToken: async () => user,
  };
}
