import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql, { type Pool } from 'mysql2/promise';
import { createDrizzleDeletionRepository, DELETION_GRACE_PERIOD_MS } from '../src/account/deletion';
import { createDrizzleExportRepository } from '../src/account/export';
import * as schema from '../src/db/schema';

/**
 * Real-MySQL integration test for the account export and deletion modules.
 * Run:  $env:RUN_MYSQL_INTEGRATION="1"; npm test -- test/account-mysql.integration.test.ts
 */
const RUN = process.env.RUN_MYSQL_INTEGRATION === '1';

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
  dbName = `kibrain_account_it_${Date.now().toString(36)}`;
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

describe.skipIf(!RUN)('account modules (MySQL)', () => {
  it('hard-deletes the account and all related rows after the grace period', async () => {
    const deletion = createDrizzleDeletionRepository(db);
    const userId = await seedUser(`del_${Date.now()}@example.com`);

    const chatId = randomUUID();
    await db.insert(schema.chats).values({
      id: chatId,
      userId,
      title: 't',
      sourceProvider: 'p',
      sourceChatId: `c_${Date.now()}`,
      consent: true,
    });
    await db.insert(schema.messages).values({ id: randomUUID(), chatId, role: 'user', content: 'hi', sequenceOrder: 0 });
    await db.insert(schema.chatTags).values({ id: randomUUID(), chatId, tag: 'x' });
    await db.insert(schema.sessions).values({ id: randomUUID(), userId, tokenHash: `s_${Date.now()}`, expiresAt: new Date() });
    await db.insert(schema.apiTokens).values({ id: randomUUID(), userId, name: 'n', tokenHash: `t_${Date.now()}`, scopes: ['save'] });

    await deletion.setDeletionRequestedAt(userId, new Date(Date.now() - DELETION_GRACE_PERIOD_MS - 1000));
    const deleted = await deletion.deleteAccountsRequestedBefore(new Date());

    expect(deleted).toBe(1);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, userId))).toHaveLength(0);
    expect(await db.select().from(schema.chats).where(eq(schema.chats.userId, userId))).toHaveLength(0);
    expect(await db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId))).toHaveLength(0);
    expect(await db.select().from(schema.chatTags).where(eq(schema.chatTags.chatId, chatId))).toHaveLength(0);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId))).toHaveLength(0);
    expect(await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.userId, userId))).toHaveLength(0);
  });

  it('exports chats with tags and messages', async () => {
    const exportRepo = createDrizzleExportRepository(db);
    const userId = await seedUser(`exp_${Date.now()}@example.com`);

    const chatId = randomUUID();
    await db.insert(schema.chats).values({
      id: chatId,
      userId,
      title: 'Exported',
      sourceProvider: 'brain.chat.v1',
      sourceChatId: `e_${Date.now()}`,
      consent: true,
    });
    await db.insert(schema.messages).values({ id: randomUUID(), chatId, role: 'user', content: 'hello', sequenceOrder: 0 });
    await db.insert(schema.chatTags).values({ id: randomUUID(), chatId, tag: 'tag1' });

    const chats = await exportRepo.listChats(userId);
    expect(chats).toHaveLength(1);
    expect(chats[0].sourceProvider).toBe('brain.chat.v1');
    expect(chats[0].tags).toEqual(['tag1']);
    expect(chats[0].messages.map((m) => m.content)).toEqual(['hello']);

    const single = await exportRepo.getChat(userId, chatId);
    expect(single?.tags).toEqual(['tag1']);
    expect(single?.messages).toHaveLength(1);
  });
});
