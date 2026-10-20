import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { chats, chatTags, messages, users } from '../db/schema';

export interface ExportMessage {
  role: string;
  content: string;
  sequenceOrder: number;
  timestamp: Date;
}

export interface ExportChat {
  id: string;
  title: string;
  sourceProvider: string;
  sourceChatId: string;
  consent: boolean;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  messages: ExportMessage[];
}

/** A single-JSON account export: every chat including tags and messages. */
export interface AccountExport {
  user: { id: string; email: string };
  exportedAt: Date;
  chats: ExportChat[];
}

/** Storage boundary for the account export endpoints. */
export interface ExportRepository {
  findUserById(id: string): Promise<{ id: string; email: string } | null>;
  listChats(userId: string): Promise<ExportChat[]>;
  getChat(userId: string, chatId: string): Promise<ExportChat | null>;
}

/** Drizzle-backed {@link ExportRepository}; used in production. */
export function createDrizzleExportRepository(database = db): ExportRepository {
  async function loadMessages(chatId: string): Promise<ExportMessage[]> {
    const rows = await database
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(messages.sequenceOrder);
    return rows.map((m) => ({
      role: m.role,
      content: m.content,
      sequenceOrder: m.sequenceOrder,
      timestamp: m.timestamp,
    }));
  }

  async function loadTags(chatId: string): Promise<string[]> {
    const rows = await database.select({ tag: chatTags.tag }).from(chatTags).where(eq(chatTags.chatId, chatId));
    return rows.map((t) => t.tag);
  }

  async function toExportChat(chat: typeof chats.$inferSelect): Promise<ExportChat> {
    return {
      id: chat.id,
      title: chat.title,
      sourceProvider: chat.sourceProvider,
      sourceChatId: chat.sourceChatId,
      consent: chat.consent,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      tags: await loadTags(chat.id),
      messages: await loadMessages(chat.id),
    };
  }

  return {
    async findUserById(id) {
      const rows = await database
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async listChats(userId) {
      const rows = await database.select().from(chats).where(eq(chats.userId, userId)).orderBy(chats.createdAt);
      return Promise.all(rows.map(toExportChat));
    },

    async getChat(userId, chatId) {
      const rows = await database
        .select()
        .from(chats)
        .where(and(eq(chats.userId, userId), eq(chats.id, chatId)))
        .limit(1);
      const chat = rows[0];
      if (!chat) return null;
      return toExportChat(chat);
    },
  };
}
