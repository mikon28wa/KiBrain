import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'db', 'migrations');

function readMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    .join('\n');
}

function findStatement(needle: string): string {
  const line = readMigrationSql()
    .split('\n')
    .find((l) => l.includes(needle));
  return line ?? '';
}

describe('drizzle migration', () => {
  it('defines all required tables', () => {
    const sql = readMigrationSql();
    for (const table of [
      'users',
      'chats',
      'messages',
      'chat_tags',
      'api_tokens',
      'password_reset_tokens',
      'audit_log',
    ]) {
      expect(sql).toContain(`CREATE TABLE \`${table}\``);
    }
  });

  it('uses varchar(36) UUID primary keys for every table', () => {
    const sql = readMigrationSql();
    // 7 tables, each with a varchar(36) id primary key
    expect(sql.match(/`id` varchar\(36\) NOT NULL/g)).toHaveLength(7);
    // no auto-increment integer ids remain
    expect(sql).not.toContain('AUTO_INCREMENT');
  });

  it('uses varchar(36) for foreign key columns', () => {
    const sql = readMigrationSql();
    expect(sql).toContain('`chat_id` varchar(36) NOT NULL');
    expect(sql).toContain('`token_id` varchar(36)');
    expect(sql).toContain('`user_id` varchar(36) NOT NULL');
  });

  it('defines the required UNIQUE constraints', () => {
    const sql = readMigrationSql();
    expect(sql).toContain('`users_email_unique` UNIQUE(`email`)');
    expect(sql).toContain(
      '`chats_user_source_unique` UNIQUE(`user_id`,`source_provider`,`source_chat_id`)',
    );
    expect(sql).toContain('`chat_tags_chat_tag_unique` UNIQUE(`chat_id`,`tag`)');
  });

  it('defines FULLTEXT indexes on chats.title and messages.content', () => {
    const sql = readMigrationSql();
    expect(sql).toMatch(/FULLTEXT INDEX `chats_title_fulltext` \(`title`\)/);
    expect(sql).toMatch(/FULLTEXT INDEX `messages_content_fulltext` \(`content`\)/);
  });

  it('cascades chat deletion to messages', () => {
    const fk = findStatement('messages_chat_id_chats_id_fk');
    expect(fk).toContain('ON DELETE cascade');
  });

  it('cascades chat deletion to chat_tags', () => {
    const fk = findStatement('chat_tags_chat_id_chats_id_fk');
    expect(fk).toContain('ON DELETE cascade');
  });

  it('defaults password_reset_tokens.expires_at to now + 1 hour', () => {
    expect(readMigrationSql()).toContain(
      '`expires_at` timestamp NOT NULL DEFAULT (now() + interval 1 hour)',
    );
  });

  it('defaults chats.consent to false', () => {
    expect(readMigrationSql()).toContain('`consent` boolean NOT NULL DEFAULT false');
  });
});
