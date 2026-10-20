import Fastify from 'fastify';
import { hashPassword, verifyPassword } from '../auth';

interface HashBody {
  password?: string;
}

interface VerifyBody {
  password?: string;
  hash?: string;
}

/**
 * Build the Fastify application instance without starting it.
 * Keeping construction separate makes the app easy to test with `app.inject()`.
 */
export function buildApp() {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/auth/hash', async (request, reply) => {
    const { password } = request.body as HashBody;
    if (!password) {
      return reply.code(400).send({ error: 'password is required' });
    }
    const hash = await hashPassword(password);
    return { hash };
  });

  app.post('/auth/verify', async (request, reply) => {
    const { password, hash } = request.body as VerifyBody;
    if (!password || !hash) {
      return reply.code(400).send({ error: 'password and hash are required' });
    }
    const valid = await verifyPassword(password, hash);
    return { valid };
  });

  return app;
}
