import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

/** Input for the `save_chat` tool (mirrors POST /api/v1/chats). */
export interface SaveChatInput {
  sourceProvider: string;
  sourceChatId: string;
  title?: string;
  messages: Array<{ role: string; content: string }>;
  tags?: string[];
}

export interface RetrieveChatOptions {
  prepared?: boolean;
  maxTokens?: number;
}

/**
 * Thin REST client used by the MCP tools. Kept as an interface so tests can
 * substitute a fake without a network.
 */
export interface ChatApiClient {
  saveChat(token: string, input: SaveChatInput): Promise<{ chatId: string }>;
  getChat(token: string, id: string, options?: RetrieveChatOptions): Promise<unknown>;
}

/** Error carrying the upstream HTTP status code so it can be passed through. */
export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

/** HTTP implementation of {@link ChatApiClient} using `fetch`. */
export function createHttpChatApiClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): ChatApiClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (init.body) headers['content-type'] = 'application/json';

    const response = await fetchImpl(`${base}${path}`, { ...init, headers });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }

    if (!response.ok) {
      const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
      const message = String(obj?.error ?? obj?.message ?? text);
      throw new ApiHttpError(response.status, message, parsed);
    }
    return parsed as T;
  }

  return {
    async saveChat(token, input) {
      return request<{ chatId: string }>(token, '/api/v1/chats', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    async getChat(token, id, options = {}) {
      const query = new URLSearchParams();
      if (options.prepared) {
        query.set('prepared', 'true');
        if (options.maxTokens !== undefined) query.set('max_tokens', String(options.maxTokens));
      }
      const qs = query.toString();
      return request<unknown>(token, `/api/v1/chats/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
    },
  };
}

export interface McpOptions {
  api: ChatApiClient;
  /** API token used as a Bearer token for every tool call. */
  token: string;
}

function toErrorResult(error: unknown): CallToolResult {
  if (error instanceof ApiHttpError) {
    return {
      content: [{ type: 'text', text: `HTTP ${error.status}: ${error.message}` }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  };
}

/**
 * Build an MCP server exposing `save_chat` and `retrieve_chat` as a thin layer
 * over the REST API.
 */
export function createMcpServer(options: McpOptions): Server {
  const { api, token } = options;
  const server = new Server(
    { name: 'kibrain', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'save_chat',
        description: 'Save (upsert) a chat via the KiBrain API and return its id.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceProvider: { type: 'string', description: 'Source provider, e.g. "brain.chat.v1".' },
            sourceChatId: { type: 'string', description: 'Chat id within the source provider.' },
            title: { type: 'string' },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: { role: { type: 'string' }, content: { type: 'string' } },
                required: ['role', 'content'],
              },
            },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['sourceProvider', 'sourceChatId', 'messages'],
        },
      },
      {
        name: 'retrieve_chat',
        description: 'Retrieve a chat; optionally return the deterministic prepared form with a token budget.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Chat id.' },
            prepared: { type: 'boolean', description: 'Return the prepared (summarized/truncated) form.' },
            max_tokens: { type: 'number', description: 'Token budget for the prepared form.' },
          },
          required: ['id'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
      if (name === 'save_chat') {
        const result = await api.saveChat(token, {
          sourceProvider: String(a.sourceProvider ?? ''),
          sourceChatId: String(a.sourceChatId ?? ''),
          title: typeof a.title === 'string' ? a.title : undefined,
          messages: (a.messages ?? []) as Array<{ role: string; content: string }>,
          tags: Array.isArray(a.tags) ? (a.tags as string[]) : undefined,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      if (name === 'retrieve_chat') {
        const id = String(a.id ?? '');
        const result = await api.getChat(token, id, {
          prepared: a.prepared === true,
          maxTokens: typeof a.max_tokens === 'number' ? a.max_tokens : undefined,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  return server;
}

export interface McpHttpServerOptions {
  port?: number;
  host?: string;
  ssePath?: string;
  messagesPath?: string;
}

/**
 * Start the MCP server over the HTTP/SSE transport: `GET /sse` establishes the
 * stream, `POST /messages` delivers client messages.
 */
export async function startMcpHttpServer(
  options: McpOptions,
  httpOptions: McpHttpServerOptions = {},
): Promise<http.Server> {
  const ssePath = httpOptions.ssePath ?? '/sse';
  const messagesPath = httpOptions.messagesPath ?? '/messages';
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === ssePath) {
      // One server instance per SSE connection.
      const mcpServer = createMcpServer(options);
      const transport = new SSEServerTransport(messagesPath, res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => transports.delete(transport.sessionId));
      void mcpServer.connect(transport).catch((error) => {
        console.error(error);
        transports.delete(transport.sessionId);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === messagesPath) {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Invalid session id' }));
        return;
      }
      void transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(httpOptions.port ?? 3001, httpOptions.host ?? '127.0.0.1', resolve);
  });

  return httpServer;
}


