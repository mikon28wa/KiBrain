import type { AuditContext, ChatDetail, ChatListItem, ChatListResult, ChatRepository } from '../src/api/chats';
import type { ApiTokenAuth, ApiTokenService } from '../src/api/tokenAuth';

/** In-memory {@link ApiTokenService} keyed by the raw bearer token. */
export function createInMemoryApiTokenService(
  initial: Record<string, ApiTokenAuth> = {},
): { service: ApiTokenService; tokens: Map<string, ApiTokenAuth> } {
  const tokens = new Map<string, ApiTokenAuth>(Object.entries(initial));
  return {
    tokens,
    service: {
      async authenticate(token) {
        return tokens.get(token) ?? null;
      },
    },
  };
}

export interface InMemoryChat {
  id: string;
  userId: string;
  title: string;
  sourceProvider: string;
  sourceChatId: string;
  consent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemoryMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  sequenceOrder: number;
  timestamp: Date;
}

export interface InMemoryTag {
  id: string;
  chatId: string;
  tag: string;
}

export interface InMemoryAuditEntry {
  userId: string;
  action: string;
  tokenId: string | null;
  ipAddress: string;
  createdAt: Date;
}

export interface InMemoryChatState {
  chats: InMemoryChat[];
  messages: InMemoryMessage[];
  tags: InMemoryTag[];
  audit: InMemoryAuditEntry[];
}

/** In-memory {@link ChatRepository} mirroring the drizzle implementation's behaviour. */
export function createInMemoryChatRepository(): { repository: ChatRepository; state: InMemoryChatState } {
  const state: InMemoryChatState = { chats: [], messages: [], tags: [], audit: [] };
  let chatSeq = 0;
  let msgSeq = 0;
  let tagSeq = 0;

  const writeAudit = (userId: string, audit: AuditContext): void => {
    state.audit.push({
      userId,
      action: audit.action,
      tokenId: audit.tokenId,
      ipAddress: audit.ipAddress,
      createdAt: new Date(),
    });
  };

  const repository: ChatRepository = {
    async upsert(input, audit) {
      const existing = state.chats.find(
        (c) =>
          c.userId === input.userId &&
          c.sourceProvider === input.sourceProvider &&
          c.sourceChatId === input.sourceChatId,
      );

      let chat: InMemoryChat;
      if (existing) {
        chat = existing;
        chat.title = input.title;
        chat.updatedAt = new Date();
        state.messages = state.messages.filter((m) => m.chatId !== chat.id);
        state.tags = state.tags.filter((t) => t.chatId !== chat.id);
      } else {
        chat = {
          id: `chat-${++chatSeq}`,
          userId: input.userId,
          title: input.title,
          sourceProvider: input.sourceProvider,
          sourceChatId: input.sourceChatId,
          consent: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.chats.push(chat);
      }

      input.messages.forEach((m, i) => {
        state.messages.push({
          id: `msg-${++msgSeq}`,
          chatId: chat.id,
          role: m.role,
          content: m.content,
          sequenceOrder: i,
          timestamp: new Date(),
        });
      });
      input.tags.forEach((tag) => {
        state.tags.push({ id: `tag-${++tagSeq}`, chatId: chat.id, tag });
      });

      writeAudit(input.userId, audit);
      return { chatId: chat.id };
    },

    async list(query, audit) {
      const { userId, q, tag, page, pageSize } = query;
      let chats = state.chats.filter((c) => c.userId === userId);

      if (tag) {
        const tagged = new Set(state.tags.filter((t) => t.tag === tag).map((t) => t.chatId));
        chats = chats.filter((c) => tagged.has(c.id));
      }

      const relevance = (chat: InMemoryChat): number => {
        if (!q) return 0;
        const term = q.toLowerCase();
        let score = 0;
        if (chat.title.toLowerCase().includes(term)) score += 5;
        for (const m of state.messages.filter((mm) => mm.chatId === chat.id)) {
          const lower = m.content.toLowerCase();
          let idx = lower.indexOf(term);
          while (idx !== -1) {
            score += 1;
            idx = lower.indexOf(term, idx + term.length);
          }
        }
        return score;
      };

      const items: ChatListItem[] = chats
        .filter((c) => !q || relevance(c) > 0)
        .map((c) => {
          const rel = q ? relevance(c) : undefined;
          return {
            id: c.id,
            title: c.title,
            sourceProvider: c.sourceProvider,
            sourceChatId: c.sourceChatId,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            tags: state.tags.filter((t) => t.chatId === c.id).map((t) => t.tag),
            relevance: rel,
          };
        });

      items.sort((a, b) => {
        if (q) {
          const diff = (b.relevance ?? 0) - (a.relevance ?? 0);
          if (diff !== 0) return diff;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      const total = items.length;
      const start = (page - 1) * pageSize;
      const result: ChatListResult = {
        items: items.slice(start, start + pageSize),
        page,
        pageSize,
        total,
      };

      writeAudit(userId, audit);
      return result;
    },

    async getById(userId, chatId, audit) {
      const chat = state.chats.find((c) => c.id === chatId && c.userId === userId);
      if (!chat) return null;

      const messages = state.messages
        .filter((m) => m.chatId === chatId)
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sequenceOrder: m.sequenceOrder,
          timestamp: m.timestamp,
        }));
      const tags = state.tags.filter((t) => t.chatId === chatId).map((t) => t.tag);

      writeAudit(userId, audit);

      const detail: ChatDetail = {
        id: chat.id,
        title: chat.title,
        sourceProvider: chat.sourceProvider,
        sourceChatId: chat.sourceChatId,
        consent: chat.consent,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        messages,
        tags,
      };
      return detail;
    },
  };

  return { repository, state };
}

