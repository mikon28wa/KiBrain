import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql, { type Pool } from 'mysql2/promise';
import * as schema from '../src/db/schema';
import { createDrizzleImportTransactionManager, registerAndImport } from '../src/api/chatImport';

/**
 * Real-MySQL integration test (see docker-compose.mysql.yml).
 *
 * Run:  $env:RUN_MYSQL_INTEGRATION="1"; npm test -- test/mysql.integration.test.ts
 *
 * Uses an isolated, freshly created database; never touches a production
 * database. Skipped ("not executed") when the env var is unset.
 */
const RUN = process.env.RUN_MYSQL_INTEGRATION === '1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const cfg = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
};

let pool: Pool;
let db: MySql2Database<typeof schema>;
let dbName: string;

beforeAll(async () => {
  if (!RUN) return;
  const conn = await mysql.createConnection({ ...cfg, connectTimeout: 2000 });
  dbName = `kibrain_it_${Date.now().toString(36)}`;
  await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();

  pool = mysql.createPool({ ...cfg, database: dbName, connectionLimit: 1 });
  db = drizzle(pool, { schema, mode: 'default' });
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

afterAll(async () => {
  if (pool) {
    await pool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await pool.end();
  }
});

async function seedUser(email: string): Promise<string> {
  await db.insert(schema.users).values({ email, passwordHash: 'hash' });
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  return user.id;
}

describe.skipIf(!RUN)('MySQL integration', () => {
  it('generates UUIDv4 ids through the application write path for every table', async () => {
    const suffix = Date.now().toString(36);
    const email = `it_${suffix}@example.com`;
    await db.insert(schema.users).values({ email, passwordHash: 'hash' });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(user.id).toMatch(UUID_RE);

    await db.insert(schema.sessions).values({ userId: user.id, tokenHash: `s_${suffix}`, expiresAt: new Date() });
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, `s_${suffix}`));
    expect(session.id).toMatch(UUID_RE);

    await db.insert(schema.chats).values({ userId: user.id, title: 't', sourceProvider: 'p', sourceChatId: `c_${suffix}`, consent: true });
    const [chat] = await db.select().from(schema.chats).where(eq(schema.chats.sourceChatId, `c_${suffix}`));
    expect(chat.id).toMatch(UUID_RE);

    await db.insert(schema.messages).values({ chatId: chat.id, role: 'user', content: 'hello', sequenceOrder: 0 });
    const [message] = await db.select().from(schema.messages).where(eq(schema.messages.chatId, chat.id));
    expect(message.id).toMatch(UUID_RE);

    await db.insert(schema.chatTags).values({ chatId: chat.id, tag: 'tag1' });
    const [tag] = await db.select().from(schema.chatTags).where(eq(schema.chatTags.chatId, chat.id));
    expect(tag.id).toMatch(UUID_RE);

    await db.insert(schema.apiTokens).values({ userId: user.id, name: 'n', tokenHash: `t_${suffix}`, scopes: ['save'] });
    const [token] = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.tokenHash, `t_${suffix}`));
    expect(token.id).toMatch(UUID_RE);

    await db.insert(schema.passwordResetTokens).values({ userId: user.id, tokenHash: `r_${suffix}`, expiresAt: new Date() });
    const [prt] = await db.select().from(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.tokenHash, `r_${suffix}`));
    expect(prt.id).toMatch(UUID_RE);

    await db.insert(schema.auditLog).values({ userId: user.id, action: 'login', tokenId: token.id, ipAddress: '127.0.0.1' });
    const [audit] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'login'));
    expect(audit.id).toMatch(UUID_RE);
  });

  it('rejects invalid foreign key references', async () => {
    await expect(
      db.insert(schema.messages).values({ chatId: 'missing-chat', role: 'user', content: 'x', sequenceOrder: 0 }),
    ).rejects.toThrow();
  });

  it('cascades chat deletion to messages and tags', async () => {
    const userId = await seedUser(`cascade_${Date.now()}@example.com`);
    await db.insert(schema.chats).values({ userId, title: 't', sourceProvider: 'p', sourceChatId: `cc_${Date.now()}`, consent: true });
    const [chat] = await db.select().from(schema.chats).where(eq(schema.chats.userId, userId));

    await db.insert(schema.messages).values({ chatId: chat.id, role: 'user', content: 'hi', sequenceOrder: 0 });
    await db.insert(schema.chatTags).values({ chatId: chat.id, tag: 'x' });

    await db.delete(schema.chats).where(eq(schema.chats.id, chat.id));

    const messages = await db.select().from(schema.messages).where(eq(schema.messages.chatId, chat.id));
    const tags = await db.select().from(schema.chatTags).where(eq(schema.chatTags.chatId, chat.id));
    expect(messages).toHaveLength(0);
    expect(tags).toHaveLength(0);
  });

  it('enforces UNIQUE constraints', async () => {
    const email = `uniq_${Date.now()}@example.com`;
    await db.insert(schema.users).values({ email, passwordHash: 'h' });
    await expect(db.insert(schema.users).values({ email, passwordHash: 'h2' })).rejects.toThrow();
  });

  it('supports FULLTEXT MATCH ... AGAINST queries', async () => {
    const userId = await seedUser(`ft_${Date.now()}@example.com`);
    await db.insert(schema.chats).values({ userId, title: 't', sourceProvider: 'p', sourceChatId: `ft_${Date.now()}`, consent: true });
    const [chat] = await db.select().from(schema.chats).where(eq(schema.chats.userId, userId));

    await db.insert(schema.messages).values({ chatId: chat.id, role: 'user', content: 'pineapple banana', sequenceOrder: 0 });
    await db.insert(schema.messages).values({ chatId: chat.id, role: 'user', content: 'quantum physics', sequenceOrder: 1 });

    const result = await db.execute(
      sql`SELECT id FROM messages WHERE MATCH(content) AGAINST ('pineapple' IN NATURAL LANGUAGE MODE)`,
    );
    const rows = result[0] as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(UUID_RE);
  });

  it('rolls back the whole registration+import transaction on a constraint failure', async () => {
    const email = `rollback_${Date.now()}@example.com`;
    const manager = createDrizzleImportTransactionManager(db);

    // Duplicate tags within one chat violate UNIQUE(chat_id, tag), forcing the
    // transaction to fail after the user and chat were already written.
    await expect(
      registerAndImport(manager, {
        email,
        passwordHash: 'hash',
        consent: true,
        messages: [{ role: 'user', content: 'hello' }],
        tags: ['dup', 'dup'],
      }),
    ).rejects.toThrow();

    // The transaction must have rolled back every write.
    const users = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(users).toHaveLength(0);
    const chats = await db.select().from(schema.chats);
    expect(chats).toHaveLength(0);
    const messages = await db.select().from(schema.messages);
    expect(messages).toHaveLength(0);
  });
});
