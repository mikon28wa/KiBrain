import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Application users.
 *
 * Every table uses a UUIDv4 primary key (varchar(36)) generated at runtime
 * via `randomUUID()`. Foreign keys use the same varchar(36) type.
 */
export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  deletionRequestedAt: timestamp('deletion_requested_at'),
});

/**
 * Server-side login sessions (no JWT). The cookie stores the session token;
 * the database stores only its SHA-256 hash.
 */
export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Imported/created chats. `consent` records whether the user agreed to the
 * data being processed.
 */
export const chats = mysqlTable(
  'chats',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
    userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id),
    title: varchar('title', { length: 255 }).notNull(),
    sourceProvider: varchar('source_provider', { length: 100 }).notNull(),
    sourceChatId: varchar('source_chat_id', { length: 255 }).notNull(),
    consent: boolean('consent').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex('chats_user_source_unique').on(
      table.userId,
      table.sourceProvider,
      table.sourceChatId,
    ),
  ],
);

/**
 * Chat messages. Deleting a chat cascades to its messages.
 *
 * Note: `FULLTEXT (content)` is created in a custom migration (see
 * `src/db/migrations`), because drizzle-orm has no native FULLTEXT index API
 * for MySQL.
 */
export const messages = mysqlTable('messages', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  chatId: varchar('chat_id', { length: 36 }).notNull().references(() => chats.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).notNull(),
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  sequenceOrder: int('sequence_order').notNull(),
});

/**
 * User-defined tags on chats. Deleting a chat cascades to its tags.
 */
export const chatTags = mysqlTable(
  'chat_tags',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
    chatId: varchar('chat_id', { length: 36 }).notNull().references(() => chats.id, { onDelete: 'cascade' }),
    tag: varchar('tag', { length: 64 }).notNull(),
  },
  (table) => [
    uniqueIndex('chat_tags_chat_tag_unique').on(table.chatId, table.tag),
    index('chat_tags_tag_idx').on(table.tag),
  ],
);

/**
 * API tokens. `scopes` is a JSON array of permission strings — currently
 * `"save"` and/or `"retrieve"`.
 */
export const apiTokens = mysqlTable('api_tokens', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id),
  name: varchar('name', { length: 255 }).notNull(),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  scopes: json('scopes').$type<string[]>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
});

/**
 * Password reset tokens. `expires_at` defaults to one hour from creation.
 */
export const passwordResetTokens = mysqlTable('password_reset_tokens', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull().default(sql`(now() + interval 1 hour)`),
  usedAt: timestamp('used_at'),
});

/**
 * Append-only audit log. `token_id` is nullable because not every action
 * (e.g. login, password reset) involves an API token.
 */
export const auditLog = mysqlTable('audit_log', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  tokenId: varchar('token_id', { length: 36 }).references(() => apiTokens.id),
  ipAddress: varchar('ip_address', { length: 45 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Inferred types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type ChatTag = typeof chatTags.$inferSelect;
export type NewChatTag = typeof chatTags.$inferInsert;

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
