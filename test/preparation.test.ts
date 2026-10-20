import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/api';
import {
  DEFAULT_MAX_TOKENS,
  estimatePreparedTokens,
  estimateTokens,
  prepareChat,
  type PrepareInput,
} from '../src/api/preparation';
import { createInMemoryApiTokenService, createInMemoryChatRepository } from './chats-helpers';

function longChat(count: number, contentLength = 200): PrepareInput {
  return {
    id: 'chat-1',
    title: 'Title',
    sourceProvider: 'p',
    sourceChatId: 's1',
    messages: Array.from({ length: count }, (_, i) => ({
      role: i === 0 ? 'system' : i % 2 === 1 ? 'user' : 'assistant',
      content: `m${i}:${'x'.repeat(contentLength)}`,
    })),
  };
}

describe('estimateTokens', () => {
  it('returns 0 for empty text and at least 1 otherwise', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('four')).toBe(1);
    expect(estimateTokens('five5')).toBe(2); // ceil(5 / 4)
    expect(estimateTokens('x'.repeat(100))).toBe(25);
  });
});

describe('prepareChat', () => {
  it('stays under budget for any max_tokens without erroring', () => {
    const chat = longChat(50, 200);

    for (const maxTokens of [0, 1, 3, 4, 5, 10, 50, 100, 1000, DEFAULT_MAX_TOKENS, 10000]) {
      const result = prepareChat(chat, { maxTokens });
      expect(estimatePreparedTokens(result.messages)).toBeLessThanOrEqual(maxTokens);
    }
  });

  it('is deterministic (two calls return identical results)', () => {
    const chat = longChat(20, 100);

    const first = prepareChat(chat, { maxTokens: 300 });
    const second = prepareChat(chat, { maxTokens: 300 });

    expect(second).toEqual(first);
  });

  it('keeps everything intact when under budget', () => {
    const chat = longChat(3, 10);
    const result = prepareChat(chat, { maxTokens: 1000 });

    expect(result.truncated).toBe(false);
    expect(result.messages).toHaveLength(3);
    expect(result.messages.every((m) => m.truncated === false)).toBe(true);
    expect(result.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
  });

  it('compresses early messages first when the budget is overrun', () => {
    const chat = longChat(5, 1000); // ~254 tokens each
    const result = prepareChat(chat, { maxTokens: 600 });

    // Messages 3 and 4 (latest) stay intact; earlier ones are dropped/truncated.
    expect(result.messages.find((m) => m.index === 0)).toBeUndefined();
    expect(result.messages.find((m) => m.index === 1)).toBeUndefined();
    expect(result.messages.find((m) => m.index === 2)?.truncated).toBe(true);
    expect(result.messages.find((m) => m.index === 3)?.truncated).toBe(false);
    expect(result.messages.find((m) => m.index === 4)?.truncated).toBe(false);
    expect(estimatePreparedTokens(result.messages)).toBeLessThanOrEqual(600);
  });

  it('prioritizes messages matching search terms', () => {
    const chat: PrepareInput = {
      id: 'chat-1',
      title: 'Title',
      sourceProvider: 'p',
      sourceChatId: 's1',
      messages: [
        { role: 'user', content: 'aaaaaaaaaaaa' },
        { role: 'user', content: 'contains needle here' },
        { role: 'assistant', content: 'zzzzzzzzzzzz' },
      ],
    };

    const result = prepareChat(chat, { maxTokens: 10, searchTerms: ['needle'] });

    // The matching message survives fully; non-matching messages are dropped.
    expect(result.messages.find((m) => m.index === 1)?.truncated).toBe(false);
    expect(result.messages.find((m) => m.index === 0)).toBeUndefined();
    expect(result.messages.find((m) => m.index === 2)).toBeUndefined();
  });

  it('preserves system/user/assistant roles in order', () => {
    const chat = longChat(6, 10);
    const result = prepareChat(chat, { maxTokens: 1000 });

    expect(result.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
  });

  it('uses the default budget of 4000 tokens when none is given', () => {
    const chat = longChat(100, 200); // well over 4000 tokens
    const result = prepareChat(chat);

    expect(estimatePreparedTokens(result.messages)).toBeLessThanOrEqual(DEFAULT_MAX_TOKENS);
  });
});

const RETRIEVE = 'retrieve';

function buildTestApp() {
  const { service: apiTokenService } = createInMemoryApiTokenService({
    [RETRIEVE]: { tokenId: 'tok-retrieve', userId: 'user-a', scopes: ['retrieve'] },
  });
  const { repository, state } = createInMemoryChatRepository();
  const app = buildApp(undefined, undefined, undefined, apiTokenService, repository);
  return { app, state };
}

function seedChat(state: ReturnType<typeof buildTestApp>['state']): void {
  state.chats.push({
    id: 'chat-1',
    userId: 'user-a',
    title: 'Seeded',
    sourceProvider: 'p',
    sourceChatId: 's1',
    consent: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  });
  state.messages.push(
    { id: 'm1', chatId: 'chat-1', role: 'user', content: 'Hello world', sequenceOrder: 0, timestamp: new Date('2024-01-01T00:00:00Z') },
    { id: 'm2', chatId: 'chat-1', role: 'assistant', content: 'Hi there', sequenceOrder: 1, timestamp: new Date('2024-01-01T00:00:01Z') },
  );
  state.tags.push({ id: 't1', chatId: 'chat-1', tag: 'greeting' });
}

describe('prepared endpoint', () => {
  it('returns the prepared form with ?prepared=true', async () => {
    const { app, state } = buildTestApp();
    seedChat(state);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-1?prepared=true&max_tokens=100',
      headers: { authorization: `Bearer ${RETRIEVE}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe('chat-1');
    expect(body.truncated).toBe(false);
    expect(body.tags).toBeUndefined();
    expect(body.messages[0]).toMatchObject({ role: 'user', content: 'Hello world', index: 0, truncated: false });
    expect(body.messages[0].id).toBeUndefined();
    expect(body.messages[0].timestamp).toBeUndefined();
  });

  it('leaves the raw data endpoint unchanged', async () => {
    const { app, state } = buildTestApp();
    seedChat(state);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-1',
      headers: { authorization: `Bearer ${RETRIEVE}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tags).toEqual(['greeting']);
    expect(body.consent).toBe(true);
    expect(body.messages[0]).toMatchObject({ id: 'm1', role: 'user', content: 'Hello world', sequenceOrder: 0 });
    expect(body.messages[0].index).toBeUndefined();
  });

  it('rejects a non-integer max_tokens (400)', async () => {
    const { app, state } = buildTestApp();
    seedChat(state);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-1?prepared=true&max_tokens=abc',
      headers: { authorization: `Bearer ${RETRIEVE}` },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a negative max_tokens (400)', async () => {
    const { app, state } = buildTestApp();
    seedChat(state);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-1?prepared=true&max_tokens=-1',
      headers: { authorization: `Bearer ${RETRIEVE}` },
    });

    expect(response.statusCode).toBe(400);
  });

  it('applies the default budget when max_tokens is omitted', async () => {
    const { app, state } = buildTestApp();
    seedChat(state);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-1?prepared=true',
      headers: { authorization: `Bearer ${RETRIEVE}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().messages).toHaveLength(2);
    expect(response.json().truncated).toBe(false);
  });
});
