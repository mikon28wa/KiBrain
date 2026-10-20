import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/api';
import { MAX_MESSAGE_BYTES } from '../src/api/validation';
import type { AuthUser } from '../src/auth';
import { createInMemoryImportManager, createMockAuthService } from './import-helpers';

const userA: AuthUser = { id: 'user-a', email: 'a@example.com', passwordHash: 'hash', deletionRequestedAt: null };

const validBody = {
  email: 'a@example.com',
  consent: true,
  messages: [{ role: 'user', content: 'Hello' }],
};

function buildTestApp(user: AuthUser | null = userA) {
  const { manager, state } = createInMemoryImportManager();
  const app = buildApp(createMockAuthService(user), manager);
  return { app, state };
}

function authHeaders() {
  return { cookie: 'sid=session-token-1' };
}

describe('brain.chat.v1 authentication and ownership', () => {
  it('rejects unauthenticated imports with 401 and creates no records', async () => {
    const { app, state } = buildTestApp(userA);

    const response = await app.inject({ method: 'POST', url: '/brain/chat/v1', payload: validBody });

    expect(response.statusCode).toBe(401);
    expect(state.chats).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
    expect(state.tags).toHaveLength(0);
  });

  it('imports a chat owned by the authenticated user', async () => {
    const { app, state } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1',
      headers: authHeaders(),
      payload: validBody,
    });

    expect(response.statusCode).toBe(201);
    expect(state.chats).toHaveLength(1);
    expect(state.chats[0].userId).toBe('user-a');
    expect(state.messages).toHaveLength(1);
  });

  it('rejects an email that does not match the authenticated account (403)', async () => {
    const { app, state } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1',
      headers: authHeaders(),
      payload: { ...validBody, email: 'b@example.com' },
    });

    expect(response.statusCode).toBe(403);
    expect(state.chats).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
    expect(state.tags).toHaveLength(0);
  });

  it('user A cannot import into user B account by changing payload fields', async () => {
    const { app, state } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1',
      headers: authHeaders(),
      payload: { ...validBody, email: 'b@example.com' },
    });

    expect(response.statusCode).toBe(403);
    expect(state.chats).toHaveLength(0);
    expect(state.users).toHaveLength(0);
  });

  it('rejected requests create no chat, message or tag records', async () => {
    const { app, state } = buildTestApp(userA);

    await app.inject({ method: 'POST', url: '/brain/chat/v1', headers: authHeaders(), payload: { ...validBody, consent: false } });
    await app.inject({ method: 'POST', url: '/brain/chat/v1', headers: authHeaders(), payload: { ...validBody, messages: [{ role: 'moderator', content: 'x' }] } });

    expect(state.chats).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
    expect(state.tags).toHaveLength(0);
    expect(state.users).toHaveLength(0);
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: '{ "email": broken',
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects null and incorrect field types with 400', async () => {
    const { app } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1',
      headers: authHeaders(),
      payload: { email: null, consent: 'yes', messages: [{ role: 'user', content: null }] },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('brain.chat.v1 request size', () => {
  it('returns 413 when JSON escaping pushes the serialized body over the limit', async () => {
    const { app } = buildTestApp(userA);
    // 102 × 100 KiB newlines: decoded ≈ 9.96 MiB (valid), serialized ≈ 19.9 MiB.
    const newlineContent = '\n'.repeat(MAX_MESSAGE_BYTES);
    const messages = Array.from({ length: 102 }, () => ({ role: 'user', content: newlineContent }));

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1',
      headers: authHeaders(),
      payload: { ...validBody, messages },
    });

    expect(response.statusCode).toBe(413);
  });

  it('measures multibyte UTF-8 content in bytes (400)', async () => {
    const { app } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1',
      headers: authHeaders(),
      payload: { ...validBody, messages: [{ role: 'user', content: '😀'.repeat(25601) }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: { field: string }) => e.field)).toContain('messages[0].content');
  });
});

describe('brain.chat.v1 registration flow', () => {
  it('requires a password (server-side registration mode)', async () => {
    const { app } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1/register',
      payload: { ...validBody, email: 'new@example.com' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: { field: string }) => e.field)).toContain('password');
  });

  it('cannot be bypassed by a client-supplied registration=false field', async () => {
    const { app } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1/register',
      payload: { ...validBody, email: 'new@example.com', registration: false },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: { field: string }) => e.field)).toContain('password');
  });

  it('registers and imports atomically, assigned to the new account', async () => {
    const { app, state } = buildTestApp(userA);

    const response = await app.inject({
      method: 'POST',
      url: '/brain/chat/v1/register',
      payload: { email: 'new@example.com', password: 'password123', consent: true, messages: [{ role: 'user', content: 'Hi' }] },
    });

    expect(response.statusCode).toBe(201);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].email).toBe('new@example.com');
    expect(state.chats).toHaveLength(1);
    expect(state.chats[0].userId).toBe(state.users[0].id);
    expect(state.messages).toHaveLength(1);
  });
});
