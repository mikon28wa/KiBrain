import cookie from '@fastify/cookie';
import Fastify from 'fastify';
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
import { MAX_REQUEST_BODY_BYTES, validateBrainChatV1 } from './validation';
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
 * Build the Fastify application instance without starting it.
 *
 * `authService` and `importManager` can be injected for testing; by default
 * drizzle-backed implementations are used.
 */
export function buildApp(
  authService?: AuthService,
  importManager?: ImportTransactionManager,
  passwordResetService?: PasswordResetService,
) {
  const app = Fastify({ logger: false, bodyLimit: MAX_REQUEST_BODY_BYTES });
  app.register(cookie);

  const auth = authService ?? createAuthService(createDrizzleAuthRepository());
  const imports = importManager ?? createDrizzleImportTransactionManager();
  const passwordReset =
    passwordResetService ??
    createPasswordResetService({
      repository: createDrizzlePasswordResetRepository(),
      mailer: createSmtpMailer(smtpConfigFromEnv()),
      hashPassword,
      baseUrl: process.env.APP_BASE_URL,
    });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/auth/register', async (request, reply) => {
    const { email, password } = request.body as CredentialsBody;
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password are required' });
    }
    const result = await auth.register(email, password);
    if (!result.ok) {
      return reply.code(409).send({ error: result.error.message });
    }
    return reply.code(201).send({ user: { id: result.user.id, email: result.user.email } });
  });

  app.post('/auth/login', async (request, reply) => {
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
  });

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
  app.post('/brain/chat/v1/register', async (request, reply) => {
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
  });

  // Request a password-reset email (does not reveal whether the email exists).
  app.post('/auth/password-reset/request', async (request, reply) => {
    const { email } = request.body as { email?: string };
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: 'email is required and must be valid' });
    }
    await passwordReset.requestReset(email);
    return reply.code(202).send({ ok: true });
  });

  // Set a new password using a one-time reset token.
  app.post('/auth/password-reset', async (request, reply) => {
    const { token, password } = request.body as { token?: string; password?: string };
    if (!token || !password) {
      return reply.code(400).send({ error: 'token and password are required' });
    }
    const result = await passwordReset.resetPassword(token, password);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error.message });
    }
    return reply.code(200).send({ ok: true });
  });

  return app;
}



