import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ROLES,
  MAX_CHAT_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_PASSWORD_BYTES,
  MAX_TAG_LENGTH,
  MIN_PASSWORD_LENGTH,
  validateBrainChatV1,
  validatePassword,
  type BrainChatMessage,
  type BrainChatV1Payload,
  type ValidationError,
} from '../src/api/validation';

function validPayload(overrides: Partial<BrainChatV1Payload> = {}): BrainChatV1Payload {
  return {
    email: 'user@example.com',
    consent: true,
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

/** Build `count` messages whose content is `contentBytes` bytes long. */
function makeMessages(count: number, contentBytes: number): BrainChatMessage[] {
  const content = 'a'.repeat(contentBytes);
  return Array.from({ length: count }, () => ({ role: 'user', content }));
}

/** Build messages whose combined content totals exactly `targetBytes` bytes. */
function messagesTotalingExactly(targetBytes: number): BrainChatMessage[] {
  const full = Math.floor(targetBytes / MAX_MESSAGE_BYTES);
  const remainder = targetBytes % MAX_MESSAGE_BYTES;
  const messages: BrainChatMessage[] = [];
  for (let i = 0; i < full; i++) {
    messages.push({ role: 'user', content: 'a'.repeat(MAX_MESSAGE_BYTES) });
  }
  if (remainder > 0) {
    messages.push({ role: 'user', content: 'a'.repeat(remainder) });
  }
  return messages;
}

function errorFields(errors: ValidationError[]): string[] {
  return errors.map((e) => e.field);
}

describe('validatePassword', () => {
  it('accepts a password of exactly 72 bytes', () => {
    expect(validatePassword('a'.repeat(MAX_PASSWORD_BYTES))).toBeNull();
  });

  it('rejects a password longer than 72 bytes', () => {
    expect(validatePassword('a'.repeat(MAX_PASSWORD_BYTES + 1))).toContain('Bytes');
  });

  it('counts bytes, not characters', () => {
    // '😀' is 4 UTF-8 bytes: 19 chars = 76 bytes > 72.
    expect(validatePassword('😀'.repeat(19))).toContain('Bytes');
  });
});

describe('validateBrainChatV1', () => {
  describe('valid payloads', () => {
    it('accepts a minimal valid payload', () => {
      const result = validateBrainChatV1(validPayload());
      expect(result.ok).toBe(true);
    });

    it('accepts tags at the maximum allowed length', () => {
      const result = validateBrainChatV1(validPayload({ tags: ['a'.repeat(MAX_TAG_LENGTH)] }));
      expect(result.ok).toBe(true);
    });

    it('accepts a password of at least 8 characters during registration', () => {
      const result = validateBrainChatV1(
        validPayload({ password: 'a'.repeat(MIN_PASSWORD_LENGTH) }),
        { registration: true },
      );
      expect(result.ok).toBe(true);
    });

    it('ignores a short password outside registration', () => {
      const result = validateBrainChatV1(validPayload({ password: 'short' }));
      expect(result.ok).toBe(true);
    });
  });

  describe('required fields', () => {
    it('requires email', () => {
      const result = validateBrainChatV1({
        consent: true,
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('email');
    });

    it('requires consent', () => {
      const result = validateBrainChatV1({
        email: 'user@example.com',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('consent');
    });

    it('requires messages', () => {
      const result = validateBrainChatV1({
        email: 'user@example.com',
        consent: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('messages');
    });

    it('requires each message role', () => {
      const result = validateBrainChatV1({
        email: 'user@example.com',
        consent: true,
        messages: [{ content: 'Hello' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('messages[0].role');
    });

    it('requires each message content', () => {
      const result = validateBrainChatV1({
        email: 'user@example.com',
        consent: true,
        messages: [{ role: 'user' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('messages[0].content');
    });
  });

  describe('email format', () => {
    it.each(['not-an-email', 'user@', '@example.com', 'user name@example.com'])(
      'rejects invalid email %s',
      (email) => {
        const result = validateBrainChatV1(validPayload({ email }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(errorFields(result.errors)).toContain('email');
      },
    );
  });

  describe('consent', () => {
    it('rejects consent=false', () => {
      const result = validateBrainChatV1(validPayload({ consent: false }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('consent');
    });
  });

  describe('size limits', () => {
    it('rejects a message larger than 100 KB', () => {
      const result = validateBrainChatV1(
        validPayload({
          messages: [{ role: 'user', content: 'a'.repeat(MAX_MESSAGE_BYTES + 1) }],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('messages[0].content');
    });

    it('accepts a message exactly at 100 KB', () => {
      const result = validateBrainChatV1(
        validPayload({
          messages: [{ role: 'user', content: 'a'.repeat(MAX_MESSAGE_BYTES) }],
        }),
      );
      expect(result.ok).toBe(true);
    });

    it('accepts a chat exactly at 10 MB', () => {
      const result = validateBrainChatV1(
        validPayload({ messages: messagesTotalingExactly(MAX_CHAT_BYTES) }),
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a chat larger than 10 MB (each message within the per-message limit)', () => {
      const count = Math.floor(MAX_CHAT_BYTES / MAX_MESSAGE_BYTES) + 2;
      const result = validateBrainChatV1(
        validPayload({ messages: makeMessages(count, MAX_MESSAGE_BYTES) }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('messages');
    });
  });

  describe('tags', () => {
    it('rejects a tag longer than 64 characters', () => {
      const result = validateBrainChatV1(
        validPayload({ tags: ['a'.repeat(MAX_TAG_LENGTH + 1)] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('tags[0]');
    });

    it('rejects a non-string tag', () => {
      const result = validateBrainChatV1({
        email: 'user@example.com',
        consent: true,
        messages: [{ role: 'user', content: 'Hello' }],
        tags: [42],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('tags[0]');
    });

    it('rejects a non-array tags value', () => {
      const result = validateBrainChatV1({
        email: 'user@example.com',
        consent: true,
        messages: [{ role: 'user', content: 'Hello' }],
        tags: 'important',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('tags');
    });
  });

  describe('password (registration)', () => {
    it('requires a password during registration', () => {
      const result = validateBrainChatV1(validPayload(), { registration: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('password');
    });

    it('rejects a password shorter than 8 characters during registration', () => {
      const result = validateBrainChatV1(validPayload({ password: 'short' }), {
        registration: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('password');
    });

    it('rejects a password longer than 72 bytes during registration', () => {
      const result = validateBrainChatV1(
        validPayload({ password: 'a'.repeat(MAX_PASSWORD_BYTES + 1) }),
        { registration: true },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('password');
    });
  });

  describe('role values', () => {
    it('rejects an invalid role', () => {
      const result = validateBrainChatV1(
        validPayload({ messages: [{ role: 'moderator', content: 'Hello' }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('messages[0].role');
    });

    it('accepts all allowed roles', () => {
      for (const role of ALLOWED_ROLES) {
        const result = validateBrainChatV1(
          validPayload({ messages: [{ role, content: 'Hello' }] }),
        );
        expect(result.ok).toBe(true);
      }
    });
  });

  describe('content', () => {
    it('rejects empty content', () => {
      const result = validateBrainChatV1(
        validPayload({ messages: [{ role: 'user', content: '   ' }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('messages[0].content');
    });
  });

  describe('multibyte UTF-8 sizing', () => {
    it('counts bytes, not characters', () => {
      // '😀' is 4 UTF-8 bytes: 25_601 chars * 4 = 102_404 bytes > 100 KB
      const result = validateBrainChatV1(
        validPayload({ messages: [{ role: 'user', content: '😀'.repeat(25_601) }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorFields(result.errors)).toContain('messages[0].content');
    });
  });
});
