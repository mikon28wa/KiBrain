import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/api';
import { MAX_MESSAGE_BYTES } from '../src/api/validation';
import { createInMemoryApiTokenService, createInMemoryChatRepository } from './chats-helpers';

const SAVE_TOKEN = 'token-save';
const RETRIEVE_TOKEN = 'token-retrieve';

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function buildTestApp() {
  const { service: apiTokenService } = createInMemoryApiTokenService({
    [SAVE_TOKEN]: { tokenId: 'tok-save', userId: 'user-a', scopes: ['save'] },
    [RETRIEVE_TOKEN]: { tokenId: 'tok-retrieve', userId: 'user-a', scopes: ['retrieve'] },
  });
  const { repository, state } = createInMemoryChatRepository();
  const app = buildApp(undefined, undefined, undefined, apiTokenService, repository);
  return { app, state };
}

const validPayload = {
  sourceProvider: 'brain.chat.v1',
  sourceChatId: 'src-1',
  messages: [{ role: 'user', content: 'Hello world' }],
  tags: ['greeting'],
};

async function saveChat(app: ReturnType<typeof buildTestApp>['app'], payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/chats',
    headers: auth(SAVE_TOKEN),
    payload,
  });
}

describe('POST /api/v1/chats (scope: save)', () => {
  it('saves a chat and returns its id (happy path)', async () => {
    const { app, state } = buildTestApp();

    const response = await saveChat(app, validPayload);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.chatId).toBeTruthy();
    expect(state.chats).toHaveLength(1);
    expect(state.chats[0].userId).toBe('user-a');
    expect(state.chats[0].sourceProvider).toBe('brain.chat.v1');
    expect(state.chats[0].sourceChatId).toBe('src-1');
    expect(state.messages).toHaveLength(1);
    expect(state.tags).toHaveLength(1);
  });

  it('upserts by UNIQUE(user, provider, sourceChatId): messages replaced, tags updated', async () => {
    const { app, state } = buildTestApp();

    const first = await saveChat(app, {
      sourceProvider: 'p',
      sourceChatId: 'c1',
      messages: [{ role: 'user', content: 'first' }],
      tags: ['a', 'b'],
    });
    const firstChatId = first.json().chatId;

    const second = await saveChat(app, {
      sourceProvider: 'p',
      sourceChatId: 'c1',
      messages: [
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'reply' },
      ],
      tags: ['c'],
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().chatId).toBe(firstChatId);
    expect(state.chats).toHaveLength(1);
    expect(state.messages.map((m) => m.content)).toEqual(['second', 'reply']);
    expect(state.tags.map((t) => t.tag)).toEqual(['c']);
  });

  it('returns 401 without a bearer token', async () => {
    const { app, state } = buildTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/v1/chats', payload: validPayload });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Authentication required: missing bearer token.');
    expect(state.chats).toHaveLength(0);
  });

  it('returns 401 for an unknown token', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chats',
      headers: auth('nope'),
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid or revoked API token.');
  });

  it('returns 403 when the token lacks the save scope', async () => {
    const { app, state } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chats',
      headers: auth(RETRIEVE_TOKEN),
      payload: validPayload,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('Token is missing the required "save" scope.');
    expect(state.chats).toHaveLength(0);
  });

  it('returns 400 for invalid payloads', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chats',
      headers: auth(SAVE_TOKEN),
      payload: { sourceProvider: 'p', sourceChatId: 'c', messages: [] },
    });

    expect(response.statusCode).toBe(400);
    const errors = response.json().errors as Array<{ field: string; message: string }>;
    expect(errors.map((e) => e.field)).toContain('messages');
    expect(errors.find((e) => e.field === 'messages')?.message).toBe('messages must not be empty');
  });

  it('returns 413 for an oversized request body', async () => {
    const { app } = buildTestApp();
    // 102 × 100 KiB newlines: decoded ≈ 9.96 MiB (valid), serialized ≈ 19.9 MiB.
    const newlineContent = '\n'.repeat(MAX_MESSAGE_BYTES);
    const messages = Array.from({ length: 102 }, () => ({ role: 'user', content: newlineContent }));

    const response = await saveChat(app, {
      sourceProvider: 'p',
      sourceChatId: 'big',
      messages,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error).toContain('Request body too large');
  });
});

