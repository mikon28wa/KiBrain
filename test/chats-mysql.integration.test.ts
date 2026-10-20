import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql, { type Pool } from 'mysql2/promise';
import { createDrizzleChatRepository } from '../src/api/chats';
import * as schema from '../src/db/schema';

/**
 * Real-MySQL integration test for the `/api/v1/chats` repository, covering the
 * MySQL FULLTEXT ranking and the UNIQUE(user, provider, source_chat_id) upsert
 * that the in-memory tests cannot exercise.
 *
 * Run:  $env:RUN_MYSQL_INTEGRATION="1"; npm test -- test/chats-mysql.integration.test.ts
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
  dbName = `kibrain_chats_it_${Date.now().toString(36)}`;
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

const audit = { action: 'chat.save', tokenId: null, ipAddress: '127.0.0.1' };

describe.skipIf(!RUN)('chats repository (MySQL)', () => {
  it('upserts by UNIQUE(user, provider, source_chat_id): last version wins', async () => {
    const repo = createDrizzleChatRepository(db);
    const userId = await seedUser(`upsert_${Date.now()}@example.com`);

    const first = await repo.upsert(
      {
        userId,
        sourceProvider: 'p',
        sourceChatId: 'c1',
        title: 'First',
        messages: [{ role: 'user', content: 'one' }],
        tags: ['a', 'b'],
      },
      audit,
    );

    const second = await repo.upsert(
      {
        userId,
        sourceProvider: 'p',
        sourceChatId: 'c1',
        title: 'Second',
        messages: [
          { role: 'user', content: 'two' },
          { role: 'assistant', content: 'three' },
        ],
        tags: ['c'],
      },
      audit,
    );

    expect(second.chatId).toBe(first.chatId);

    const chats = await db.select().from(schema.chats).where(eq(schema.chats.sourceChatId, 'c1'));
    expect(chats).toHaveLength(1);
    expect(chats[0].title).toBe('Second');

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.chatId, first.chatId))
      .orderBy(schema.messages.sequenceOrder);
    expect(messages.map((m) => m.content)).toEqual(['two', 'three']);

    const tags = await db.select().from(schema.chatTags).where(eq(schema.chatTags.chatId, first.chatId));
    expect(tags.map((t) => t.tag)).toEqual(['c']);
  });

  it('ranks FULLTEXT matches over title and content by relevance', async () => {
    const repo = createDrizzleChatRepository(db);
    const userId = await seedUser(`ft_${Date.now()}@example.com`);

    const make = async (title: string, content: string): Promise<string> => {
      const id = randomUUID();
      await db.insert(schema.chats).values({
        id,
        userId,
        title,
        sourceProvider: 'p',
        sourceChatId: `src_${randomUUID()}`,
        consent: true,
      });
      await db.insert(schema.messages).values({ id: randomUUID(), chatId: id, role: 'user', content, sequenceOrder: 0 });
      return id;
    };

    // "banana" appears in one title (20%) and two contents (40%): below the
    // 50% natural-language stopword threshold.
    const bothId = await make('banana bread', 'banana recipe');
    const contentId = await make('plain', 'banana shake');
    await make('plain', 'apple pie');
    await make('plain', 'grape');
    await make('plain', 'kiwi');

    const result = await repo.list(
      { userId, q: 'banana', page: 1, pageSize: 20 },
      { action: 'chat.list', tokenId: null, ipAddress: '127.0.0.1' },
    );

    const ids = result.items.map((i) => i.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(bothId);
    expect(ids).toContain(contentId);
    // Matching title and content ranks above content-only.
    expect(ids[0]).toBe(bothId);
    expect(ids[1]).toBe(contentId);

    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1].relevance).toBeGreaterThanOrEqual(result.items[i].relevance as number);
    }
    for (const item of result.items) {
      expect(item.relevance).toBeGreaterThan(0);
    }
  });

  it('does not execute SQL injection in the fulltext search', async () => {
    const repo = createDrizzleChatRepository(db);
    const userId = await seedUser(`sqli_${Date.now()}@example.com`);

    await repo.upsert(
      {
        userId,
        sourceProvider: 'p',
        sourceChatId: 'sqli-1',
        title: 'safe',
        messages: [{ role: 'user', content: 'hello world' }],
        tags: [],
      },
      audit,
    );

    const result = await repo.list(
      { userId, q: "'; DROP TABLE chats; --", page: 1, pageSize: 20 },
      { action: 'chat.list', tokenId: null, ipAddress: '127.0.0.1' },
    );

    expect(result.items).toHaveLength(0);

    // The table and the seeded data survive: the term was treated as data.
    const chats = await db.select().from(schema.chats).where(eq(schema.chats.userId, userId));
    expect(chats).toHaveLength(1);
  });
});
