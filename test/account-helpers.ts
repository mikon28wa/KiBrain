import type { ExportChat, ExportRepository } from '../src/account/export';
import type { DeletionRepository } from '../src/account/deletion';

export interface InMemoryAccountUser {
  id: string;
  email: string;
  deletionRequestedAt: Date | null;
}

export interface InMemoryStoredChat extends ExportChat {
  userId: string;
}

function stripUserId(chat: InMemoryStoredChat): ExportChat {
  const { userId: _userId, ...rest } = chat;
  return rest;
}

export function createInMemoryExportRepository(): {
  repository: ExportRepository;
  state: { users: InMemoryAccountUser[]; chats: InMemoryStoredChat[] };
} {
  const users: InMemoryAccountUser[] = [];
  const chats: InMemoryStoredChat[] = [];

  return {
    state: { users, chats },
    repository: {
      async findUserById(id) {
        const user = users.find((u) => u.id === id);
        return user ? { id: user.id, email: user.email } : null;
      },
      async listChats(userId) {
        return chats.filter((c) => c.userId === userId).map(stripUserId);
      },
      async getChat(userId, chatId) {
        const chat = chats.find((c) => c.userId === userId && c.id === chatId);
        return chat ? stripUserId(chat) : null;
      },
    },
  };
}

export function createInMemoryDeletionRepository(): {
  repository: DeletionRepository;
  state: { users: InMemoryAccountUser[]; deletedUserIds: string[] };
} {
  const users: InMemoryAccountUser[] = [];
  const deletedUserIds: string[] = [];

  return {
    state: { users, deletedUserIds },
    repository: {
      async setDeletionRequestedAt(userId, at) {
        const user = users.find((u) => u.id === userId);
        if (user) user.deletionRequestedAt = at;
      },
      async getDeletionRequestedAt(userId) {
        return users.find((u) => u.id === userId)?.deletionRequestedAt ?? null;
      },
      async clearDeletionRequestedAt(userId) {
        const user = users.find((u) => u.id === userId);
        if (user) user.deletionRequestedAt = null;
      },
      async deleteAccountsRequestedBefore(cutoff) {
        let count = 0;
        for (let i = users.length - 1; i >= 0; i--) {
          const user = users[i];
          if (user.deletionRequestedAt && user.deletionRequestedAt.getTime() <= cutoff.getTime()) {
            users.splice(i, 1);
            deletedUserIds.push(user.id);
            count++;
          }
        }
        return count;
      },
    },
  };
}
