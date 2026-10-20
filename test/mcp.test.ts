import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ApiHttpError,
  createMcpServer,
  type ChatApiClient,
  type SaveChatInput,
} from '../src/mcp';

function fakeApi(overrides: Partial<ChatApiClient> = {}) {
  const calls: Array<{ method: string; token: string; input: unknown }> = [];
  const api: ChatApiClient = {
    async saveChat(token, input) {
      calls.push({ method: 'saveChat', token, input });
      return { chatId: 'chat-1' };
    },
    async getChat(token, id, options) {
      calls.push({ method: 'getChat', token, input: { id, options } });
      return { id, sourceProvider: 'p', sourceChatId: 's1', messages: [{ role: 'user', content: 'hello' }] };
    },
    ...overrides,
  };
  return { api, calls };
}

async function connect(api: ChatApiClient, token = 'token-abc') {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const server = createMcpServer({ api, token });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe('MCP save_chat', () => {
  it('stores the chat via the API with the configured token', async () => {
    const { api, calls } = fakeApi();
    const { client } = await connect(api, 'token-abc');

    const input: SaveChatInput = {
      sourceProvider: 'brain.chat.v1',
      sourceChatId: 'src-1',
      messages: [{ role: 'user', content: 'Hello' }],
      tags: ['greeting'],
    };

    const result = await client.callTool({ name: 'save_chat', arguments: input });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('saveChat');
    expect(calls[0].token).toBe('token-abc');
    expect(calls[0].input).toEqual(input);
    expect(result.content[0].text).toContain('chat-1');
  });
});

describe('MCP retrieve_chat', () => {
  it('returns the raw form by default', async () => {
    const { api, calls } = fakeApi();
    const { client } = await connect(api);

    const result = await client.callTool({ name: 'retrieve_chat', arguments: { id: 'chat-1' } });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({ id: 'chat-1', options: { prepared: false, maxTokens: undefined } });
    expect(result.content[0].text).toContain('"id":"chat-1"');
  });

  it('forwards prepared and max_tokens to the preparation endpoint', async () => {
    const { api, calls } = fakeApi({
      async getChat(token, id, options) {
        calls.push({ method: 'getChat', token, input: { id, options } });
        return { id, prepared: true, truncated: false, messages: [] };
      },
    });
    const { client } = await connect(api);

    const result = await client.callTool({
      name: 'retrieve_chat',
      arguments: { id: 'chat-1', prepared: true, max_tokens: 250 },
    });

    expect(result.isError).toBeFalsy();
    expect(calls[0].input).toEqual({ id: 'chat-1', options: { prepared: true, maxTokens: 250 } });
    expect(result.content[0].text).toContain('"prepared":true');
  });

  it('passes through the API error code for a wrong scope', async () => {
    const { api } = fakeApi({
      async getChat() {
        throw new ApiHttpError(403, 'Token is missing the required "retrieve" scope.');
      },
    });
    const { client } = await connect(api, 'save-only-token');

    const result = await client.callTool({ name: 'retrieve_chat', arguments: { id: 'chat-1' } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('HTTP 403: Token is missing the required "retrieve" scope.');
  });
});

describe('MCP smoke test', () => {
  it('lists both tools and round-trips a tool call', async () => {
    const { api } = fakeApi();
    const { client } = await connect(api);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['retrieve_chat', 'save_chat']);

    const saved = await client.callTool({
      name: 'save_chat',
      arguments: { sourceProvider: 'p', sourceChatId: 'c1', messages: [{ role: 'user', content: 'x' }] },
    });
    expect(saved.isError).toBeFalsy();
    expect(saved.content[0].text).toContain('chat-1');
  });
});
