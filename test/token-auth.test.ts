import { describe, expect, it } from 'vitest';
import { createApiTokenService, hashApiToken, type ApiTokenRepository } from '../src/api/tokenAuth';

function repo(records: Array<{
  id: string;
  userId: string;
  tokenHash: string;
  scopes: string[];
  revokedAt: Date | null;
}>): ApiTokenRepository {
  return {
    async findByTokenHash(hash) {
      return records.find((r) => r.tokenHash === hash) ?? null;
    },
  };
}

describe('hashApiToken', () => {
  it('produces a deterministic SHA-256 hex digest', () => {
    const hash = hashApiToken('secret-token');
    expect(hash).toBe(hashApiToken('secret-token'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createApiTokenService', () => {
  it('returns the principal for a valid, non-revoked token', async () => {
    const service = createApiTokenService(
      repo([{ id: 'tok-1', userId: 'user-1', tokenHash: hashApiToken('secret'), scopes: ['save', 'retrieve'], revokedAt: null }]),
    );

    expect(await service.authenticate('secret')).toEqual({
      tokenId: 'tok-1',
      userId: 'user-1',
      scopes: ['save', 'retrieve'],
    });
  });

  it('rejects a revoked token', async () => {
    const service = createApiTokenService(
      repo([{ id: 'tok-1', userId: 'user-1', tokenHash: hashApiToken('secret'), scopes: ['save'], revokedAt: new Date() }]),
    );

    expect(await service.authenticate('secret')).toBeNull();
  });

  it('returns null for an unknown token', async () => {
    const service = createApiTokenService(repo([]));

    expect(await service.authenticate('unknown')).toBeNull();
  });

  it('returns null for an empty token', async () => {
    const service = createApiTokenService(repo([]));

    expect(await service.authenticate('')).toBeNull();
  });
});
