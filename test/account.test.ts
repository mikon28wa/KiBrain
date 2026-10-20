import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/api';
import { createAuthService, type AuthUser } from '../src/auth';
import { createDeletionService, DELETION_GRACE_PERIOD_MS } from '../src/account/deletion';
import { createInMemoryAuthRepository } from './auth-helpers';
import { createMockAuthService } from './import-helpers';
import {
  createInMemoryDeletionRepository,
  createInMemoryExportRepository,
  type InMemoryStoredChat,
} from './account-helpers';

const sessionUser: AuthUser = {
  id: 'user-1',
  email: 'a@example.com',
  passwordHash: 'hash',
  deletionRequestedAt: null,
};

function sessionCookie(): Record<string, string> {
  return { cookie: 'sid=session-token-1' };
}

describe('account export', () => {
  it('exports every chat including tags and messages in a single JSON', async () => {
    const { repository, state } = createInMemoryExportRepository();
    state.users.push({ id: 'user-1', email: 'a@example.com', deletionRequestedAt: null });
    state.chats.push(
      {
        id: 'chat-1',
        userId: 'user-1',
        title: 'First',
        sourceProvider: 'brain.chat.v1',
        sourceChatId: 'src-1',
        consent: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        tags: ['work', 'important'],
        messages: [
          { role: 'user', content: 'Hello', sequenceOrder: 0, timestamp: new Date('2024-01-01T00:00:00Z') },
          { role: 'assistant', content: 'Hi there', sequenceOrder: 1, timestamp: new Date('2024-01-01T00:00:01Z') },
        ],
      },
      {
        id: 'chat-2',
        userId: 'user-1',
        title: 'Second',
        sourceProvider: 'openai',
        sourceChatId: 'src-2',
        consent: false,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
        tags: [],
        messages: [{ role: 'user', content: 'Another', sequenceOrder: 0, timestamp: new Date('2024-01-02T00:00:00Z') }],
      },
    );

    const app = buildApp(createMockAuthService(sessionUser), undefined, undefined, undefined, undefined, repository);

    const response = await app.inject({ method: 'GET', url: '/account/export', headers: sessionCookie() });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user).toEqual({ id: 'user-1', email: 'a@example.com' });
    expect(body.exportedAt).toBeTruthy();
    expect(body.chats).toHaveLength(2);

    const first = body.chats.find((c: { id: string }) => c.id === 'chat-1');
    expect(first.sourceProvider).toBe('brain.chat.v1');
    expect(first.tags).toEqual(['work', 'important']);
    expect(first.messages.map((m: { content: string }) => m.content)).toEqual(['Hello', 'Hi there']);

    const second = body.chats.find((c: { id: string }) => c.id === 'chat-2');
    expect(second.tags).toEqual([]);
    expect(second.messages).toHaveLength(1);
  });

  it('exports a single chat with tags and messages', async () => {
    const { repository, state } = createInMemoryExportRepository();
    state.users.push({ id: 'user-1', email: 'a@example.com', deletionRequestedAt: null });
    const chat: InMemoryStoredChat = {
      id: 'chat-1',
      userId: 'user-1',
      title: 'First',
      sourceProvider: 'brain.chat.v1',
      sourceChatId: 'src-1',
      consent: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      tags: ['work'],
      messages: [{ role: 'user', content: 'Hello', sequenceOrder: 0, timestamp: new Date('2024-01-01T00:00:00Z') }],
    };
    state.chats.push(chat);

    const app = buildApp(createMockAuthService(sessionUser), undefined, undefined, undefined, undefined, repository);

    const response = await app.inject({ method: 'GET', url: '/account/export/chats/chat-1', headers: sessionCookie() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'chat-1',
      title: 'First',
      sourceProvider: 'brain.chat.v1',
      sourceChatId: 'src-1',
      consent: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      tags: ['work'],
      messages: [
        { role: 'user', content: 'Hello', sequenceOrder: 0, timestamp: '2024-01-01T00:00:00.000Z' },
      ],
    });
  });

  it('requires a session (401) for export', async () => {
    const { repository } = createInMemoryExportRepository();
    const app = buildApp(createMockAuthService(null), undefined, undefined, undefined, undefined, repository);

    const response = await app.inject({ method: 'GET', url: '/account/export' });

    expect(response.statusCode).toBe(401);
  });
});

