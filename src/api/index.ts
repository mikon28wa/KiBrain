import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSessionCookie,
  createAuthService,
  hashPassword,
  type AuthService,
} from '../auth';
import { createDrizzleAuthRepository } from '../auth/repository';
import {
  ImportError,
  createDrizzleImportTransactionManager,
  importChatForOwner,
  registerAndImport,
  type ImportTransactionManager,
} from './chatImport';
import { MAX_REQUEST_BODY_BYTES, isValidEmail, validateBrainChatV1, validateChatSave, validatePassword } from './validation';
import { ApiError } from './errors';
import {
  createApiTokenService,
  createDrizzleApiTokenRepository,
  extractBearerToken,
  hashApiToken,
  type ApiTokenAuth,
  type ApiTokenService,
} from './tokenAuth';
import { createDrizzleChatRepository, deriveChatTitle, type ChatRepository } from './chats';
import {
  createDrizzlePasswordResetRepository,
  createPasswordResetService,
  type PasswordResetService,
} from '../auth/passwordReset';
import { createSmtpMailer, smtpConfigFromEnv } from '../auth/mailer';

interface CredentialsBody {
  email?: string;
  password?: string;
}

/**
 * Rate-limit key. Authenticated API requests are limited per API token;
 * everything else (pre-auth endpoints, health) falls back to the client IP.
 */
const rateLimitKeyGenerator = (request: FastifyRequest): string => {
  const token = extractBearerToken(request);
  return token ? hashApiToken(token) : request.ip || 'unknown';
};

/** Tighter limit for pre-auth endpoints (login, registration, password reset). */
const AUTH_RATE_LIMIT = { max: 5, timeWindow: '1 minute' };

/**
 * Build the Fastify application instance without starting it.
 *
 * Services can be injected for testing; by default drizzle-backed
 * implementations are used.
 */
