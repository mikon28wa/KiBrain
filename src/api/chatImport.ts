import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { chatTags, chats, messages, users } from '../db/schema';
import type { BrainChatMessage } from './validation';

/** Thrown when a registration-import would duplicate an existing email. */
export class ImportError extends Error {
  constructor(public readonly code: 'EMAIL_TAKEN', message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ChatImportInput {
  email: string;
  consent: boolean;
  messages: BrainChatMessage[];
  tags: string[];
}

export interface RegisterImportInput extends ChatImportInput {
  /** Pre-hashed password (bcrypt), computed before the transaction opens. */
  passwordHash: string;
}

/**
 * Transaction-scoped persistence operations. All methods run inside a single
 * transaction, so a failure at any step rolls back every prior write.
 */
export interface ImportStore {
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  createUser(user: { id: string; email: string; passwordHash: string }): Promise<void>;
  createChat(chat: {
    id: string;
    userId: string;
    title: string;
    sourceProvider: string;
    sourceChatId: string;
    consent: boolean;
  }): Promise<void>;
  createMessages(chatId: string, messages: BrainChatMessage[]): Promise<void>;
  createTags(chatId: string, tags: string[]): Promise<void>;
}

export interface ImportTransactionManager {
  run<T>(fn: (store: ImportStore) => Promise<T>): Promise<T>;
}

function deriveTitle(messages: BrainChatMessage[]): string {
  const first = messages[0]?.content;
  return first ? first.slice(0, 255) : 'Importierter Chat';
}

/** Atomically creates the account and its first chat in a single transaction. */
export function registerAndImport(
  manager: ImportTransactionManager,
  input: RegisterImportInput,
): Promise<{ userId: string; chatId: string }> {
  return manager.run(async (store) => {
    const existing = await store.findUserByEmail(input.email);
    if (existing) {
      throw new ImportError('EMAIL_TAKEN', 'E-Mail wird bereits verwendet');
    }

    const userId = randomUUID();
    const chatId = randomUUID();
    await store.createUser({ id: userId, email: input.email, passwordHash: input.passwordHash });
    await store.createChat({
      id: chatId,
      userId,
      title: deriveTitle(input.messages),
      sourceProvider: 'brain.chat.v1',
      sourceChatId: randomUUID(),
      consent: input.consent,
    });
    await store.createMessages(chatId, input.messages);
    await store.createTags(chatId, input.tags);
    return { userId, chatId };
  });
}

/**
 * Atomically imports a chat for an already-authenticated owner. The owner id is
 * supplied by the caller and is never derived from the payload.
 */
export function importChatForOwner(
  manager: ImportTransactionManager,
  ownerId: string,
  input: ChatImportInput,
): Promise<{ chatId: string }> {
  return manager.run(async (store) => {
    const chatId = randomUUID();
    await store.createChat({
      id: chatId,
      userId: ownerId,
      title: deriveTitle(input.messages),
      sourceProvider: 'brain.chat.v1',
      sourceChatId: randomUUID(),
      consent: input.consent,
    });
    await store.createMessages(chatId, input.messages);
    await store.createTags(chatId, input.tags);
    return { chatId };
  });
}

/**
 * Drizzle-backed transaction manager using a single MySQL transaction.
 *
 * Every operation in the returned store MUST use the transaction-scoped `tx`
 * handle passed to the callback — never the outer `db`/`database` instance.
 * Using the outer instance would run the write outside the transaction on a
 * separate pooled connection and make it survive a rollback (orphaned rows).
 */
export function createDrizzleImportTransactionManager(database = db): ImportTransactionManager {
  return {
    run(fn) {
      return database.transaction(async (tx) => {
        const store: ImportStore = {
          async findUserByEmail(email) {
            const rows = await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, email))
              .limit(1);
            return rows[0] ?? null;
          },
          async createUser(user) {
            await tx.insert(users).values(user);
          },
          async createChat(chat) {
            await tx.insert(chats).values(chat);
          },
          async createMessages(chatId, messageList) {
            if (messageList.length === 0) return;
            await tx.insert(messages).values(
              messageList.map((m, i) => ({
                id: randomUUID(),
                chatId,
                role: m.role,
                content: m.content,
                sequenceOrder: i,
              })),
            );
          },
          async createTags(chatId, tags) {
            if (tags.length === 0) return;
            await tx.insert(chatTags).values(
              tags.map((tag) => ({ id: randomUUID(), chatId, tag })),
            );
          },
        };
        return fn(store);
      });
    },
  };
}