describe('account deletion', () => {
  it('locks the account immediately on request', async () => {
    const { repository, state } = createInMemoryDeletionRepository();
    state.users.push({ id: 'user-1', email: 'a@example.com', deletionRequestedAt: null });
    const service = createDeletionService(repository);
    const app = buildApp(createMockAuthService(sessionUser), undefined, undefined, undefined, undefined, undefined, service);

    const response = await app.inject({ method: 'POST', url: '/account/deletion/request', headers: sessionCookie() });

    expect(response.statusCode).toBe(200);
    expect(response.json().requestedAt).toBeTruthy();
    expect(state.users[0].deletionRequestedAt).not.toBeNull();
  });

  it('revokes a pending deletion within the grace period', async () => {
    const { repository, state } = createInMemoryDeletionRepository();
    state.users.push({ id: 'user-1', email: 'a@example.com', deletionRequestedAt: null });
    const service = createDeletionService(repository);
    const app = buildApp(createMockAuthService(sessionUser), undefined, undefined, undefined, undefined, undefined, service);

    await app.inject({ method: 'POST', url: '/account/deletion/request', headers: sessionCookie() });
    const response = await app.inject({ method: 'POST', url: '/account/deletion/revoke', headers: sessionCookie() });

    expect(response.statusCode).toBe(200);
    expect(response.json().revoked).toBe(true);
    expect(state.users[0].deletionRequestedAt).toBeNull();
  });

  it('rejects login for a locked account', async () => {
    const repo = createInMemoryAuthRepository();
    const service = createAuthService(repo);
    await service.register('a@example.com', 'password123');

    const user = await repo.findUserByEmail('a@example.com');
    user!.deletionRequestedAt = new Date();

    const result = await service.login('a@example.com', 'password123');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('account deletion cron (simulated time)', () => {
  it('deletes accounts after the 30-day grace period', async () => {
    const { repository, state } = createInMemoryDeletionRepository();
    state.users.push({ id: 'user-1', email: 'a@example.com', deletionRequestedAt: null });
    let now = Date.UTC(2024, 0, 1, 0, 0, 0);
    const service = createDeletionService(repository, () => now);

    await service.requestDeletion('user-1');

    // Within the grace period: not deleted.
    now = Date.UTC(2024, 0, 20, 0, 0, 0);
    expect(await service.deleteExpiredAccounts()).toBe(0);
    expect(state.users).toHaveLength(1);

    // After 30 days: deleted.
    now = Date.UTC(2024, 1, 1, 0, 0, 0);
    expect(await service.deleteExpiredAccounts()).toBe(1);
    expect(state.users).toHaveLength(0);
    expect(state.deletedUserIds).toEqual(['user-1']);
  });

  it('revocation prevents cron deletion', async () => {
    const { repository, state } = createInMemoryDeletionRepository();
    state.users.push({ id: 'user-1', email: 'a@example.com', deletionRequestedAt: null });
    let now = Date.UTC(2024, 0, 1, 0, 0, 0);
    const service = createDeletionService(repository, () => now);

    await service.requestDeletion('user-1');
    await service.revokeDeletion('user-1');

    now = Date.UTC(2024, 2, 1, 0, 0, 0);
    expect(await service.deleteExpiredAccounts()).toBe(0);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].deletionRequestedAt).toBeNull();
  });

  it('uses a 30-day grace period', () => {
    expect(DELETION_GRACE_PERIOD_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