describe('GET /api/v1/chats (scope: retrieve)', () => {
  it('lists chats newest first with pagination metadata', async () => {
    const { app, state } = buildTestApp();
    for (let i = 1; i <= 25; i++) {
      state.chats.push({
        id: `chat-${i}`,
        userId: 'user-a',
        title: `Chat ${i}`,
        sourceProvider: 'p',
        sourceChatId: `src-${i}`,
        consent: false,
        createdAt: new Date(2024, 0, 1, 0, 0, i),
        updatedAt: new Date(2024, 0, 1, 0, 0, i),
      });
    }

    const page1 = await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(RETRIEVE_TOKEN) });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(20);
    expect(page1.json().total).toBe(25);
    expect(page1.json().page).toBe(1);
    expect(page1.json().pageSize).toBe(20);
    expect(page1.json().items[0].id).toBe('chat-25');

    const page2 = await app.inject({
      method: 'GET',
      url: '/api/v1/chats?page=2',
      headers: auth(RETRIEVE_TOKEN),
    });
    expect(page2.json().items).toHaveLength(5);
    expect(page2.json().items[0].id).toBe('chat-5');
  });

  it('filters by tag', async () => {
    const { app, state } = buildTestApp();
    state.chats.push(
      { id: 'c1', userId: 'user-a', title: 'One', sourceProvider: 'p', sourceChatId: 's1', consent: false, createdAt: new Date(2024, 0, 1), updatedAt: new Date(2024, 0, 1) },
      { id: 'c2', userId: 'user-a', title: 'Two', sourceProvider: 'p', sourceChatId: 's2', consent: false, createdAt: new Date(2024, 0, 2), updatedAt: new Date(2024, 0, 2) },
    );
    state.tags.push({ id: 't1', chatId: 'c1', tag: 'work' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/chats?tag=work',
      headers: auth(RETRIEVE_TOKEN),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0].id).toBe('c1');
  });

  it('ranks fulltext matches by relevance (q)', async () => {
    const { app } = buildTestApp();
    await saveChat(app, { sourceProvider: 'p', sourceChatId: 'low', title: 'Alpha', messages: [{ role: 'user', content: 'banana' }] });
    await saveChat(app, { sourceProvider: 'p', sourceChatId: 'high', title: 'Beta', messages: [{ role: 'user', content: 'banana banana banana' }] });
    await saveChat(app, { sourceProvider: 'p', sourceChatId: 'mid', title: 'Gamma', messages: [{ role: 'user', content: 'banana banana' }] });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/chats?q=banana',
      headers: auth(RETRIEVE_TOKEN),
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items as Array<{ sourceChatId: string; relevance: number }>;
    expect(items.map((i) => i.sourceChatId)).toEqual(['high', 'mid', 'low']);
    expect(items[0].relevance).toBeGreaterThan(items[1].relevance);
    expect(items[1].relevance).toBeGreaterThan(items[2].relevance);
  });

  it('returns 403 when the token lacks the retrieve scope', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(SAVE_TOKEN) });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('Token is missing the required "retrieve" scope.');
  });
});

describe('GET /api/v1/chats/:id (scope: retrieve)', () => {
  it('returns the raw chat including messages and tags', async () => {
    const { app } = buildTestApp();
    const saved = await saveChat(app, validPayload);
    const chatId = saved.json().chatId;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/chats/${chatId}`,
      headers: auth(RETRIEVE_TOKEN),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(chatId);
    expect(body.sourceProvider).toBe('brain.chat.v1');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toBe('Hello world');
    expect(body.tags).toEqual(['greeting']);
  });

  it('returns 404 for an unknown or foreign chat', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/chats/missing',
      headers: auth(RETRIEVE_TOKEN),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Chat not found.');
  });
});

describe('audit logging', () => {
  it('writes an audit entry that never contains chat contents', async () => {
    const { app, state } = buildTestApp();
    const secret = 'top-secret-content-xyz';

    await saveChat(app, {
      sourceProvider: 'p',
      sourceChatId: 'audit',
      messages: [{ role: 'user', content: secret }],
    });

    expect(state.audit).toHaveLength(1);
    const entry = state.audit[0];
    expect(entry.action).toBe('chat.save');
    expect(entry.ipAddress).toBeTruthy();
    expect(JSON.stringify(entry)).not.toContain(secret);
  });

  it('records audit entries for retrieve operations too', async () => {
    const { app, state } = buildTestApp();
    const saved = await saveChat(app, validPayload);
    const chatId = saved.json().chatId;

    await app.inject({ method: 'GET', url: '/api/v1/chats', headers: auth(RETRIEVE_TOKEN) });
    await app.inject({ method: 'GET', url: `/api/v1/chats/${chatId}`, headers: auth(RETRIEVE_TOKEN) });

    expect(state.audit.map((a) => a.action)).toEqual(['chat.save', 'chat.list', 'chat.retrieve']);
  });
});