export function buildApp(
  authService?: AuthService,
  importManager?: ImportTransactionManager,
  passwordResetService?: PasswordResetService,
  apiTokenService?: ApiTokenService,
  chatRepository?: ChatRepository,
) {
  const app = Fastify({ logger: false, bodyLimit: MAX_REQUEST_BODY_BYTES });
  app.register(cookie);
  app.register(rateLimit, {
    // Global 60/minute limit. Authenticated routes are keyed per API token,
    // pre-auth routes per IP (their per-route override below still applies).
    global: true,
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyGenerator,
  });

  const auth = authService ?? createAuthService(createDrizzleAuthRepository());
  const imports = importManager ?? createDrizzleImportTransactionManager();
  const apiTokens = apiTokenService ?? createApiTokenService(createDrizzleApiTokenRepository());
  const chats = chatRepository ?? createDrizzleChatRepository();
  const passwordReset =
    passwordResetService ??
    createPasswordResetService({
      repository: createDrizzlePasswordResetRepository(),
      mailer: createSmtpMailer(smtpConfigFromEnv()),
      hashPassword,
      baseUrl: process.env.APP_BASE_URL,
    });

  // Central error handler: meaningful, client-safe messages + status codes.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

    if (statusCode === 429) {
      return reply.code(429).send({ error: 'Too many requests. Please try again later.' });
    }
    if (statusCode === 413 || (error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: `Request body too large (maximum ${MAX_REQUEST_BODY_BYTES / (1024 * 1024)} MB).` });
    }
    if ((error as { errno?: number }).errno === 1062 || (error as { code?: string }).code === 'ER_DUP_ENTRY') {
      return reply.code(409).send({ error: 'Conflict: the record was modified concurrently, please try again.' });
    }
    if (statusCode >= 400 && statusCode < 500) {
      const message = (error as { message?: string }).message ?? 'Invalid request.';
      return reply.code(statusCode).send({ error: message });
    }

    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error.' });
  });

  // Scope helper for the token-authenticated chat routes.
  async function requireScope(request: FastifyRequest, scope: 'save' | 'retrieve'): Promise<ApiTokenAuth> {
    const token = extractBearerToken(request);
    if (!token) {
      throw new ApiError(401, 'Authentication required: missing bearer token.');
    }
    const principal = await apiTokens.authenticate(token);
    if (!principal) {
      throw new ApiError(401, 'Invalid or revoked API token.');
    }
    if (!principal.scopes.includes(scope)) {
      throw new ApiError(403, `Token is missing the required "${scope}" scope.`);
    }
    return principal;
  }

  // Routes are registered inside `after` so the rate-limit plugin (registered
  // above) has loaded first and its per-route `onRoute` hook is applied.
  app.after(() => {
    app.get('/health', async () => ({ status: 'ok' }));

    app.post(
      '/auth/register',
      { config: { rateLimit: AUTH_RATE_LIMIT } },
      async (request, reply) => {
        const { email, password } = request.body as CredentialsBody;

        if (!isValidEmail(email)) {
          return reply.code(400).send({
            errors: [{ field: 'email', message: 'email ist erforderlich und muss gültig sein' }],
          });
        }
        const passwordError = validatePassword(password);
        if (passwordError) {
          return reply.code(400).send({ errors: [{ field: 'password', message: passwordError }] });
        }

        const result = await auth.register(email, password as string);
        if (!result.ok) {
          return reply.code(409).send({ error: result.error.message });
        }
        return reply.code(201).send({ user: { id: result.user.id, email: result.user.email } });
      },
    );

    app.post(
      '/auth/login',
      { config: { rateLimit: AUTH_RATE_LIMIT } },
      async (request, reply) => {
        const { email, password } = request.body as CredentialsBody;
        if (!email || !password) {
          return reply.code(400).send({ error: 'email and password are required' });
        }
        const result = await auth.login(email, password);
        if (!result.ok) {
          return reply.code(401).send({ error: result.error.message });
        }
        const sessionCookie = createSessionCookie(result.token);
        reply.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.options);
        return { ok: true };
      },
    );

    app.post('/auth/logout', async (request, reply) => {
      const token = request.cookies?.[SESSION_COOKIE_NAME];
      if (token) {
        await auth.logout(token);
      }
      const sessionCookie = clearSessionCookie();
      reply.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.options);
      return { ok: true };
    });

    // brain.chat.v1 import — authenticated via session cookie; the owner is the
    // authenticated user, never a client-supplied email/user id.
    app.post('/brain/chat/v1', async (request, reply) => {
      const token = request.cookies?.[SESSION_COOKIE_NAME];
      const user = token ? await auth.getUserBySessionToken(token) : null;
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const validation = validateBrainChatV1(request.body, { registration: false });
      if (!validation.ok) {
        return reply.code(400).send({ errors: validation.errors });
      }

      // Email remains in the payload contract but must match the authenticated
      // account; it is never used to look up the owner.
      if (validation.value.email.toLowerCase() !== user.email.toLowerCase()) {
        return reply.code(403).send({ error: 'email does not match the authenticated account' });
      }

      const { chatId } = await importChatForOwner(imports, user.id, {
        email: validation.value.email,
        consent: validation.value.consent,
        messages: validation.value.messages,
        tags: validation.value.tags ?? [],
      });
      return reply.code(201).send({ chatId });
    });

    // brain.chat.v1 import + registration — creates the account and its first
    // chat atomically; the import is assigned to the account created here.
    app.post(
      '/brain/chat/v1/register',
      { config: { rateLimit: AUTH_RATE_LIMIT } },
      async (request, reply) => {
        const validation = validateBrainChatV1(request.body, { registration: true });
        if (!validation.ok) {
          return reply.code(400).send({ errors: validation.errors });
        }
        const password = validation.value.password;
        if (!password) {
          return reply.code(400).send({
            errors: [{ field: 'password', message: 'password ist erforderlich' }],
          });
        }

        // Hash before opening the transaction (bcrypt is expensive).
        const passwordHash = await hashPassword(password);

        try {
          const { userId, chatId } = await registerAndImport(imports, {
            email: validation.value.email,
            passwordHash,
            consent: validation.value.consent,
            messages: validation.value.messages,
            tags: validation.value.tags ?? [],
          });
          return reply.code(201).send({
            chatId,
            user: { id: userId, email: validation.value.email },
          });
        } catch (error) {
          if (error instanceof ImportError && error.code === 'EMAIL_TAKEN') {
            return reply.code(409).send({ error: error.message });
          }
          throw error;
        }
      },
    );

    // Request a password-reset email (does not reveal whether the email exists).
    app.post(
      '/auth/password-reset/request',
      { config: { rateLimit: AUTH_RATE_LIMIT } },
      async (request, reply) => {
        const { email } = request.body as { email?: string };
        if (!isValidEmail(email)) {
          return reply.code(400).send({ error: 'email is required and must be valid' });
        }
        await passwordReset.requestReset(email);
        return reply.code(202).send({ ok: true });
      },
    );

    // Set a new password using a one-time reset token.
    app.post(
      '/auth/password-reset',
      { config: { rateLimit: AUTH_RATE_LIMIT } },
      async (request, reply) => {
        const { token, password } = request.body as { token?: string; password?: string };
        if (typeof token !== 'string' || token === '') {
          return reply.code(400).send({ error: 'token and password are required' });
        }
        const passwordError = validatePassword(password);
        if (passwordError) {
          return reply.code(400).send({ errors: [{ field: 'password', message: passwordError }] });
        }
        const result = await passwordReset.resetPassword(token, password as string);
        if (!result.ok) {
          return reply.code(400).send({ error: result.error.message });
        }
        return reply.code(200).send({ ok: true });
      },
    );

    // POST /api/v1/chats — save/upsert (scope: save).
    app.post('/api/v1/chats', async (request, reply) => {
      const principal = await requireScope(request, 'save');
      const validation = validateChatSave(request.body);
      if (!validation.ok) {
        return reply.code(400).send({ errors: validation.errors });
      }
      const { sourceProvider, sourceChatId, title, messages, tags } = validation.value;
      const { chatId } = await chats.upsert(
        {
          userId: principal.userId,
          sourceProvider,
          sourceChatId,
          title: deriveChatTitle(title, messages),
          messages,
          tags,
        },
        { action: 'chat.save', tokenId: principal.tokenId, ipAddress: request.ip || 'unknown' },
      );
      return reply.code(200).send({ chatId });
    });

    // GET /api/v1/chats — list/search (scope: retrieve).
    app.get('/api/v1/chats', async (request, reply) => {
      const principal = await requireScope(request, 'retrieve');
      const query = request.query as { q?: string; tag?: string; page?: string };

      let page = 1;
      if (query.page !== undefined) {
        const parsed = Number(query.page);
        if (!/^\d+$/.test(query.page) || !Number.isInteger(parsed) || parsed < 1) {
          return reply.code(400).send({ error: 'page must be a positive integer.' });
        }
        page = parsed;
      }

      const q = query.q && query.q.trim() !== '' ? query.q : undefined;
      const tag = query.tag && query.tag.trim() !== '' ? query.tag : undefined;

      return chats.list(
        { userId: principal.userId, q, tag, page, pageSize: 20 },
        { action: 'chat.list', tokenId: principal.tokenId, ipAddress: request.ip || 'unknown' },
      );
    });

    // GET /api/v1/chats/:id — raw chat data (scope: retrieve).
    app.get('/api/v1/chats/:id', async (request) => {
      const principal = await requireScope(request, 'retrieve');
      const { id } = request.params as { id: string };
      const chat = await chats.getById(
        principal.userId,
        id,
        { action: 'chat.retrieve', tokenId: principal.tokenId, ipAddress: request.ip || 'unknown' },
      );
      if (!chat) {
        throw new ApiError(404, 'Chat not found.');
      }
      return chat;
    });

  });

  return app;
}



