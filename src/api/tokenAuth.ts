import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { db } from '../db';
import { apiTokens } from '../db/schema';

/**
 * Hash an API token (SHA-256 hex) before looking it up or using it as a
 * rate-limit key. The database stores only the hash, never the raw token.
 */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Extract the bearer token from the `Authorization` header, if present. */
export function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export interface ApiTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  scopes: string[];
  revokedAt: Date | null;
}

/** The authenticated principal derived from a valid API token. */
export interface ApiTokenAuth {
  tokenId: string;
  userId: string;
  scopes: string[];
}

export interface ApiTokenRepository {
  findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null>;
}

export interface ApiTokenService {
  /** Returns the token's principal, or `null` for missing/revoked tokens. */
  authenticate(token: string): Promise<ApiTokenAuth | null>;
}

export function createApiTokenService(repository: ApiTokenRepository): ApiTokenService {
  return {
    async authenticate(token) {
      if (!token) return null;
      const record = await repository.findByTokenHash(hashApiToken(token));
      if (!record || record.revokedAt) return null;
      return { tokenId: record.id, userId: record.userId, scopes: record.scopes };
    },
  };
}

/** Drizzle-backed {@link ApiTokenRepository}; used in production. */
export function createDrizzleApiTokenRepository(database = db): ApiTokenRepository {
  return {
    async findByTokenHash(tokenHash) {
      const rows = await database
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        scopes: row.scopes,
        revokedAt: row.revokedAt,
      };
    },
  };
}
