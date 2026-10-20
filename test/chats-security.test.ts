import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/api';
import {
  MAX_SOURCE_CHAT_ID_LENGTH,
  MAX_SOURCE_PROVIDER_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TITLE_LENGTH,
} from '../src/api/validation';
import { createInMemoryApiTokenService, createInMemoryChatRepository } from './chats-helpers';

const SAVE_A = 'save-a';
const RETRIEVE_A = 'retrieve-a';
const SAVE_B = 'save-b';
const RETRIEVE_B = 'retrieve-b';
const NO_SCOPES = 'no-scopes';

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function buildSecurityApp() {
  const { service: apiTokenService } = createInMemoryApiTokenService({
    [SAVE_A]: { tokenId: 'tok-save-a', userId: 'user-a', scopes: ['save'] },
    [RETRIEVE_A]: { tokenId: 'tok-retrieve-a', userId: 'user-a', scopes: ['retrieve'] },
    [SAVE_B]: { tokenId: 'tok-save-b', userId: 'user-b', scopes: ['save'] },
    [RETRIEVE_B]: { tokenId: 'tok-retrieve-b', userId: 'user-b', scopes: ['retrieve'] },
    [NO_SCOPES]: { tokenId: 'tok-noscope', userId: 'user-a', scopes: [] },
  });
  const { repository, state } = createInMemoryChatRepository();
  const app = buildApp(undefined, undefined, undefined, apiTokenService, repository);
  return { app, state };
}

const payloadA = {
  sourceProvider: 'p',
  sourceChatId: 'a1',
  messages: [{ role: 'user', content: 'A secret' }],
};

describe('ownership isolation (IDOR prevention)', () => {
  it('prevents one user from reading another user chat by id', async () => {
    const { app } = buildSecurityApp();

    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/chats',
      headers: auth(SAVE_B),
      payload: payloadA,
    });
    const chatId = saved.json().chatId;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/chats/${chatId}`,
      headers: auth(RETRIEVE_A),
    });

    expect(response.statusCode).toBe(404);
  });

  it('lists only the authenticated user chats', async () => {
    const { app } = buildSecurityApp();

    await app.inject({ method: 'POST', url: '/api/v1/chats', headers: auth(SAVE_A), payload: { ...payloadA, sourceChatId: 'a1' } });
    await app.inject({ method: 'POST', url: '/api/v1/chats', headers: auth(SAVE_B), payload: { ...payloadA, sourceChatId: 'b1' } });

    const listA = await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(RETRIEVE_A) });
    const listB = await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(RETRIEVE_B) });

    expect(listA.json().items.map((i: { sourceChatId: string }) => i.sourceChatId)).toEqual(['a1']);
    expect(listB.json().items.map((i: { sourceChatId: string }) => i.sourceChatId)).toEqual(['b1']);
  });

  it('keeps upserts isolated per user for the same source key', async () => {
    const { app, state } = buildSecurityApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/chats',
      headers: auth(SAVE_A),
      payload: { sourceProvider: 'p', sourceChatId: 'same', messages: [{ role: 'user', content: 'A secret' }] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/chats',
      headers: auth(SAVE_B),
      payload: { sourceProvider: 'p', sourceChatId: 'same', messages: [{ role: 'user', content: 'B secret' }] },
    });

    const aChats = state.chats.filter((c) => c.userId === 'user-a');
    const bChats = state.chats.filter((c) => c.userId === 'user-b');
    expect(aChats).toHaveLength(1);
    expect(bChats).toHaveLength(1);
    expect(aChats[0].id).not.toBe(bChats[0].id);

    const aMessages = state.messages.filter((m) => m.chatId === aChats[0].id);
    expect(aMessages[0].content).toBe('A secret');
  });
});

describe('authentication edge cases', () => {
  it('rejects malformed Authorization headers with 401', async () => {
    const { app } = buildSecurityApp();

    const cases: Array<Record<string, string>> = [
      { authorization: 'Basic dXNlcjpwYXNz' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer ' },
      { authorization: 'Token secret' },
      {},
    ];

    for (const headers of cases) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/chats', headers });
      expect(response.statusCode).toBe(401);
    }
  });

  it('rejects a valid token with an empty scope list (403)', async () => {
    const { app } = buildSecurityApp();

    const response = await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(NO_SCOPES) });

    expect(response.statusCode).toBe(403);
  });
});

describe('injection resistance', () => {
  it('treats fulltext search input as data, not SQL', async () => {
    const { app } = buildSecurityApp();
    const payload = "'; DROP TABLE chats; --";

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/chats?q=${encodeURIComponent(payload)}`,
      headers: auth(RETRIEVE_A),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });

  it('treats tag filter input as data, not SQL', async () => {
    const { app } = buildSecurityApp();
    const payload = "x' OR '1'='1";

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/chats?tag=${encodeURIComponent(payload)}`,
      headers: auth(RETRIEVE_A),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });
});

describe('rate limiting', () => {
  it('allows 60 requests and returns 429 with Retry-After on the 61st', async () => {
    const { app } = buildSecurityApp();

    for (let i = 0; i < 60; i++) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(RETRIEVE_A) });
      expect(response.statusCode).toBe(200);
    }

    const rejected = await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(RETRIEVE_A) });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers['retry-after']).toBeTruthy();
    expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('applies the 60/minute limit independently per token', async () => {
    const { app } = buildSecurityApp();

    // Exhaust token A's budget.
    for (let i = 0; i < 61; i++) {
      await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(RETRIEVE_A) });
    }

    // A different token still has its own 60/minute budget.
    const response = await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(RETRIEVE_B) });
    expect(response.statusCode).toBe(200);
  });
});

describe('input bounds', () => {
  it('rejects oversized source and tag fields with 400', async () => {
    const { app } = buildSecurityApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chats',
      headers: auth(SAVE_A),
      payload: {
        sourceProvider: 'x'.repeat(MAX_SOURCE_PROVIDER_LENGTH + 1),
        sourceChatId: 'x'.repeat(MAX_SOURCE_CHAT_ID_LENGTH + 1),
        title: 'x'.repeat(MAX_TITLE_LENGTH + 1),
        messages: [{ role: 'user', content: 'ok' }],
        tags: ['x'.repeat(MAX_TAG_LENGTH + 1)],
      },
    });

    expect(response.statusCode).toBe(400);
    const fields = response.json().errors.map((e: { field: string }) => e.field);
    expect(fields).toContain('sourceProvider');
    expect(fields).toContain('sourceChatId');
    expect(fields).toContain('title');
    expect(fields).toContain('tags[0]');
  });
});

