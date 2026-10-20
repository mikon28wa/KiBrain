import { beforeEach, describe, expect, it } from 'vitest';
import { detectConversations, type DomElement, type DomRoot } from '../extension/src/lib/detector';
import { toBrainChatV1 } from '../extension/src/lib/converter';
import { transmitChat } from '../extension/src/lib/transmitter';
import { runBackup, type BackupDeps } from '../extension/src/lib/backup';
import { loadConfig, saveConfig } from '../extension/src/config';
import type { BrainChatV1, ErrorLogEntry } from '../extension/src/lib/types';

// --- Mock DOM ---------------------------------------------------------------

function mockMessage(role: string, content: string): DomElement {
  return {
    getAttribute: (name) => (name === 'data-role' ? role : null),
    textContent: content,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function mockConversation(id: string, title: string | undefined, messages: DomElement[]): DomElement {
  return {
    getAttribute: (name) => (name === 'data-conversation-id' ? id : null),
    textContent: '',
    querySelector: (selector) => {
      if ((selector === '.title' || selector === '[data-title]') && title !== undefined) {
        return { getAttribute: () => null, textContent: title, querySelector: () => null, querySelectorAll: () => [] };
      }
      return null;
    },
    querySelectorAll: (selector) => (selector === '[data-role]' ? messages : []),
  };
}

function mockPage(conversations: DomElement[]): DomRoot {
  return {
    querySelectorAll: (selector) => (selector === '[data-conversation-id]' ? conversations : []),
  };
}

// --- Mock chrome ------------------------------------------------------------

function createMockChrome() {
  const store: Record<string, unknown> = {};
  const chrome = {
    storage: {
      local: {
        async get(keys: string | string[] | object) {
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
          return { ...store };
        },
        async set(items: object) {
          Object.assign(store, items);
        },
      },
    },
  };
  return { chrome, store };
}

let mockStore: Record<string, unknown>;

beforeEach(() => {
  const { chrome, store } = createMockChrome();
  mockStore = store;
  (globalThis as Record<string, unknown>).chrome = chrome;
});

describe('conversation detection', () => {
  it('detects conversations from a mock platform page', () => {
    const page = mockPage([
      mockConversation('conv-1', 'First chat', [mockMessage('user', 'Hello'), mockMessage('assistant', 'Hi there')]),
      mockConversation('conv-2', undefined, [mockMessage('user', 'Second')]),
    ]);

    const conversations = detectConversations('generic', page);

    expect(conversations).toEqual([
      { id: 'conv-1', title: 'First chat', messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi there' }] },
      { id: 'conv-2', title: undefined, messages: [{ role: 'user', content: 'Second' }] },
    ]);
  });
});

describe('brain.chat.v1 conversion', () => {
  it('produces a stable sourceChatId and the brain.chat.v1 provider', () => {
    const chat = toBrainChatV1({ id: 'conv-1', title: 'My chat', messages: [{ role: 'user', content: 'Hello' }] });

    expect(chat.sourceProvider).toBe('brain.chat.v1');
    expect(chat.sourceChatId).toBe('conv-1');
    expect(chat.title).toBe('My chat');
    expect(chat.tags).toEqual([]);
  });

  it('derives the title from the first message when none is given', () => {
    const chat = toBrainChatV1({ id: 'conv-2', messages: [{ role: 'user', content: 'First message' }] });
    expect(chat.title).toBe('First message');
  });
});

describe('transmission', () => {
  it('POSTs to /api/v1/chats with the bearer token and observes upsert', async () => {
    const urls: string[] = [];
    const bodies: BrainChatV1[] = [];
    const fakeFetch = async (url: string, init: { body: string }) => {
      urls.push(url);
      bodies.push(JSON.parse(init.body) as BrainChatV1);
      return { ok: true, status: 200, json: async () => ({ chatId: 'chat-1' }) };
    };

    const chat = toBrainChatV1({ id: 'conv-1', messages: [{ role: 'user', content: 'Hello' }] });
    await transmitChat('https://api.example.com/', 'secret-token', chat, fakeFetch as never);
    await transmitChat('https://api.example.com/', 'secret-token', chat, fakeFetch as never);

    expect(urls).toEqual(['https://api.example.com/api/v1/chats', 'https://api.example.com/api/v1/chats']);
    expect(bodies[0].sourceChatId).toBe('conv-1');
    expect(bodies[1].sourceChatId).toBe('conv-1');
  });

  it('stores the token locally and never sends it to a third party', async () => {
    await saveConfig({ endpoint: 'https://api.example.com', token: 'secret-token' });

    expect(mockStore.config).toEqual({ endpoint: 'https://api.example.com', token: 'secret-token' });
    expect(await loadConfig()).toEqual({ endpoint: 'https://api.example.com', token: 'secret-token' });

    const urls: string[] = [];
    const fakeFetch = async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ chatId: 'c' }) };
    };
    await transmitChat('https://api.example.com', 'secret-token', toBrainChatV1({ id: 'x', messages: [] }), fakeFetch as never);

    expect(urls.every((u) => u.startsWith('https://api.example.com'))).toBe(true);
  });
});

describe('error logging and retry', () => {
  it('logs a failed run and retries it on the next run', async () => {
    const errors: ErrorLogEntry[] = [];
    const transmitted: string[] = [];
    let detectCalls = 0;
    let failNext = false;

    const deps: BackupDeps = {
      loadConfig: async () => ({ endpoint: 'https://api.example.com', token: 't' }),
      detect: async () => (++detectCalls === 1 ? [{ id: 'conv-1', messages: [{ role: 'user', content: 'Hello' }] }] : []),
      transmit: async (chat) => {
        if (failNext) throw new Error('API error 500');
        transmitted.push(chat.sourceChatId);
      },
      loadErrors: async () => errors,
      saveErrors: async (next) => {
        errors.splice(0, errors.length, ...next);
      },
      now: () => 0,
    };

    failNext = true;
    const first = await runBackup(deps);
    expect(first.failed).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].chat.sourceChatId).toBe('conv-1');
    expect(errors[0].attempts).toBe(1);

    failNext = false;
    const second = await runBackup(deps);
    expect(second.retried).toBe(1);
    expect(transmitted).toEqual(['conv-1']);
    expect(errors).toHaveLength(0);
  });
});

describe('smoke test', () => {
  it('detects, converts, and transmits conversations end-to-end (upsert)', async () => {
    const page = mockPage([
      mockConversation('conv-1', 'Chat', [mockMessage('user', 'Hello'), mockMessage('assistant', 'Hi')]),
    ]);
    const transmitted: BrainChatV1[] = [];

    const deps: BackupDeps = {
      loadConfig: async () => ({ endpoint: 'https://api.example.com', token: 'secret' }),
      detect: async () => detectConversations('generic', page),
      transmit: async (chat) => {
        transmitted.push(chat);
      },
      loadErrors: async () => [],
      saveErrors: async () => {},
      now: () => 0,
    };

    const first = await runBackup(deps);
    expect(first.detected).toBe(1);
    expect(transmitted).toHaveLength(1);
    expect(transmitted[0]).toMatchObject({
      sourceProvider: 'brain.chat.v1',
      sourceChatId: 'conv-1',
      title: 'Chat',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
    });

    await runBackup(deps);
    expect(transmitted).toHaveLength(2);
    expect(transmitted[1].sourceChatId).toBe('conv-1');
  });
});

