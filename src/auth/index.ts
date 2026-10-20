import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Password hashing (bcrypt)
// ---------------------------------------------------------------------------

/** Hash a plain-text password using bcrypt. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/** Compare a plain-text password against a bcrypt hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ---------------------------------------------------------------------------
// Session tokens (opaque, not JWT)
// ---------------------------------------------------------------------------

/** Generate a cryptographically random session token. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash a session token before persisting it. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

export interface SessionCookie {
  name: string;
  value: string;
  options: SessionCookieOptions;
}

/** Build the Set-Cookie configuration for a new session (7-day, HttpOnly, Secure). */
export function createSessionCookie(token: string): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    },
  };
}

/** Build the Set-Cookie configuration that clears the session cookie. */
export function clearSessionCookie(): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    options: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Storage abstraction so the auth service is unit-testable without a database. */
export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  createUser(email: string, passwordHash: string): Promise<AuthUser>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  createSession(session: AuthSession): Promise<void>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
}

export type RegisterResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: { code: 'EMAIL_TAKEN'; message: string } };

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: { code: 'INVALID_CREDENTIALS'; message: string } };

export interface AuthService {
  register(email: string, password: string): Promise<RegisterResult>;
  login(email: string, password: string): Promise<LoginResult>;
  logout(token: string): Promise<void>;
  getUserBySessionToken(token: string): Promise<AuthUser | null>;
}

export function createAuthService(repository: AuthRepository): AuthService {
  return {
    async register(email, password) {
      const existing = await repository.findUserByEmail(email);
      if (existing) {
        return {
          ok: false,
          error: { code: 'EMAIL_TAKEN', message: 'E-Mail wird bereits verwendet' },
        };
      }

      const passwordHash = await hashPassword(password);
      try {
        const user = await repository.createUser(email, passwordHash);
        return { ok: true, user };
      } catch {
        // Unique-constraint race condition
        return {
          ok: false,
          error: { code: 'EMAIL_TAKEN', message: 'E-Mail wird bereits verwendet' },
        };
      }
    },

    async login(email, password) {
      const user = await repository.findUserByEmail(email);
      if (!user) {
        return {
          ok: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'E-Mail oder Passwort ist falsch' },
        };
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return {
          ok: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'E-Mail oder Passwort ist falsch' },
        };
      }

      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await repository.createSession({
        id: randomUUID(),
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
      });

      return { ok: true, token, expiresAt };
    },

    async logout(token) {
      await repository.deleteSessionByTokenHash(hashSessionToken(token));
    },

    async getUserBySessionToken(token) {
      const session = await repository.findSessionByTokenHash(hashSessionToken(token));
      if (!session) {
        return null;
      }
      if (session.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      return repository.findUserById(session.userId);
    },
  };
}
