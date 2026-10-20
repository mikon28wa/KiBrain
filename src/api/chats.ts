import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { auditLog, chats, chatTags, messages } from '../db/schema';
import type { ChatMessagePayload } from './validation';

export interface AuditContext {
  action: string;
  tokenId: string | null;
  ipAddress: string;
}

export interface ChatUpsertInput {
  userId: string;
  sourceProvider: string;
  sourceChatId: string;
  title: string;
  messages: ChatMessagePayload[];
  tags: string[];
}

export interface ChatListQuery {
  userId: string;
  q?: string;
  tag?: string;
  page: number;
  pageSize: number;
}

export interface ChatListItem {
  id: string;
  title: string;
  sourceProvider: string;
  sourceChatId: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  /** FULLTEXT relevance; only present when the query has a `q` term. */
  relevance?: number;
}

export interface ChatListResult {
  items: ChatListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MessageDetail {
  id: string;
  role: string;
  content: string;
  sequenceOrder: number;
  timestamp: Date;
}

export interface ChatDetail {
  id: string;
  title: string;
  sourceProvider: string;
  sourceChatId: string;
  consent: boolean;
  createdAt: Date;
  updatedAt: Date;
  messages: MessageDetail[];
  tags: string[];
}

/**
 * Persistence boundary for the `/api/v1/chats` endpoints. Implementations are
 * responsible for enforcing ownership (`userId`) on every operation and for
 * writing the append-only audit entries.
 */
export interface ChatRepository {
  upsert(input: ChatUpsertInput, audit: AuditContext): Promise<{ chatId: string }>;
  list(query: ChatListQuery, audit: AuditContext): Promise<ChatListResult>;
  getById(userId: string, chatId: string, audit: AuditContext): Promise<ChatDetail | null>;
}

/** Default title for a chat without an explicit title or any messages. */
const FALLBACK_TITLE = 'Chat';

/** Derive the chat title from the first message when none is supplied. */
export function deriveChatTitle(title: string | undefined, messages: ChatMessagePayload[]): string {
  if (title && title.trim() !== '') return title;
  const first = messages[0]?.content;
  return first ? first.slice(0, 255) : FALLBACK_TITLE;
}

interface ScoreRow {
  chat_id: string;
  score: number;
}

/** Drizzle-backed {@link ChatRepository} using a single MySQL connection pool. */
export function createDrizzleChatRepository(database = db): ChatRepository {
  async function writeAudit(entry: {
    userId: string;
    action: string;
    tokenId: string | null;
    ipAddress: string;
  }): Promise<void> {
    await database.insert(auditLog).values({
      userId: entry.userId,
      action: entry.action,
      tokenId: entry.tokenId,
      ipAddress: entry.ipAddress,
    });
  }

  return {
    async upsert(input, audit) {
      const { userId, sourceProvider, sourceChatId, title, messages: messageList, tags } = input;

      return database.transaction(async (tx) => {
        const existing = await tx
          .select({ id: chats.id })
          .from(chats)
          .where(
            and(
              eq(chats.userId, userId),
              eq(chats.sourceProvider, sourceProvider),
              eq(chats.sourceChatId, sourceChatId),
            ),
          )
          .limit(1);

        const chatId = existing[0]?.id ?? randomUUID();

        if (existing[0]) {
          await tx.update(chats).set({ title }).where(eq(chats.id, chatId));
        } else {
          await tx.insert(chats).values({
            id: chatId,
            userId,
            title,
            sourceProvider,
            sourceChatId,
          });
        }

        // Last version wins: replace messages and tags wholesale.
        await tx.delete(messages).where(eq(messages.chatId, chatId));
        await tx.delete(chatTags).where(eq(chatTags.chatId, chatId));

        if (messageList.length > 0) {
          await tx.insert(messages).values(
            messageList.map((m, i) => ({
              id: randomUUID(),
              chatId,
              role: m.role,
              content: m.content,
              sequenceOrder: i,
            })),
          );
        }
        if (tags.length > 0) {
          await tx.insert(chatTags).values(
            tags.map((tag) => ({ id: randomUUID(), chatId, tag })),
          );
        }

        // Audit entry: metadata only, never chat contents.
        await tx.insert(auditLog).values({
          userId,
          action: audit.action,
          tokenId: audit.tokenId,
          ipAddress: audit.ipAddress,
        });

        return { chatId };
      });
    },

    async list(query, audit) {
      const { userId, q, tag, page, pageSize } = query;

      let ids: string[] | null = null;
      const scores = new Map<string, number>();

      if (q) {
        const titleResult = await database.execute<ScoreRow>(sql`
          SELECT c.id AS chat_id, MATCH(c.title) AGAINST (${q} IN NATURAL LANGUAGE MODE) AS score
          FROM chats c
          WHERE c.user_id = ${userId}
            AND MATCH(c.title) AGAINST (${q} IN NATURAL LANGUAGE MODE)
        `);
        const contentResult = await database.execute<ScoreRow>(sql`
          SELECT m.chat_id AS chat_id, MAX(MATCH(m.content) AGAINST (${q} IN NATURAL LANGUAGE MODE)) AS score
          FROM messages m
          INNER JOIN chats c ON c.id = m.chat_id
          WHERE c.user_id = ${userId}
            AND MATCH(m.content) AGAINST (${q} IN NATURAL LANGUAGE MODE)
          GROUP BY m.chat_id
        `);

        const titleRows = titleResult[0] as unknown as ScoreRow[];
        for (const row of titleRows) {
          scores.set(row.chat_id, Number(row.score) + (scores.get(row.chat_id) ?? 0));
        }
        const contentRows = contentResult[0] as unknown as ScoreRow[];
        for (const row of contentRows) {
          scores.set(row.chat_id, Number(row.score) + (scores.get(row.chat_id) ?? 0));
        }

        if (scores.size === 0) {
          await writeAudit({ userId, ...audit });
          return { items: [], page, pageSize, total: 0 };
        }
        ids = [...scores.keys()];
      }

      if (tag) {
        const tagRows = await database
          .selectDistinct({ chatId: chatTags.chatId })
          .from(chatTags)
          .innerJoin(chats, eq(chats.id, chatTags.chatId))
          .where(and(eq(chats.userId, userId), eq(chatTags.tag, tag)));
        const tagSet = new Set(tagRows.map((r) => r.chatId));
        ids = ids ? ids.filter((id) => tagSet.has(id)) : [...tagSet];

        if (ids.length === 0) {
          await writeAudit({ userId, ...audit });
          return { items: [], page, pageSize, total: 0 };
        }
      }

      const chatRows = ids
        ? await database
            .select()
            .from(chats)
            .where(and(eq(chats.userId, userId), inArray(chats.id, ids)))
        : await database.select().from(chats).where(eq(chats.userId, userId));

      const loadedIds = chatRows.map((c) => c.id);
      const tagRows = loadedIds.length
        ? await database.select().from(chatTags).where(inArray(chatTags.chatId, loadedIds))
        : [];
      const tagsByChat = new Map<string, string[]>();
      for (const t of tagRows) {
        const list = tagsByChat.get(t.chatId) ?? [];
        list.push(t.tag);
        tagsByChat.set(t.chatId, list);
      }

      const items: ChatListItem[] = chatRows.map((c) => ({
        id: c.id,
        title: c.title,
        sourceProvider: c.sourceProvider,
        sourceChatId: c.sourceChatId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        tags: tagsByChat.get(c.id) ?? [],
        relevance: q ? scores.get(c.id) : undefined,
      }));

      items.sort((a, b) => {
        if (q) {
          const diff = (b.relevance ?? 0) - (a.relevance ?? 0);
          if (diff !== 0) return diff;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      const total = items.length;
      const start = (page - 1) * pageSize;
      const pageItems = items.slice(start, start + pageSize);

      await writeAudit({ userId, ...audit });
      return { items: pageItems, page, pageSize, total };
    },

    async getById(userId, chatId, audit) {
      const rows = await database
        .select()
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
        .limit(1);
      const chat = rows[0];
      if (!chat) return null;

      const messageRows = await database
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(messages.sequenceOrder);
      const tagRows = await database
        .select()
        .from(chatTags)
        .where(eq(chatTags.chatId, chatId));

      await writeAudit({ userId, ...audit });

      return {
        id: chat.id,
        title: chat.title,
        sourceProvider: chat.sourceProvider,
        sourceChatId: chat.sourceChatId,
        consent: chat.consent,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        messages: messageRows.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sequenceOrder: m.sequenceOrder,
          timestamp: m.timestamp,
        })),
        tags: tagRows.map((t) => t.tag),
      };
    },
  };
}



